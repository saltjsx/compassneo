import { v } from "convex/values";
import { internalAction, internalMutation, mutation, query, type ActionCtx, type MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { DataModel, Doc, Id } from "./_generated/dataModel";
import { isNonRetryableError, NonRetryableError, type WorkId } from "@convex-dev/workpool";
import { CompassError, getUserDetails, type CompassSession } from "@compassneo/compass";
import { ConnectError, type ConnectClass, type ConnectNotice, type ConnectSession } from "@compassneo/connect";
import { hashToken } from "./lib/crypto";
import { withCompass, type Problem } from "./lib/compass";
import { isWA, withConnect } from "./lib/connect";
import { addDays, schoolToday } from "./lib/days";
import { fetchDays, WINDOW_AHEAD, WINDOW_BEHIND } from "./timetable";
import { syncTeachers } from "./teachers";
import { fetchConnectWork, syncTasks } from "./work";
import { fetchCompassAttendance, fetchConnectAttendance } from "./attendance";
import { fetchEvents } from "./events";
import { fetchChronicle } from "./chronicle";
import { fetchNews } from "./announcements";
import { farewellFor } from "./accounts";
import { backgroundPool, poolFor, syncPool } from "./pools";
import { CanvasError, type CanvasCourse, type CanvasSession } from "@compassneo/canvas";
import { hasCanvas, withCanvas } from "./lib/canvas";
import { fetchAnnouncements as fetchCanvasAnnouncements, fetchCourses, fetchWork as fetchCanvasWork } from "./canvas";

/**
 * Sync: a pass over what Compass Neo keeps for an account, written to a `syncs` row step by step as it goes, so the
 * app can draw it. Steps run one after another: Compass and Connect each get one session at a time, and an account has
 * one run at a time.
 *
 * Two kinds of run:
 *   full   everything: Compass (profile, the timetable from a week back to a fortnight on, learning tasks, news,
 *          attendance, events, Chronicle, teachers' photos), then Connect at a WA school (sign-in, classes, notices,
 *          grades, work, attendance), then Canvas when the student has added it (courses, work, grades, announcements)
 *   quick  only what changes minute to minute: the timetable from yesterday to a week on, learning tasks, news
 *
 * Every run is a job in a workpool (convex/pools.ts), never an action a client waits on: `begin` writes the row and
 * enqueues its job in one transaction. Runs someone is waiting on (a sign-in, opening the app, "Sync now", an open
 * tab's minute sync) go in syncPool, background ones in backgroundPool. A job that dies is tried again and picks up
 * where it stopped, skipping the steps already settled; one that fails every try, or is called off, is ended by `done`.
 *
 * When runs happen:
 *   sign-in, "Sync now"   a full run, at once
 *   opening the app       a full run if the last full one is over a quarter hour old, else a quick one if the last run
 *                         is over 40 seconds old
 *   an open tab           the same, about once a minute while it is in front of someone (lib/neo/sync.ts)
 *   background            a full run every quarter hour (hourly once no device has opened the app in three days),
 *                         each account at its own minute in the quarter so the load stays even (`tick`)
 * Quiet runs (an open tab's, the background's) never show as syncing; they only move "Synced 2 minutes ago" on.
 */

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
/** Background runs come round this often, each account at its own place in it (its phase, from its id). */
const PERIOD = 15 * MINUTE;
/** An account no device has opened the app on in this long is synced in the background only hourly, on its phase. */
const DORMANT_AFTER = 3 * DAY;
const DORMANT_EVERY = 4 * PERIOD;
/** Opening the app, or an open tab, asks for a full run once the last full one is this old. */
const FULL_EVERY = 15 * MINUTE;
/** A background run is not needed when a full run finished this recently (an open tab has done it). */
const BACKGROUND_FRESH = 10 * MINUTE;
/** Quick runs are at least this far apart, however many tabs ask; under a tab's minute, so none of its asks is lost. */
const QUICK_EVERY = 40 * SECOND;
/**
 * A run whose job has not started in this long is taken as lost (the sync pool starts one in seconds, and a queued
 * background run is superseded as soon as someone asks). One heard nothing from in ALIVE_STALE died with its job: an
 * action cannot run longer, and a retry would have said so by then. The app reads runs the same way (lib/neo/sync.ts).
 */
const QUEUED_STALE = 30 * MINUTE;
const ALIVE_STALE = 10 * MINUTE;
/** After Connect refuses an account, it is asked again only after this long (or on a sign-in or "Sync now"). */
const RETRY_REFUSED = 6 * HOUR;
/** Runs kept per account: the latest, and a few before it to see what went wrong (and the latest full one, always). */
const KEEP_RUNS = 5;
/** Due accounts taken per scheduler mutation, and how many of those one tick may chain before the rest wait a minute. */
const TICK_BATCH = 50;
const TICK_ROUNDS = 6;
/** A quick run's timetable, in days either side of today. */
const QUICK_BEHIND = 1;
const QUICK_AHEAD = 7;

// "people" (teachers' names and photos) goes last: it may be refused, and nothing waits on it.
const COMPASS_STEPS = ["profile", "timetable", "tasks", "news", "attendance", "events", "chronicle", "people"] as const;
const QUICK_STEPS = ["timetable", "tasks", "news"] as const;
const CONNECT_STEPS = ["signin", "classes", "notices", "grades", "work", "attendance"] as const;
const CANVAS_STEPS = ["courses", "work", "grades", "announcements"] as const;
type CompassKey = (typeof COMPASS_STEPS)[number];
type ConnectKey = (typeof CONNECT_STEPS)[number];
type CanvasKey = (typeof CANVAS_STEPS)[number];
type Reason = Doc<"syncs">["reason"];
type Kind = "full" | "quick";
type Source = "compass" | "connect" | "canvas";
type Status = "waiting" | "running" | "done" | "failed" | "skipped";
type Outcome = { count?: number; note?: string };

const reasonV = v.union(v.literal("sign-in"), v.literal("open"), v.literal("manual"), v.literal("active"), v.literal("background"));
const sourceV = v.union(v.literal("compass"), v.literal("connect"), v.literal("canvas"));
const statusV = v.union(v.literal("waiting"), v.literal("running"), v.literal("done"), v.literal("failed"), v.literal("skipped"));

/** Runs someone is watching: the gauges draw these as they go. The rest are quiet. */
const LOUD: Reason[] = ["sign-in", "open", "manual"];
const loud = (r: Pick<Doc<"syncs">, "reason" | "watched">) => LOUD.includes(r.reason) || !!r.watched;
const isSettled = (s: Status) => s === "done" || s === "failed" || s === "skipped";
const isFull = (r: Doc<"syncs">) => !!r.finishedAt && (r.kind ?? "full") === "full";

export type SyncRun = Pick<Doc<"syncs">, "_id" | "reason" | "kind" | "watched" | "startedAt" | "aliveAt" | "finishedAt" | "steps">;
export type SyncState = { watched: SyncRun | null; last: SyncRun | null };

const shown = (r: Doc<"syncs">): SyncRun => ({
  _id: r._id,
  reason: r.reason,
  kind: r.kind,
  watched: r.watched,
  startedAt: r.startedAt,
  aliveAt: r.aliveAt,
  finishedAt: r.finishedAt,
  steps: r.steps,
});

/**
 * The device's syncs, as they fill in. Reactive: each step lands here as it starts and ends.
 *   watched  the latest run someone is watching (a sign-in, opening the app, "Sync now"), finished or not: the login's
 *            gauge follows it, and the corner gauge moves while it runs
 *   last     the latest run to finish, of any kind: what the corner gauge shows at rest, and when it last synced
 */
export const latest = query({
  args: { token: v.union(v.string(), v.null()) },
  handler: async (ctx, { token }): Promise<SyncState | null> => {
    if (!token) return null;
    const tokenHash = await hashToken(token);
    const session = await ctx.db.query("sessions").withIndex("by_token", i => i.eq("tokenHash", tokenHash)).first();
    if (!session) return null;
    const runs = await ctx.db
      .query("syncs")
      .withIndex("by_account", i => i.eq("accountId", session.accountId))
      .order("desc")
      .take(KEEP_RUNS + 2);
    const watched = runs.find(loud);
    const last = runs.find(r => r.finishedAt);
    return { watched: watched ? shown(watched) : null, last: last ? shown(last) : null };
  },
});

/**
 * Asks for a sync of the device's account: "open" as the app opens, "active" about once a minute while it is in front
 * of someone, "manual" (or force) for "Sync now". Answers at once; the run waits its turn in its pool and the device
 * follows it through `latest`. Whether there is a run, and of which kind, is `plan`'s call.
 *
 * A device whose session is gone is told why, when it was signed out behind its back (a farewell, accounts.ts).
 */
export const now = mutation({
  args: {
    token: v.string(),
    reason: v.optional(v.union(v.literal("open"), v.literal("active"), v.literal("manual"))),
    force: v.optional(v.boolean()),
  },
  handler: async (ctx, { token, reason, force }): Promise<{ ok: true } | Problem> => {
    const tokenHash = await hashToken(token);
    const session = await ctx.db.query("sessions").withIndex("by_token", i => i.eq("tokenHash", tokenHash)).first();
    const account = session && (await ctx.db.get(session.accountId));
    if (!session || !account) {
      const farewell = await farewellFor(ctx, tokenHash);
      return farewell ? { ok: false, ...farewell } : { ok: false, code: "signed-out", message: "This device is signed out." };
    }
    const at = Date.now();
    // The device is in use (noted at most hourly, as every other call does): it is not swept, and it keeps its account
    // on the quarter-hour background cadence.
    if (at - session.lastSeenAt > HOUR) await ctx.db.patch(session._id, { lastSeenAt: at });
    const why: Reason = force ? "manual" : (reason ?? "open");
    await begin(ctx, account, why, why === "manual", at);
    return { ok: true };
  },
});

/**
 * A sign-in's run (auth.ts): full, at once, in the sync pool. Says whether the account already has what home shows
 * first (today's timetable, kept by an earlier sync, as when a second device signs in): then the app opens on it
 * straight away and this run carries on behind it.
 */
export const signedIn = internalMutation({
  args: { accountId: v.id("accounts") },
  handler: async (ctx, { accountId }): Promise<{ cached: boolean }> => {
    const account = await ctx.db.get(accountId);
    if (!account) return { cached: false };
    const today = await ctx.db
      .query("compassCache")
      .withIndex("by_account_kind", i => i.eq("accountId", accountId).eq("kind", `day:${schoolToday(account.slug)}`))
      .unique();
    await begin(ctx, account, "sign-in", true, Date.now());
    return { cached: !!today };
  },
});

/** Plans a run and, if there is one, enqueues its job in the same transaction, so a row never lacks its job. */
export async function begin(ctx: MutationCtx, account: Doc<"accounts">, reason: Reason, force: boolean, now: number) {
  const runId = await plan(ctx, account, reason, force, now);
  if (!runId) return null;
  const workId = await poolFor(reason).enqueueAction(ctx, internal.sync.run, { runId }, { onComplete: internal.sync.done });
  await ctx.db.patch(runId, { workId });
  return runId;
}

/**
 * What a request gets, from when the account last finished a run and a full run:
 *   sign-in, "Sync now"  a full run, however fresh the last
 *   background           a full run, unless one finished in the last BACKGROUND_FRESH (an open tab did it)
 *   open, active         a full run once the last full one is over FULL_EVERY old, else a quick one once the last run
 *                        is over QUICK_EVERY old, else nothing
 */
function kindFor(reason: Reason, force: boolean, now: number, lastAt?: number, lastFullAt?: number): Kind | null {
  if (force || reason === "sign-in" || reason === "manual") return "full";
  if (reason === "background") return lastFullAt && now - lastFullAt < BACKGROUND_FRESH ? null : "full";
  if (!lastFullAt || now - lastFullAt > FULL_EVERY) return "full";
  if (!lastAt || now - lastAt > QUICK_EVERY) return "quick";
  return null;
}

/**
 * Writes a new run for the account, waiting for its job, or returns null when it needs none. One run at a time: a run
 * in flight (queued, or running and heard from lately) answers the request, and someone asking to see it gets to
 * watch it. Two exceptions: a background run that has not started yet gives way to someone who is here (their run
 * takes its place, in the quicker pool, and is full as the background's would have been), and a run that has gone
 * quiet (see QUEUED_STALE) is let go first.
 */
async function plan(ctx: MutationCtx, account: Doc<"accounts">, reason: Reason, force: boolean, now: number): Promise<Id<"syncs"> | null> {
  const runs = await ctx.db
    .query("syncs")
    .withIndex("by_account", i => i.eq("accountId", account._id))
    .order("desc")
    .take(KEEP_RUNS + 5);
  let kind = kindFor(reason, force, now, runs.find(r => r.finishedAt)?.finishedAt, runs.find(isFull)?.finishedAt);

  const last = runs[0];
  if (last && !last.finishedAt) {
    // A row from before the pools has no job to wait for: it is judged by when it started.
    const queued = !!last.workId && !last.aliveAt;
    if (queued && last.reason === "background" && reason !== "background" && kind) {
      await backgroundPool.cancel(ctx, last.workId as WorkId);
      await ctx.db.delete(last._id);
      runs.shift();
      kind = "full";
    } else if (queued ? reason !== "background" && now - last.startedAt > QUEUED_STALE : now - (last.aliveAt ?? last.startedAt) > ALIVE_STALE) {
      await letGo(ctx, last, "Stopped answering.");
    } else {
      if (LOUD.includes(reason) && !loud(last)) await ctx.db.patch(last._id, { watched: true });
      return null;
    }
  }
  if (!kind) return null;

  // Connect needs the stored login to sign in (accounts from before logins were kept have none).
  const connect = kind === "full" && isWA(account.slug) && !!account.sealedLogin;
  const steps = [
    ...(kind === "full" ? COMPASS_STEPS : QUICK_STEPS).map(key => ({ key, source: "compass" as const, status: "waiting" as const })),
    ...(connect ? CONNECT_STEPS.map(key => ({ key, source: "connect" as const, status: "waiting" as const })) : []),
    // Canvas, when the student has added it and Canvas still takes the token. Full runs only: it changes slowly.
    ...(kind === "full" && hasCanvas(account) ? CANVAS_STEPS.map(key => ({ key, source: "canvas" as const, status: "waiting" as const })) : []),
  ];
  const id = await ctx.db.insert("syncs", { accountId: account._id, reason, kind, attempts: 0, startedAt: now, steps });

  // The newest KEEP_RUNS stay (this one among them), and the latest full one, so the next request can see its age.
  const keepFull = runs.find(isFull);
  for (const old of runs.slice(KEEP_RUNS - 1)) {
    if (old._id === keepFull?._id) continue;
    if (!old.finishedAt && old.workId) await poolFor(old.reason).cancel(ctx, old.workId as WorkId);
    await ctx.db.delete(old._id);
  }
  return id;
}

/** Ends a run its job will not finish: the steps left are marked with the status and a note saying why. */
async function settle(ctx: MutationCtx, run: Doc<"syncs">, status: "failed" | "skipped", note?: string) {
  const at = Date.now();
  await ctx.db.patch(run._id, {
    finishedAt: at,
    steps: run.steps.map(s => (s.status === "waiting" || s.status === "running" ? { ...s, status, note: note ?? s.note, at } : s)),
  });
}

/** Calls a run's job off and ends the run. A job already going stops at its next step (it finds the run over). */
async function letGo(ctx: MutationCtx, run: Doc<"syncs">, note: string) {
  if (run.workId) await poolFor(run.reason).cancel(ctx, run.workId as WorkId);
  await settle(ctx, run, "failed", note);
}

// ---------- background ----------

/** Where an account sits in the quarter hour: a hash of its id (FNV-1a), so accounts spread evenly across it. */
function phaseOf(id: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 0x01000193);
  return (h >>> 0) % PERIOD;
}

/** The first moment after t at the phase. */
const slotAfter = (t: number, phase: number) => t + ((((phase - (t % PERIOD)) % PERIOD) + PERIOD) % PERIOD || PERIOD);

/** When a device last opened the app on the account (noted at most hourly). */
async function lastSeen(ctx: MutationCtx, accountId: Id<"accounts">) {
  const devices = await ctx.db.query("sessions").withIndex("by_account", i => i.eq("accountId", accountId)).take(20);
  return Math.max(0, ...devices.map(d => d.lastSeenAt));
}

/**
 * The background scheduler, every minute (crons.ts). Takes the accounts whose turn has come, oldest first, in
 * bounded batches by index (never a scan), plans a background run for each, enqueues them in backgroundPool as one
 * batch, and moves each account on a whole turn, so it keeps its phase and the load stays spread. An account with a
 * run in flight, or one fresh from an open tab, is just moved on. One a whole turn behind (the batch was full, or the
 * scheduler was down) goes back to its phase from now rather than catching up in a burst.
 *
 * Accounts it has not seen yet (new, or from before it) are given their phase first; their first background run
 * comes round at it, within the quarter hour.
 */
export const tick = internalMutation({
  args: { round: v.optional(v.number()) },
  handler: async (ctx, { round = 0 }) => {
    const now = Date.now();
    // A missing field sorts before every number in an index, so the unseen are asked for by name.
    const unseen = await ctx.db.query("accounts").withIndex("by_nextSync", i => i.eq("nextSyncAt", undefined)).take(TICK_BATCH);
    for (const a of unseen) await ctx.db.patch(a._id, { nextSyncAt: slotAfter(now, phaseOf(a._id)) });

    const due = await ctx.db
      .query("accounts")
      .withIndex("by_nextSync", i => i.gte("nextSyncAt", 0).lte("nextSyncAt", now))
      .take(TICK_BATCH);
    const runIds: Id<"syncs">[] = [];
    for (const account of due) {
      const runId = await plan(ctx, account, "background", false, now);
      if (runId) runIds.push(runId);
      const every = (await lastSeen(ctx, account._id)) > now - DORMANT_AFTER ? PERIOD : DORMANT_EVERY;
      const next = account.nextSyncAt! + every;
      await ctx.db.patch(account._id, { nextSyncAt: next > now ? next : slotAfter(now, phaseOf(account._id)) });
    }
    if (runIds.length) {
      const workIds = await backgroundPool.enqueueActionBatch(
        ctx,
        internal.sync.run,
        runIds.map(runId => ({ runId })),
        { onComplete: internal.sync.done },
      );
      for (let i = 0; i < runIds.length; i++) await ctx.db.patch(runIds[i], { workId: workIds[i] });
    }
    // More due than a batch: a few more rounds now, and the rest wait for the next tick.
    const more = due.length === TICK_BATCH || unseen.length === TICK_BATCH;
    if (more && round + 1 < TICK_ROUNDS) await ctx.scheduler.runAfter(0, internal.sync.tick, { round: round + 1 });
  },
});

// ---------- the job ----------

/** A run's job, in its pool. Picks up where an earlier attempt stopped: only the steps not settled yet run. */
export const run = internalAction({
  args: { runId: v.id("syncs") },
  handler: async (ctx, { runId }) => {
    const started = await ctx.runMutation(internal.sync.attempt, { runId });
    if (started) await runSync(ctx, started.run, started.account);
  },
});

/**
 * A job starting on its run: counts the attempt, and puts a step an earlier attempt died in back to waiting. Null if
 * the run is over (let go, or its account forgotten): then the job has nothing to do.
 */
export const attempt = internalMutation({
  args: { runId: v.id("syncs") },
  handler: async (ctx, { runId }): Promise<{ run: Doc<"syncs">; account: Doc<"accounts"> } | null> => {
    const run = await ctx.db.get(runId);
    const account = run && !run.finishedAt ? await ctx.db.get(run.accountId) : null;
    if (!run || !account) return null;
    const steps = run.steps.map(s => (s.status === "running" ? { ...s, status: "waiting" as const } : s));
    await ctx.db.patch(runId, { attempts: (run.attempts ?? 0) + 1, aliveAt: Date.now(), steps });
    return { run: { ...run, steps }, account };
  },
});

/**
 * The pools' word that a job is over. A run the job did not finish itself (it failed every try, or was called off
 * before it started) ends here, the steps left failed with the reason.
 */
export const done = syncPool.defineOnComplete<DataModel>({
  handler: async (ctx, { workId, result }) => {
    const run = await ctx.db.query("syncs").withIndex("by_work", i => i.eq("workId", workId)).first();
    if (!run || run.finishedAt) return;
    if (result.kind === "success") return settle(ctx, run, "skipped");
    await settle(ctx, run, "failed", result.kind === "failed" ? `Gave up: ${result.error}`.slice(0, 200) : "Called off before it finished.");
  },
});

// ---------- the steps ----------

const COMPASS: Record<CompassKey, (ctx: ActionCtx, account: Doc<"accounts">, s: CompassSession, kind: Kind) => Promise<Outcome>> = {
  async profile(ctx, account, s) {
    const d = await getUserDetails(s);
    const displayName = d.preferredName || d.firstName || account.displayName;
    // The photo is copied once per photo: Compass gives a new path when it changes.
    let photo: { photoId: Id<"_storage">; photoPath: string } | undefined;
    if (d.photoPath && d.photoPath !== account.photoPath) {
      const image = await s.image(d.photoPath).catch(() => null);
      if (image) photo = { photoId: await ctx.storage.store(new Blob([image.bytes], { type: image.type })), photoPath: d.photoPath };
    }
    await ctx.runMutation(internal.accounts.saveProfile, {
      accountId: account._id,
      displayName,
      fullName: d.fullName ?? undefined,
      formGroup: d.formGroup ?? undefined,
      ...photo,
    });
    return { note: d.formGroup ? `${displayName}, ${d.formGroup}` : displayName };
  },

  /** The timetable around today, a day per row (convex/timetable.ts); a quick run only the week ahead. The count is the lessons in it. */
  async timetable(ctx, account, s, kind) {
    const today = schoolToday(account.slug);
    const [behind, ahead] = kind === "quick" ? [QUICK_BEHIND, QUICK_AHEAD] : [WINDOW_BEHIND, WINDOW_AHEAD];
    const r = await fetchDays(ctx, account, s, addDays(today, -behind), addDays(today, ahead));
    return { count: r.lessons, note: r.teacherFields.length ? `teacher fields: ${r.teacherFields.join(", ")}` : undefined };
  },

  /** Every task, in full (instructions, attachments, what was handed in): convex/work.ts. The count is the ones to come. */
  async tasks(ctx, account, s) {
    const r = await syncTasks(ctx, account, s);
    return { count: r.upcoming };
  },

  /** The school's news feed, its daily notices read into bullet points and assemblies (convex/announcements.ts). */
  news: (ctx, account, s) => fetchNews(ctx, account, s),

  /** This year's rolls by class and days by term (convex/attendance.ts). */
  attendance: (ctx, account, s) => fetchCompassAttendance(ctx, account, s),

  /** Excursions, clubs, assemblies and exams this year and the months ahead (convex/events.ts). */
  events: (ctx, account, s) => fetchEvents(ctx, account, s),

  /** What staff have noted in Chronicle that the student may see (convex/chronicle.ts). */
  chronicle: (ctx, account, s) => fetchChronicle(ctx, account, s),

  /** The teachers on the timetable: their names and photos, once a fortnight each (convex/teachers.ts). */
  people: (ctx, account, s) => syncTeachers(ctx, account, s),
};

const failure = (e: unknown) => (e instanceof Error && e.message ? e.message : "Something went wrong.");

/** Marks a step. Throws, without a retry, once the run is over (let go, or its account forgotten): nothing is left to do. */
type Mark = (key: string, status: Status, o?: Outcome) => Promise<void>;

async function runSync(ctx: ActionCtx, run: Doc<"syncs">, account: Doc<"accounts">) {
  const markIn =
    (source: Source): Mark =>
    async (key, status, o = {}) => {
      const on = await ctx.runMutation(internal.sync.step, { runId: run._id, key, source, status, ...o });
      if (!on) throw new NonRetryableError("This sync is over.");
    };
  const mark = markIn("compass");
  const kind = run.kind ?? "full";
  const left = run.steps.filter(s => s.source === "compass" && !isSettled(s.status)).map(s => s.key as CompassKey);

  // Compass: one session for every step. A step that fails on its own is marked and the rest carry on; a session
  // Compass has ended is thrown back to withCompass, which signs in again and runs the steps not done yet.
  if (left.length) {
    const settled = new Set<CompassKey>();
    const compass = await withCompass(ctx, account, async s => {
      for (const key of left) {
        if (settled.has(key)) continue;
        await mark(key, "running");
        try {
          await mark(key, "done", await COMPASS[key](ctx, account, s, kind));
        } catch (e) {
          if (isNonRetryableError(e) || (e instanceof CompassError && e.code === "expired")) throw e;
          await mark(key, "failed", { note: failure(e) });
        }
        settled.add(key);
      }
    });
    if (!compass.ok) {
      // Signed out or password changed: the account (and this run) is gone already, and no retry would bring it back.
      if (compass.code === "signed-out" || compass.code === "password-changed") return;
      for (const key of left) if (!settled.has(key)) await mark(key, "failed", { note: compass.message });
    }
  }

  if (run.steps.some(s => s.source === "connect")) await runConnect(ctx, account, run, markIn("connect"));
  if (run.steps.some(s => s.source === "canvas")) await runCanvas(ctx, account, run, markIn("canvas"));
  await ctx.runMutation(internal.sync.finish, { runId: run._id });
}

async function runConnect(ctx: ActionCtx, account: Doc<"accounts">, run: Doc<"syncs">, mark: Mark) {
  const left = new Set(run.steps.filter(s => s.source === "connect" && !isSettled(s.status)).map(s => s.key as ConnectKey));
  if (!left.size) return;

  const grades = await ctx.runQuery(internal.connect.cached, { accountId: account._id, kind: "grades" });
  const refused = grades && !grades.data && grades.error && Date.now() - grades.checkedAt < RETRY_REFUSED;
  if (refused && run.reason !== "manual" && run.reason !== "sign-in") {
    for (const key of CONNECT_STEPS) if (left.has(key)) await mark(key, "skipped", { note: grades.error });
    return;
  }

  const store = (kind: string, value: { data: unknown } | { error: string }) =>
    ctx.runMutation(internal.connect.store, { accountId: account._id, kind, ...value });

  // A run picked up again after its classes step finds them where that step kept them.
  let classes: ConnectClass[] = [];
  if (!left.has("classes")) {
    const kept = await ctx.runQuery(internal.connect.cached, { accountId: account._id, kind: "classes" });
    classes = (kept?.data as ConnectClass[] | undefined) ?? [];
  }
  const STEPS: Record<Exclude<ConnectKey, "signin">, (c: ConnectSession) => Promise<Outcome>> = {
    async classes(c) {
      classes = await c.getClasses();
      await store("classes", { data: classes });
      return { count: classes.length };
    },
    async notices(c) {
      const all: ConnectNotice[] = [];
      for (const k of classes.filter(k => !k.finished).slice(0, 8)) all.push(...(await c.getNotices(k.classId, 10)));
      const latest = all.sort((a, b) => (b.at ?? "").localeCompare(a.at ?? "")).slice(0, 40);
      await store("notices", { data: latest });
      return { count: latest.length };
    },
    async grades(c) {
      const subjects = await c.getGrades();
      await store("grades", { data: subjects });
      return { count: new Set(subjects.map(s => s.subject)).size };
    },
    /** Each current class's submission board, for the to-do list (convex/work.ts). */
    work: c => fetchConnectWork(ctx, account, c, classes),
    attendance: c => fetchConnectAttendance(ctx, account, c),
  };
  const outOfDate = "Connect did not answer, so these may be out of date.";

  if (left.has("signin")) await mark("signin", "running");
  const r = await withConnect(ctx, account, async c => {
    // withConnect has signed in (or found Connect's session still open) by the time this runs.
    if (left.has("signin")) {
      const me = await c.whoami();
      await mark("signin", "done", { note: me.school ?? undefined });
      left.delete("signin");
    }
    for (const key of ["classes", "notices", "grades", "work", "attendance"] as const) {
      if (!left.has(key)) continue;
      await mark(key, "running");
      try {
        await mark(key, "done", await STEPS[key](c));
      } catch (e) {
        if (isNonRetryableError(e) || (e instanceof ConnectError && e.code === "expired")) throw e;
        await mark(key, "failed", { note: failure(e) });
        if (key === "grades") await store("grades", { error: grades?.data ? outOfDate : failure(e) });
      }
      left.delete(key);
    }
  });
  if (!r.ok) {
    // A refusal is shown in place of the grades; a hiccup keeps the last grades and says they could not be updated.
    if (left.has("grades")) await store("grades", { error: r.code === "upstream" && grades?.data ? outOfDate : r.message });
    // No sign-in: the sign-in step failed and the rest never started. Otherwise the steps left failed with it.
    const signedIn = !left.has("signin");
    for (const key of CONNECT_STEPS) {
      if (!left.has(key)) continue;
      await mark(key, signedIn || key === "signin" ? "failed" : "skipped", { note: r.message });
    }
  }
}

/**
 * Canvas's steps: the courses, then each course's assignments, the grades worked out from them, then the courses'
 * announcements. A step that fails on its own
 * is marked and the rest carry on (a run picked up again reads the courses where the courses step kept them); a token
 * Canvas refuses fails what is left, and lib/canvas.ts notes it on the account so later runs leave Canvas alone.
 */
async function runCanvas(ctx: ActionCtx, account: Doc<"accounts">, run: Doc<"syncs">, mark: Mark) {
  const left = new Set(run.steps.filter(s => s.source === "canvas" && !isSettled(s.status)).map(s => s.key as CanvasKey));
  if (!left.size) return;
  // The courses as last kept: what a run picked up again starts from, and what the later steps use if the courses step
  // fails this time (so a Canvas hiccup never reads as no courses, and wipes their announcements).
  const kept = await ctx.runQuery(internal.cache.get, { accountId: account._id, store: "canvas", kind: "courses" });
  let courses: CanvasCourse[] = (kept?.data as CanvasCourse[] | null) ?? [];
  const STEPS: Record<CanvasKey, (s: CanvasSession) => Promise<Outcome>> = {
    async courses(s) {
      const r = await fetchCourses(ctx, account, s);
      courses = r.courses;
      return r.outcome;
    },
    work: s => fetchCanvasWork(ctx, account, s, courses),
    /** Worked out from what the two steps before kept (canvas.ts keepGrades): no call to Canvas. */
    grades: async () => ({ count: await ctx.runMutation(internal.canvas.keepGrades, { accountId: account._id }) }),
    announcements: async s => (courses.length ? fetchCanvasAnnouncements(ctx, account, s, courses) : { count: 0, note: "No courses yet" }),
  };
  const r = await withCanvas(ctx, account, async s => {
    for (const key of CANVAS_STEPS) {
      if (!left.has(key)) continue;
      await mark(key, "running");
      try {
        await mark(key, "done", await STEPS[key](s));
      } catch (e) {
        if (isNonRetryableError(e) || (e instanceof CanvasError && e.code === "bad-token")) throw e;
        await mark(key, "failed", { note: failure(e) });
      }
      left.delete(key);
    }
  });
  if (!r.ok) for (const key of CANVAS_STEPS) if (left.has(key)) await mark(key, "failed", { note: r.message });
}

// ---------- internals ----------

/** A step starting or ending. Says whether the run is still on (false once it is over, or gone with its account). */
export const step = internalMutation({
  args: {
    runId: v.id("syncs"),
    key: v.string(),
    source: sourceV,
    status: statusV,
    count: v.optional(v.number()),
    note: v.optional(v.string()),
  },
  handler: async (ctx, { runId, key, source, status, count, note }): Promise<boolean> => {
    const run = await ctx.db.get(runId);
    if (!run || run.finishedAt) return false;
    const at = Date.now();
    await ctx.db.patch(runId, {
      aliveAt: at,
      steps: run.steps.map(s => (s.key === key && s.source === source ? { key, source, status, count, note: note?.slice(0, 200), at } : s)),
    });
    return true;
  },
});

/** The job's own end: anything it did not get to is marked skipped. */
export const finish = internalMutation({
  args: { runId: v.id("syncs") },
  handler: async (ctx, { runId }) => {
    const run = await ctx.db.get(runId);
    if (run && !run.finishedAt) await settle(ctx, run, "skipped");
  },
});

/** Keeps what a Compass step fetched, replacing the last. */
export const keep = internalMutation({
  args: { accountId: v.id("accounts"), kind: v.string(), data: v.any() },
  handler: async (ctx, { accountId, kind, data }) => {
    if (!(await ctx.db.get(accountId))) return;
    const row = await ctx.db.query("compassCache").withIndex("by_account_kind", i => i.eq("accountId", accountId).eq("kind", kind)).unique();
    if (row) await ctx.db.patch(row._id, { data, fetchedAt: Date.now() });
    else await ctx.db.insert("compassCache", { accountId, kind, data, fetchedAt: Date.now() });
  },
});
