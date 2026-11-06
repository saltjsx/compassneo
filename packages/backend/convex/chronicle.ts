import { v } from "convex/values";
import { action, query, type ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { getChronicle, type ChronicleEntry, type ChronicleSummary, type CompassSession } from "@compassneo/compass";
import { deviceAccount, withCompass, type Problem } from "./lib/compass";
import { addDays, schoolToday } from "./lib/days";
import { accountFor } from "./timetable";
import { readRow } from "./cache";
import { codesFor } from "./lib/match";
import { teachersFor } from "./teachers";

/**
 * Chronicle: the notes staff keep on a student (commendations, behaviour, wellbeing), as far as Compass shows them to
 * the student. The summary counts every entry by category, including ones the student cannot open; the feed is what
 * they can. The last two years, fetched with each sync and by load.
 */

export type Chronicle = { summary: ChronicleSummary[]; entries: ChronicleEntry[]; total: number };

/** An entry as the app gets it: with the photo of the staff member who wrote it, when they are one of the student's teachers. */
export type ChronicleItem = ChronicleEntry & { byPhotoUrl: string | null };

export async function fetchChronicle(ctx: ActionCtx, account: Doc<"accounts">, s: CompassSession) {
  const today = schoolToday(account.slug);
  const from = `${Number(today.slice(0, 4)) - 2}-01-01T00:00:00.000Z`;
  const data = await getChronicle(s, { from, to: `${addDays(today, 1)}T00:00:00.000Z`, max: 80 });
  await ctx.runMutation(internal.cache.put, { accountId: account._id, store: "compass", kind: "chronicle", data });
  return { count: data.entries.length };
}

export const get = query({
  args: { token: v.union(v.string(), v.null()) },
  handler: async (ctx, { token }): Promise<(Omit<Chronicle, "entries"> & { entries: ChronicleItem[]; fetchedAt: number }) | null> => {
    if (!token) return null;
    const account = await accountFor(ctx, token);
    if (!account) return null;
    const row = await readRow(ctx, account._id, "compass", "chronicle");
    if (!row?.data) return null;
    const d = row.data as Chronicle;
    // Staff by name: a teacher's code is their initial and surname ("Bree Cook" is bcook), and convex/teachers.ts keeps
    // the photos of the student's teachers by code.
    const names = [...new Set(d.entries.map(e => e.by).filter((b): b is string => !!b))];
    const codes = new Map(names.map(n => [n, codesFor(n).map(c => c.code)]));
    const known = await teachersFor(ctx, account.slug, [...codes.values()].flat());
    const photoOf = (n: string | null) => (n ? ((codes.get(n) ?? []).map(c => known.get(c)?.photoUrl).find(Boolean) ?? null) : null);
    const entries = [...d.entries].sort((a, b) => (b.at ?? "").localeCompare(a.at ?? "")).map(e => ({ ...e, byPhotoUrl: photoOf(e.by) }));
    return { ...d, entries, fetchedAt: row.fetchedAt ?? row.checkedAt };
  },
});

export const load = action({
  args: { token: v.string() },
  handler: async (ctx, { token }): Promise<{ ok: true } | Problem> => {
    const account = await deviceAccount(ctx, token, { reader: true });
    if (!account) return { ok: false, code: "signed-out", message: "This device is signed out." };
    const r = await withCompass(ctx, account, s => fetchChronicle(ctx, account, s));
    return r.ok ? { ok: true } : r;
  },
});
