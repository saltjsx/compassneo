import { v } from "convex/values";
import { action, internalMutation, internalQuery, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { CompassError, getLessonPlan } from "@compassneo/compass";
import { deviceAccount, withCompass, type Problem } from "./lib/compass";
import { parsePlan, type PlanBlock } from "./lib/plan";
import { accountFor } from "./timetable";

/**
 * Lesson plans: what a teacher wrote in Compass for one lesson, kept per account as a compassCache row
 * ("plan:<lesson instance id>", data null when the lesson has no plan). Fetched when the app asks for lessons it is
 * about to show (load); the panel reads them with forLessons. Most lessons have no plan, and that answer costs one
 * Compass call; a plan costs two (the lesson's page, then its file).
 */

/** A plan is asked about again after this long: teachers write them up the day before and change them on the day. */
const FRESH = 3 * 3600 * 1000;
/** Plans are forgotten this long after they were fetched. */
const FORGET = 30 * 86400 * 1000;
/** Lessons one load call will fetch. */
const MAX_PER_LOAD = 16;

const kindOf = (id: string) => `plan:${id}`;

export type LessonPlan = { blocks: PlanBlock[]; fetchedAt: number };

/** The plans kept for these lessons: a plan, null for a lesson known to have none; a lesson not looked at is left out. */
export const forLessons = query({
  args: { token: v.union(v.string(), v.null()), ids: v.array(v.string()) },
  handler: async (ctx, { token, ids }): Promise<Record<string, LessonPlan | null>> => {
    if (!token) return {};
    const account = await accountFor(ctx, token);
    if (!account) return {};
    const out: Record<string, LessonPlan | null> = {};
    for (const id of ids.slice(0, 60)) {
      const row = await ctx.db
        .query("compassCache")
        .withIndex("by_account_kind", i => i.eq("accountId", account._id).eq("kind", kindOf(id)))
        .unique();
      if (row) out[id] = row.data ? { blocks: row.data as PlanBlock[], fetchedAt: row.fetchedAt } : null;
    }
    return out;
  },
});

export const due = internalQuery({
  args: { accountId: v.id("accounts"), ids: v.array(v.string()) },
  handler: async (ctx, { accountId, ids }) => {
    const now = Date.now();
    const out: string[] = [];
    for (const id of ids) {
      const row = await ctx.db.query("compassCache").withIndex("by_account_kind", i => i.eq("accountId", accountId).eq("kind", kindOf(id))).unique();
      if (!row || now - row.fetchedAt > FRESH) out.push(id);
    }
    return out;
  },
});

export const save = internalMutation({
  args: { accountId: v.id("accounts"), plans: v.array(v.object({ id: v.string(), blocks: v.union(v.any(), v.null()) })) },
  handler: async (ctx, { accountId, plans }) => {
    if (!(await ctx.db.get(accountId))) return;
    const now = Date.now();
    for (const { id, blocks } of plans) {
      const kind = kindOf(id);
      const row = await ctx.db.query("compassCache").withIndex("by_account_kind", i => i.eq("accountId", accountId).eq("kind", kind)).unique();
      if (row) await ctx.db.patch(row._id, { data: blocks, fetchedAt: now });
      else await ctx.db.insert("compassCache", { accountId, kind, data: blocks, fetchedAt: now });
    }
    // Forget plans nobody has looked at in a month.
    const old = await ctx.db
      .query("compassCache")
      .withIndex("by_account_kind", i => i.eq("accountId", accountId).gte("kind", "plan:").lt("kind", "plan;"))
      .collect();
    for (const r of old) if (now - r.fetchedAt > FORGET) await ctx.db.delete(r._id);
  },
});

/** Fetches the plans of these lessons that are not kept yet, or were fetched a while ago. */
export const load = action({
  args: { token: v.string(), ids: v.array(v.string()) },
  handler: async (ctx, { token, ids }): Promise<{ ok: true; fetched: number } | Problem> => {
    const account = await deviceAccount(ctx, token, { reader: true });
    if (!account) return { ok: false, code: "signed-out", message: "This device is signed out." };
    const wanted = [...new Set(ids.filter(id => /^[\w-]{6,80}$/.test(id)))];
    const due: string[] = await ctx.runQuery(internal.plans.due, { accountId: account._id, ids: wanted });
    const todo = due.slice(0, MAX_PER_LOAD);
    if (!todo.length) return { ok: true, fetched: 0 };
    const r = await withCompass(ctx, account, async s => {
      const plans: Array<{ id: string; blocks: PlanBlock[] | null }> = [];
      for (const id of todo) {
        try {
          const html = await getLessonPlan(s, id);
          const blocks = html ? parsePlan(html) : [];
          plans.push({ id, blocks: blocks.length ? blocks : null });
        } catch (e) {
          // An ended session goes back to withCompass to sign in again; a lesson Compass refuses is skipped this time.
          if (e instanceof CompassError && e.code === "expired") throw e;
        }
      }
      return plans;
    });
    if (!r.ok) return r;
    if (r.value.length) await ctx.runMutation(internal.plans.save, { accountId: account._id, plans: r.value });
    return { ok: true, fetched: r.value.length };
  },
});
