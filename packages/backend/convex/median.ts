import { v } from "convex/values";
import { signMedianUser } from "@mediansh/agent-tools";
import { action, internalMutation, internalQuery, type QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { hashToken } from "./lib/crypto";
import { isWA } from "./lib/connect";
import { addDays, schoolToday } from "./lib/days";
import { shortName, subjectName } from "./lib/match";
import { compassRow, type StoredClass } from "./timetable";
import { begin } from "./sync";
import { live } from "./accounts";

/**
 * Median, the support agent behind the help button (lib/median.ts has its tools, http.ts serves them).
 *
 * A student is known to Median by their account key ("<school>:<username>"), which outlives signing out and back in
 * (the account row does not). The widget is told it by `identity`, signed with MEDIAN_KEY here on the server, so a tool
 * reading `context.visitor.externalId` knows the id came from us and not from the chat. Every lookup below takes that
 * key, never anything a visitor typed.
 */

/** Who this device is, signed for Median, or null when it is signed out. */
export const identity = action({
  args: { token: v.string() },
  handler: async (ctx, { token }): Promise<{ id: string; hash: string; name: string } | null> => {
    const found = await ctx.runQuery(internal.accounts.byTokenHash, { tokenHash: await hashToken(token) });
    if (!found) return null;
    const { account } = found;
    return { id: account.key, hash: await signMedianUser(account.key), name: account.fullName ?? account.displayName };
  },
});

const byKey = (ctx: QueryCtx, key: string) => ctx.db.query("accounts").withIndex("by_key", i => i.eq("key", key)).unique();

/** The account's standing: its school, whether its saved login still works, and when Compass and Connect last let it in. */
export const account = internalQuery({
  args: { key: v.string() },
  handler: async (ctx, { key }) => {
    const found = await byKey(ctx, key);
    if (!found) return null;
    const a = await live(ctx, found);
    const devices = await ctx.db.query("sessions").withIndex("by_account", i => i.eq("accountId", a._id)).collect();
    return {
      school: a.schoolName,
      formGroup: a.formGroup ?? null,
      savedLogin: !!a.sealedLogin,
      connect: isWA(a.slug),
      connectLinked: !!a.sealedConnect,
      compassSessionAt: new Date(a.compassAt).toISOString(),
      connectSessionAt: a.connectAt ? new Date(a.connectAt).toISOString() : null,
      devices: devices.length,
      lastOpenedAt: devices.length ? new Date(Math.max(...devices.map(d => d.lastSeenAt))).toISOString() : null,
      signedUpAt: new Date(a.createdAt).toISOString(),
    };
  },
});

/** The account's last few sync runs, newest first: what ran, when, and every step that did not go through. */
export const syncs = internalQuery({
  args: { key: v.string() },
  handler: async (ctx, { key }) => {
    const a = await byKey(ctx, key);
    if (!a) return null;
    const runs = await ctx.db.query("syncs").withIndex("by_account", i => i.eq("accountId", a._id)).order("desc").take(5);
    return runs.map(r => ({
      kind: r.kind ?? "full",
      reason: r.reason,
      startedAt: new Date(r.startedAt).toISOString(),
      finishedAt: r.finishedAt ? new Date(r.finishedAt).toISOString() : null,
      inFlight: !r.finishedAt,
      steps: r.steps.length,
      done: r.steps.filter(s => s.status === "done").length,
      problems: r.steps
        .filter(s => s.status === "failed" || s.status === "skipped")
        .map(s => ({ step: s.key, source: s.source, status: s.status, note: s.note ?? null })),
    }));
  },
});

/**
 * A full sync, as "Sync now" asks for one. A run already in flight answers it instead (sync.ts keeps one run per
 * account), so a retried or doubled call never queues a second.
 */
export const syncNow = internalMutation({
  args: { key: v.string() },
  handler: async (ctx, { key }) => {
    const a = await byKey(ctx, key);
    if (!a) return null;
    const runId = await begin(ctx, a, "manual", true, Date.now());
    return { queued: !!runId };
  },
});

/** The classes the student takes now (as the list on home has them): code, short name and full subject. */
export const classes = internalQuery({
  args: { key: v.string() },
  handler: async (ctx, { key }) => {
    const a = await byKey(ctx, key);
    if (!a) return null;
    const since = addDays(schoolToday(a.slug), -28);
    const stored = ((await compassRow(ctx, a._id, "classes"))?.data ?? []) as StoredClass[];
    return stored.filter(c => c.lastSeen >= since).map(c => ({ code: c.code, name: shortName(c.subject, c.code), subject: subjectName(c.subject, c.code) }));
  },
});

/**
 * The account's Canvas: whether the student has added it, where, whether Canvas still takes their token, and when its
 * courses last came in. Never the token, nor anything from the courses.
 */
export const canvas = internalQuery({
  args: { key: v.string() },
  handler: async (ctx, { key }) => {
    const a = await byKey(ctx, key);
    if (!a) return null;
    if (!a.sealedCanvas || !a.canvasOrigin) return { added: false as const };
    const courses = await ctx.db
      .query("canvasCache")
      .withIndex("by_account_kind", i => i.eq("accountId", a._id).eq("kind", "courses"))
      .unique();
    return {
      added: true as const,
      address: new URL(a.canvasOrigin).host,
      tokenRefused: !!a.canvasRefused,
      refusedReason: a.canvasRefused ?? null,
      courses: Array.isArray(courses?.data) ? courses.data.length : null,
      lastSyncedAt: courses?.fetchedAt ? new Date(courses.fetchedAt).toISOString() : null,
    };
  },
});
