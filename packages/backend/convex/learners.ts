import { v } from "convex/values";
import { action, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { getLearners, type Learner } from "@compassneo/connect";
import { deviceAccount, type Problem } from "./lib/compass";
import { withConnect } from "./lib/connect";
import { fileLink } from "./lib/links";
import { classTarget } from "./lib/target";
import { accountFor } from "./timetable";
import { readRow, sideOf, type Side } from "./cache";

/**
 * Classmates: everyone in the class on Connect (Compass refuses class lists to students). Fetched when the class panel
 * asks, kept a day. Photos are the ones people chose on Connect, through Compass Neo's file route.
 */

const FRESH = 24 * 3600 * 1000;
const kindOf = (classId: number) => `learners:${classId}`;

export type Classmate = { id: number; name: string; first: string | null; last: string | null; photoUrl: string | null; me: boolean };

export const forClass = query({
  args: { token: v.union(v.string(), v.null()), code: v.string() },
  handler: async (ctx, { token, code }): Promise<{ learners: Side<Classmate[]>; connectClass: { name: string; code: string | null } | null } | null> => {
    if (!token || !code) return null;
    const account = await accountFor(ctx, token);
    if (!account) return null;
    const t = await classTarget(ctx, account, code);
    if (!t.connect) return { learners: { status: "none" }, connectClass: null };
    const side = sideOf(await readRow(ctx, account._id, "connect", kindOf(t.connect.classId)), d => d as Learner[]);
    let learners: Side<Classmate[]> = side.status === "ready" ? { ...side, data: [] } : side;
    if (side.status === "ready") {
      const out: Classmate[] = [];
      for (const l of side.data) {
        out.push({
          id: l.id,
          name: l.name,
          first: l.first,
          last: l.last,
          photoUrl: l.avatarPath ? await fileLink(account._id, "connect", l.avatarPath, `${l.name}.jpg`) : null,
          me: l.me,
        });
      }
      out.sort((a, b) => Number(b.me) - Number(a.me) || (a.first ?? a.name).localeCompare(b.first ?? b.name));
      learners = { ...side, data: out };
    }
    return { learners, connectClass: { name: t.connect.name, code: t.connect.code } };
  },
});

export const load = action({
  args: { token: v.string(), code: v.string(), force: v.optional(v.boolean()) },
  handler: async (ctx, { token, code, force }): Promise<{ ok: true } | Problem> => {
    const account = await deviceAccount(ctx, token, { reader: true });
    if (!account) return { ok: false, code: "signed-out", message: "This device is signed out." };
    const t = await ctx.runQuery(internal.resources.target, { accountId: account._id, code });
    if (!t?.connect) return { ok: true };
    const classId = t.connect.classId;
    const row = await ctx.runQuery(internal.cache.get, { accountId: account._id, store: "connect", kind: kindOf(classId) });
    if (!force && row && Date.now() - row.checkedAt < FRESH) return { ok: true };
    const r = await withConnect(ctx, account, c => getLearners(c, classId));
    await ctx.runMutation(internal.cache.put, { accountId: account._id, store: "connect", kind: kindOf(classId), ...(r.ok ? { data: r.value } : { error: r.message }) });
    return { ok: true };
  },
});
