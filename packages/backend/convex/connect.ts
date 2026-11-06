import { v } from "convex/values";
import { internalMutation, internalQuery, query } from "./_generated/server";
import { scoreOf, type Score, type SubjectGrade } from "@compassneo/connect";
import { hashToken } from "./lib/crypto";
import { same, STAMP_EVERY } from "./lib/same";
import { isWA } from "./lib/connect";
import { recordGrades, type History } from "./lib/history";

export type Grades =
  | { status: "unavailable"; reason: string }
  | { status: "loading" }
  | { status: "ready"; fetchedAt: number; subjects: GradedSubject[]; error: string | null };

/** A subject as the app shows it: Connect's own figures (cumulativePercent is often missing), and its score worked out
 * from the assessment outline's tasks. Worked out here, not when fetched, so grades cached earlier get it too. */
export type GradedSubject = SubjectGrade & { score: Score };

const graded = (subjects: SubjectGrade[]): GradedSubject[] =>
  subjects.map(s => ({
    ...s,
    // Older fetches stored Connect's unreadable overall mark as NaN.
    cumulativePercent: typeof s.cumulativePercent === "number" && Number.isFinite(s.cumulativePercent) ? s.cumulativePercent : null,
    score: scoreOf(s.tasks),
  }));

/** The device's grades as last fetched from Connect. Reactive: a refresh lands here on its own. */
export const grades = query({
  args: { token: v.union(v.string(), v.null()) },
  handler: async (ctx, { token }): Promise<Grades | null> => {
    if (!token) return null;
    const tokenHash = await hashToken(token);
    const session = await ctx.db.query("sessions").withIndex("by_token", i => i.eq("tokenHash", tokenHash)).first();
    const account = session && (await ctx.db.get(session.accountId));
    if (!account) return null;
    if (!isWA(account.slug)) return { status: "unavailable", reason: "Connect is only for WA public schools." };
    const cached = await ctx.db
      .query("connectCache")
      .withIndex("by_account_kind", i => i.eq("accountId", account._id).eq("kind", "grades"))
      .unique();
    if (cached?.data) return { status: "ready", fetchedAt: cached.fetchedAt ?? cached.checkedAt, subjects: graded(cached.data as SubjectGrade[]), error: cached.error ?? null };
    if (cached?.error) return { status: "unavailable", reason: cached.error };
    if (!account.sealedLogin) return { status: "unavailable", reason: "Sign in again so Compass Neo can open Connect for you." };
    return { status: "loading" };
  },
});

// ---------- internals ----------

export const cached = internalQuery({
  args: { accountId: v.id("accounts"), kind: v.string() },
  handler: (ctx, { accountId, kind }) =>
    ctx.db.query("connectCache").withIndex("by_account_kind", i => i.eq("accountId", accountId).eq("kind", kind)).unique(),
});

export const store = internalMutation({
  args: { accountId: v.id("accounts"), kind: v.string(), data: v.optional(v.any()), error: v.optional(v.string()) },
  handler: async (ctx, { accountId, kind, data, error }) => {
    if (!(await ctx.db.get(accountId))) return;
    const row = await ctx.db.query("connectCache").withIndex("by_account_kind", i => i.eq("accountId", accountId).eq("kind", kind)).unique();
    // An error keeps the last good data (and when it was fetched) beside it; new data clears the error.
    // The same again is not written, bar the time once it is STAMP_EVERY old (lib/same.ts).
    const now = Date.now();
    const next = data !== undefined ? { data, error: undefined, fetchedAt: now, checkedAt: now } : { error, checkedAt: now };
    if (!row) await ctx.db.insert("connectCache", { accountId, kind, ...next });
    else {
      const unchanged = data !== undefined ? row.error === undefined && same(row.data, data) : row.error === error;
      if (!unchanged) await ctx.db.patch(row._id, next);
      else if (now - row.checkedAt > STAMP_EVERY) await ctx.db.patch(row._id, data !== undefined ? { fetchedAt: now, checkedAt: now } : { checkedAt: now });
    }

    // Fresh grades move the history on (lib/history.ts): a point when a score moves, a date when a mark appears.
    if (kind === "grades" && Array.isArray(data)) {
      const kept = await ctx.db.query("connectCache").withIndex("by_account_kind", i => i.eq("accountId", accountId).eq("kind", "history")).unique();
      const history = recordGrades((kept?.data as History | undefined) ?? null, data as SubjectGrade[], now);
      if (kept) {
        if (!same(kept.data, history)) await ctx.db.patch(kept._id, { data: history, fetchedAt: now, checkedAt: now });
      } else await ctx.db.insert("connectCache", { accountId, kind: "history", data: history, fetchedAt: now, checkedAt: now });
    }
  },
});
