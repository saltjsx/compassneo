import type { QueryCtx } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";
import { addDays, dayOf } from "./days";
import { periodsOf, type StoredLesson } from "../timetable";

/**
 * The last lesson of a class before a piece of work is due: the one to ask a question in, finish it in, or hand a
 * paper copy in at. Read from the kept timetable (one row per school day), so it reaches only as far ahead as the
 * timetable is kept.
 *
 *   lesson  the last one still to start before the due date: its day, start and period (counted as the timetable
 *           counts them, periodsOf)
 *   none    every day from now to the due date is kept, and none has a lesson of the class still to start
 *   null    unknown: no due date, no class, already due, or a day before the due date the timetable has not kept
 */
export type LastLesson = { kind: "lesson"; day: string; start: string; period: number | null } | { kind: "none" };

/** How far ahead it looks: the sync fetches a fortnight on (timetable.ts WINDOW_AHEAD), and opened days are kept further. */
const AHEAD_DAYS = 60;

type Wanted = { key: string; code: string | null; due: string | null };

/**
 * Each piece of work's last lesson before it is due, by key. One indexed read of the days from today to the latest due
 * date (capped), shared by every piece asked about.
 */
export async function lastLessons(ctx: QueryCtx, account: Doc<"accounts">, wanted: Wanted[], now: number): Promise<Map<string, LastLesson | null>> {
  const out = new Map<string, LastLesson | null>(wanted.map(w => [w.key, null]));
  const today = dayOf(now, account.slug);
  const limit = addDays(today, AHEAD_DAYS);
  const dated = wanted.filter((w): w is Wanted & { code: string; due: string } => !!w.code && !!w.due && Date.parse(w.due) > now);
  if (!dated.length) return out;

  const latest = dated.map(w => dayOf(w.due, account.slug)).reduce((a, b) => (a > b ? a : b));
  const to = latest < limit ? latest : limit;
  const rows = await ctx.db
    .query("compassCache")
    .withIndex("by_account_kind", i => i.eq("accountId", account._id).gte("kind", `day:${today}`).lte("kind", `day:${to}`))
    .collect();
  const days = new Map(rows.map(r => [r.kind.slice(4), (r.data ?? []) as StoredLesson[]]));

  // Each kept day's classes with their periods, worked out once.
  const classesOn = new Map<string, Array<StoredLesson & { n: number | null }>>();
  const read = (day: string) => {
    let ls = classesOn.get(day);
    if (!ls) {
      const items = days.get(day) ?? [];
      const periods = periodsOf(items);
      ls = items.filter(l => l.isClass && !l.allDay).map(l => ({ ...l, n: periods.get(l.id) ?? null }));
      classesOn.set(day, ls);
    }
    return ls;
  };

  for (const w of dated) {
    const dueDay = dayOf(w.due, account.slug);
    if (dueDay > to) continue;
    const due = Date.parse(w.due);
    // Back from the due date to today. A day the timetable has not kept leaves it unknown: a lesson may be on it.
    let found: LastLesson | null = { kind: "none" };
    for (let d = dueDay; d >= today; d = addDays(d, -1)) {
      if (!days.has(d)) {
        found = null;
        break;
      }
      const l = read(d)
        .filter(x => x.code === w.code && Date.parse(x.start) < due && Date.parse(x.start) > now)
        .sort((a, b) => b.start.localeCompare(a.start))[0];
      if (l) {
        found = { kind: "lesson", day: d, start: l.start, period: l.n };
        break;
      }
    }
    out.set(w.key, found);
  }
  return out;
}
