import { v } from "convex/values";
import { internalMutation, internalQuery, type QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { same, STAMP_EVERY } from "./lib/same";

/**
 * Rows of what Compass, Connect and Canvas last said, by kind ("resources:25860", "attendance", ...), for the modules
 * added after the sync's own steps: resources, work, learners, attendance, events, chronicle, and everything from
 * Canvas. A row keeps its data and when it was fetched; on the Connect and Canvas sides an error is kept beside the last
 * good data (as connect.store does for grades).
 */

const storeV = v.union(v.literal("compass"), v.literal("connect"), v.literal("canvas"));
export type Store = "compass" | "connect" | "canvas";
/** The table each side with an error field keeps its rows in. */
const TABLE = { connect: "connectCache", canvas: "canvasCache" } as const;

export type Row = { data: unknown; fetchedAt: number | null; error: string | null; checkedAt: number };

export async function readRow(ctx: QueryCtx, accountId: Id<"accounts">, store: Store, kind: string): Promise<Row | null> {
  if (store === "compass") {
    const r = await ctx.db.query("compassCache").withIndex("by_account_kind", i => i.eq("accountId", accountId).eq("kind", kind)).unique();
    // compassCache has no error field: a failed fetch is kept as a row of its own beside the data (errorKind).
    const e = await ctx.db.query("compassCache").withIndex("by_account_kind", i => i.eq("accountId", accountId).eq("kind", errorKind(kind))).unique();
    const error = (e?.data as { message?: string } | undefined)?.message ?? null;
    if (!r) return e ? { data: null, fetchedAt: null, error, checkedAt: e.fetchedAt } : null;
    return { data: r.data, fetchedAt: r.fetchedAt, error, checkedAt: Math.max(r.fetchedAt, e?.fetchedAt ?? 0) };
  }
  const r = await ctx.db.query(TABLE[store]).withIndex("by_account_kind", i => i.eq("accountId", accountId).eq("kind", kind)).unique();
  return r && { data: r.data ?? null, fetchedAt: r.fetchedAt ?? null, error: r.error ?? null, checkedAt: r.checkedAt };
}

const errorKind = (kind: string) => `${kind}#error`;

export const get = internalQuery({
  args: { accountId: v.id("accounts"), store: storeV, kind: v.string() },
  handler: (ctx, { accountId, store, kind }) => readRow(ctx, accountId, store, kind),
});

/**
 * Keeps data (replacing the last), or an error beside the last good data. Writes nothing when nothing changed, not even
 * the time, unless it is over STAMP_EVERY old (lib/same.ts): a write runs every query reading the row again.
 */
export const put = internalMutation({
  args: { accountId: v.id("accounts"), store: storeV, kind: v.string(), data: v.optional(v.any()), error: v.optional(v.string()) },
  handler: async (ctx, { accountId, store, kind, data, error }) => {
    if (!(await ctx.db.get(accountId))) return;
    const now = Date.now();
    if (store === "compass") {
      const err = await ctx.db.query("compassCache").withIndex("by_account_kind", i => i.eq("accountId", accountId).eq("kind", errorKind(kind))).unique();
      if (data === undefined) {
        const message = error ?? "Compass did not answer.";
        if (!err) await ctx.db.insert("compassCache", { accountId, kind: errorKind(kind), data: { message }, fetchedAt: now });
        else if (!same(err.data, { message }) || now - err.fetchedAt > STAMP_EVERY) await ctx.db.patch(err._id, { data: { message }, fetchedAt: now });
        return;
      }
      if (err) await ctx.db.delete(err._id);
      const row = await ctx.db.query("compassCache").withIndex("by_account_kind", i => i.eq("accountId", accountId).eq("kind", kind)).unique();
      if (!row) await ctx.db.insert("compassCache", { accountId, kind, data, fetchedAt: now });
      else if (!same(row.data, data)) await ctx.db.patch(row._id, { data, fetchedAt: now });
      else if (now - row.fetchedAt > STAMP_EVERY) await ctx.db.patch(row._id, { fetchedAt: now });
      return;
    }
    const row = await ctx.db.query(TABLE[store]).withIndex("by_account_kind", i => i.eq("accountId", accountId).eq("kind", kind)).unique();
    const next = data !== undefined ? { data, error: undefined, fetchedAt: now, checkedAt: now } : { error, checkedAt: now };
    if (!row) return void (await ctx.db.insert(TABLE[store], { accountId, kind, ...next }));
    const unchanged = data !== undefined ? row.error === undefined && same(row.data, data) : row.error === error;
    if (!unchanged) await ctx.db.patch(row._id, next);
    else if (now - row.checkedAt > STAMP_EVERY) await ctx.db.patch(row._id, data !== undefined ? { fetchedAt: now, checkedAt: now } : { checkedAt: now });
  },
});

/** What a query hands the app for one side (Compass or Connect) of something fetched on demand. */
export type Side<T> =
  /** This side has nothing for it (no Connect at the school, no Canvas added, or the class is not on either). */
  | { status: "none" }
  /** Not fetched yet: the app's load call is on its way. */
  | { status: "missing" }
  | { status: "unavailable"; reason: string }
  | { status: "ready"; fetchedAt: number; error: string | null; data: T };

export function sideOf<T>(row: Row | null, map: (data: any) => T): Side<T> {
  if (!row) return { status: "missing" };
  if (row.data == null) return row.error ? { status: "unavailable", reason: row.error } : { status: "missing" };
  return { status: "ready", fetchedAt: row.fetchedAt ?? row.checkedAt, error: row.error, data: map(row.data) };
}
