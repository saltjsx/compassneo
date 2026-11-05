import { v } from "convex/values";
import { action, internalMutation, mutation, query, type ActionCtx, type MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  CanvasError,
  CanvasSession,
  canvasOrigin,
  cleanToken,
  type CanvasAnnouncement,
  type CanvasAssignment,
  type CanvasCourse,
  type CanvasGroup,
} from "@compassneo/canvas";
import { deviceAccount, type Problem } from "./lib/compass";
import { seal } from "./lib/crypto";
import { accountFor, semesterOf } from "./timetable";
import { begin } from "./sync";
import { canvasGrades } from "./lib/grades";
import { recordGrades, type History } from "./lib/history";
import { schoolToday } from "./lib/days";
import { canvasView, currentClasses } from "./lib/courses";

/**
 * Canvas, beside Compass: a student whose school runs Canvas adds it from their profile with the school's Canvas
 * address and an access token of their own (packages/canvas says why a token). From then on the sync reads it after
 * Compass: the student's courses (with their scores), each course's assignments with the student's own submission,
 * and the courses' announcements. Each is kept in canvasCache, shown beside Compass's and Connect's: the to-do list on
 * home, each class's Work and notices (the class's course is found by lib/match.ts matchCourses), and the calendar feed.
 *
 * Read-only: nothing is ever handed in or marked read on Canvas. A token Canvas stops accepting (deleted, expired) is
 * noted on the account and Canvas is left alone until a new one is added; Compass carries on as before.
 */

/** Assignments kept per course as work: due in the last few months or later, or undated. */
const KEEP_DAYS = 120;
const MAX_ASSIGNMENTS = 150;
/** Marks kept per course for grades: every assignment that counts, all year. */
const MAX_MARKS = 400;
/** A description's cap, and all of a course's descriptions together, in bytes (a row holds at most 1 MiB). */
const MAX_DESCRIPTION = 6000;
const DESCRIPTION_BUDGET = 600_000;
/** Courses read per sync, at most: a student has a dozen or so, but a school can enrol them in many notice courses. */
const MAX_COURSES = 40;
/** Announcements: the last three weeks', at most this many. */
const ANNOUNCEMENT_DAYS = 21;
const MAX_ANNOUNCEMENTS = 40;

/**
 * A course's work row: its recent and coming assignments (descriptions kept apart, in its text row, so the queries
 * that read every course's work stay small), its assignment groups, and every assignment that counts towards a grade
 * all year (marks), for the grades step.
 */
export type CanvasWork = { assignments: CanvasAssignment[]; groups: CanvasGroup[]; marks?: CanvasAssignment[] };
export const workKind = (courseId: string) => `work:${courseId}`;
/** A course's assignments' descriptions, by assignment id (the class panel's Work reads these; nothing else does). */
export const textKind = (courseId: string) => `text:${courseId}`;

export type CanvasStatus =
  | { added: false }
  | {
      added: true;
      host: string;
      /** Who Canvas says the token is. */
      name: string | null;
      /** Why Canvas stopped taking the token, when it has: then a new one is needed. */
      refused: string | null;
      courses: number | null;
      syncedAt: number | null;
    };

/** Whether this device's account has Canvas, and how it is going. */
export const status = query({
  args: { token: v.union(v.string(), v.null()) },
  handler: async (ctx, { token }): Promise<CanvasStatus | null> => {
    if (!token) return null;
    const account = await accountFor(ctx, token);
    if (!account) return null;
    if (!account.sealedCanvas || !account.canvasOrigin) return { added: false };
    const row = await ctx.db
      .query("canvasCache")
      .withIndex("by_account_kind", i => i.eq("accountId", account._id).eq("kind", "courses"))
      .unique();
    return {
      added: true,
      host: new URL(account.canvasOrigin).host,
      name: account.canvasName ?? null,
      refused: account.canvasRefused ?? null,
      courses: Array.isArray(row?.data) ? row.data.length : null,
      syncedAt: row?.fetchedAt ?? null,
    };
  },
});

/**
 * Adds Canvas (or replaces its token): checks the address and token with Canvas itself, keeps the token sealed under
 * CREDENTIALS_KEY, and starts a sync so the student's courses come in at once. Rate limited with sign-ins.
 */
export const add = action({
  args: { token: v.string(), address: v.string(), accessToken: v.string() },
  handler: async (ctx, args): Promise<{ ok: true } | Problem> => {
    const account = await deviceAccount(ctx, args.token);
    if (!account) return { ok: false, code: "signed-out", message: "This device is signed out." };
    const origin = canvasOrigin(args.address);
    if (!origin) return { ok: false, code: "unavailable", message: "Enter your school's Canvas address, such as school.instructure.com." };
    const accessToken = cleanToken(args.accessToken);
    if (!accessToken) return { ok: false, code: "unavailable", message: "Paste the access token you made in Canvas." };
    const allowed = await ctx.runMutation(internal.auth.noteAttempt, { key: `canvas:${account.key}` });
    if (!allowed) return { ok: false, code: "unavailable", message: "Too many tries. Wait ten minutes, then try again." };

    let name: string;
    try {
      name = (await new CanvasSession(origin, accessToken).whoami()).name;
    } catch (e) {
      if (!(e instanceof CanvasError)) throw e;
      if (e.code === "bad-token") return { ok: false, code: "unavailable", message: "Canvas did not accept that token. Check it was copied in full." };
      if (e.code === "not-canvas" || e.code === "not-found") return { ok: false, code: "unavailable", message: `${new URL(origin).host} did not answer as Canvas does. Check the address.` };
      if (e.code === "unreachable") return { ok: false, code: "unavailable", message: `Nothing answered at ${new URL(origin).host}. Check the address.` };
      return { ok: false, code: "upstream", message: "Canvas did not answer. Try again in a minute." };
    }
    await ctx.runMutation(internal.canvas.saved, {
      accountId: account._id,
      origin,
      name,
      sealed: await seal("CREDENTIALS_KEY", accessToken, account.key),
    });
    return { ok: true };
  },
});

async function dropRows(ctx: MutationCtx, accountId: Id<"accounts">) {
  for (const r of await ctx.db.query("canvasCache").withIndex("by_account_kind", i => i.eq("accountId", accountId)).collect()) {
    await ctx.db.delete(r._id);
  }
}

export const saved = internalMutation({
  args: { accountId: v.id("accounts"), origin: v.string(), name: v.string(), sealed: v.string() },
  handler: async (ctx, { accountId, origin, name, sealed }) => {
    const account = await ctx.db.get(accountId);
    if (!account) return;
    // Another Canvas (or another student's token) shares nothing with what was kept.
    if (account.canvasOrigin !== origin || account.canvasName !== name) await dropRows(ctx, accountId);
    await ctx.db.patch(accountId, { canvasOrigin: origin, canvasName: name, sealedCanvas: sealed, canvasRefused: undefined, updatedAt: Date.now() });
    const runId = await begin(ctx, { ...account, canvasOrigin: origin, canvasName: name, sealedCanvas: sealed, canvasRefused: undefined }, "manual", true, Date.now());
    // A run already in flight (the app opening) answers for this one, without Canvas in it: ask again once it is done.
    if (!runId) await ctx.scheduler.runAfter(KICK_AFTER, internal.canvas.kick, { accountId, tries: 1 });
  },
});

const KICK_AFTER = 45 * 1000;

/** Starts the run that brings a newly added Canvas in, once the account has no other run in flight. */
export const kick = internalMutation({
  args: { accountId: v.id("accounts"), tries: v.number() },
  handler: async (ctx, { accountId, tries }) => {
    const account = await ctx.db.get(accountId);
    if (!account?.sealedCanvas || account.canvasRefused) return;
    const courses = await ctx.db.query("canvasCache").withIndex("by_account_kind", i => i.eq("accountId", accountId).eq("kind", "courses")).unique();
    if (courses) return;
    const runId = await begin(ctx, account, "manual", true, Date.now());
    if (!runId && tries < 6) await ctx.scheduler.runAfter(KICK_AFTER, internal.canvas.kick, { accountId, tries: tries + 1 });
  },
});

/** Removes Canvas: the token and everything kept from it. */
export const remove = mutation({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const account = await accountFor(ctx, token);
    if (!account) return;
    await dropRows(ctx, account._id);
    await ctx.db.patch(account._id, { canvasOrigin: undefined, canvasName: undefined, sealedCanvas: undefined, canvasRefused: undefined, updatedAt: Date.now() });
  },
});

/** Canvas has stopped accepting the token (lib/canvas.ts): noted, so the sync stops asking and the profile says so. */
export const refused = internalMutation({
  /** sealed: the token that was refused. A new one added since is left alone (the old one's refusal says nothing of it). */
  args: { accountId: v.id("accounts"), message: v.string(), sealed: v.string() },
  handler: async (ctx, { accountId, message, sealed }) => {
    const account = await ctx.db.get(accountId);
    if (account && account.sealedCanvas === sealed) await ctx.db.patch(accountId, { canvasRefused: message });
  },
});

// ---------- the sync's steps (convex/sync.ts) ----------

const put = (ctx: ActionCtx, accountId: Id<"accounts">, kind: string, value: { data: unknown } | { error: string }) =>
  ctx.runMutation(internal.cache.put, { accountId, store: "canvas", kind, ...value });

/** The student's current courses, with their scores. */
export async function fetchCourses(ctx: ActionCtx, account: Doc<"accounts">, s: CanvasSession) {
  const courses = (await s.getCourses()).slice(0, MAX_COURSES);
  await put(ctx, account._id, "courses", { data: courses });
  return { courses, outcome: { count: courses.length } };
}

const enc = new TextEncoder();

/**
 * What a course's assignments are kept as: the recent and coming ones without their descriptions (work), every one that
 * counts towards a grade, lean (marks), and the descriptions on their own (text), each capped and, together, kept under
 * DESCRIPTION_BUDGET bytes, soonest due first.
 */
function split(assignments: CanvasAssignment[], groups: CanvasGroup[], now: number) {
  const from = new Date(now - KEEP_DAYS * 86400 * 1000).toISOString();
  const recent = assignments
    .filter(a => !a.due || a.due >= from)
    .sort((a, b) => (b.due ?? "9999").localeCompare(a.due ?? "9999"))
    .slice(0, MAX_ASSIGNMENTS);
  const text: Record<string, string> = {};
  let bytes = 0;
  for (const a of recent) {
    // Cut at the cap, and back to before a tag the cut fell inside, so no half a tag shows as text.
    const d = a.description?.slice(0, MAX_DESCRIPTION).replace(/<[^>]*$/, "");
    if (!d) continue;
    const n = enc.encode(d).length;
    if (bytes + n > DESCRIPTION_BUDGET) continue;
    text[a.id] = d;
    bytes += n;
  }
  const lean = (a: CanvasAssignment): CanvasAssignment => ({ ...a, description: null });
  const marks = assignments.filter(a => (a.points ?? 0) > 0 && !a.omitted).slice(0, MAX_MARKS).map(lean);
  return { work: { assignments: recent.map(lean), groups, marks } satisfies CanvasWork, text };
}

/** One course's assignments and groups, kept as its work row and its text row. */
export async function fetchCourseWork(ctx: ActionCtx, account: Doc<"accounts">, s: CanvasSession, courseId: string) {
  try {
    const [assignments, groups] = await Promise.all([s.getAssignments(courseId), s.getGroups(courseId).catch(() => [] as CanvasGroup[])]);
    const { work: data, text } = split(assignments, groups, Date.now());
    await put(ctx, account._id, textKind(courseId), { data: text });
    await put(ctx, account._id, workKind(courseId), { data });
    return data;
  } catch (e) {
    if (e instanceof CanvasError && e.code === "bad-token") throw e;
    await put(ctx, account._id, workKind(courseId), { error: e instanceof Error && e.message ? e.message : "Canvas did not answer." });
    return null;
  }
}

/**
 * Every course's assignments, a course at a time. A course Canvas will not show is kept as its error and the rest
 * carry on. The count is the assignments still to hand in.
 */
export async function fetchWork(ctx: ActionCtx, account: Doc<"accounts">, s: CanvasSession, courses: CanvasCourse[]) {
  const now = Date.now();
  let open = 0;
  let failed = 0;
  for (const c of courses) {
    const w = await fetchCourseWork(ctx, account, s, c.id);
    if (!w) failed++;
    else open += w.assignments.filter(a => ["todo", "overdue"].includes(canvasState(a, now))).length;
  }
  return { count: open, note: `${courses.length} ${courses.length === 1 ? "course" : "courses"}${failed ? `, ${failed} did not answer` : ""}` };
}

export async function fetchAnnouncements(ctx: ActionCtx, account: Doc<"accounts">, s: CanvasSession, courses: CanvasCourse[]) {
  const since = new Date(Date.now() - ANNOUNCEMENT_DAYS * 86400 * 1000).toISOString();
  const list: CanvasAnnouncement[] = await s.getAnnouncements(
    courses.map(c => c.id),
    since,
    MAX_ANNOUNCEMENTS,
  );
  await put(ctx, account._id, "announcements", { data: list });
  return { count: list.length };
}

/**
 * The sync's grades step: Canvas's grades in Connect's shape (lib/grades.ts canvasGrades), from the courses and work
 * the steps before it kept, with the grade history moved on as Connect's is (lib/history.ts). Reads and writes only
 * what is kept, so it is one mutation. The count is the subjects with a grade.
 */
export const keepGrades = internalMutation({
  args: { accountId: v.id("accounts") },
  handler: async (ctx, { accountId }): Promise<number> => {
    const account = await ctx.db.get(accountId);
    if (!account) return 0;
    const row = (kind: string) => ctx.db.query("canvasCache").withIndex("by_account_kind", i => i.eq("accountId", accountId).eq("kind", kind)).unique();
    const courses = ((await row("courses"))?.data ?? []) as CanvasCourse[];
    const works = new Map<string, CanvasWork>();
    for (const c of courses) {
      const w = (await row(workKind(c.id)))?.data as CanvasWork | undefined;
      if (w) works.set(c.id, w);
    }
    // Which class each course is, and where a mark in a course no class claims belongs (as for work: lib/courses.ts).
    const view = await canvasView(ctx, account, await currentClasses(ctx, account));
    const courseOf = new Map([...(view?.codeOf ?? [])].map(([id, code]) => [code, id]));
    const home = (a: CanvasAssignment) => {
      const code = view?.classOf(a);
      return code ? (courseOf.get(code) ?? null) : null;
    };
    const subjects = canvasGrades(courses, works, semesterOf(schoolToday(account.slug)), home, new Set(view?.codeOf.keys() ?? []));
    const now = Date.now();
    const put = async (kind: string, data: unknown) => {
      const r = await row(kind);
      if (r) await ctx.db.patch(r._id, { data, error: undefined, fetchedAt: now, checkedAt: now });
      else await ctx.db.insert("canvasCache", { accountId, kind, data, fetchedAt: now, checkedAt: now });
    };
    await put("grades", subjects);
    const kept = await row("history");
    const history = recordGrades((kept?.data as History | undefined) ?? null, subjects, now);
    if (!kept || JSON.stringify(kept.data) !== JSON.stringify(history)) await put("history", history);
    return subjects.length;
  },
});

// ---------- where an assignment stands ----------

/** Ways of handing in that happen on Canvas itself, so Canvas knows whether it went in. */
const ONLINE = new Set(["online_upload", "online_text_entry", "online_url", "media_recording", "online_quiz", "discussion_topic", "external_tool", "student_annotation"]);

/** Whether Canvas takes the work itself (else it goes in on paper, or there is nothing to hand in). */
export const handedInOnline = (a: CanvasAssignment) => a.types.some(t => ONLINE.has(t));

/**
 * Where an assignment stands for the student, from their own submission (never from Canvas's list of what is coming
 * up, which keeps work already handed in): handed in (late or not), excused or locked (closed), Canvas marking it
 * missing or its date passing (overdue), still to do, or "none" when it is not handed in on Canvas.
 */
export function canvasState(a: CanvasAssignment, now: number): "todo" | "overdue" | "submitted" | "late" | "closed" | "none" {
  const s = a.submission;
  if (s?.excused) return "closed";
  if (s && (s.submittedAt || s.state === "submitted" || s.state === "pending_review")) return s.late ? "late" : "submitted";
  if (s?.state === "graded" && (s.score != null || s.grade)) return "submitted";
  if (!handedInOnline(a)) return "none";
  if (s?.missing) return "overdue";
  if (a.lockAt && Date.parse(a.lockAt) < now && (!a.due || Date.parse(a.due) < now)) return "closed";
  if (a.due && Date.parse(a.due) < now) return "overdue";
  return "todo";
}
