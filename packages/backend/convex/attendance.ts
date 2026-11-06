import { v } from "convex/values";
import { action, query, type ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { getClassAttendance, getRolls, getTermAttendanceDays, getTerms, type ClassAttendance, type CompassSession, type TermAttendance } from "@compassneo/compass";
import { getAttendance, type ConnectAttendance, type ConnectSession } from "@compassneo/connect";
import { deviceAccount, withCompass, type Problem } from "./lib/compass";
import { isWA, withConnect } from "./lib/connect";
import { dayOf, schoolToday } from "./lib/days";
import { huesFor, shortName } from "./lib/match";
import { accountFor, compassRow, type StoredClass } from "./timetable";
import { readRow } from "./cache";

/**
 * Attendance from both sides. Compass: every class's rolls this year (present, absent, late, Compass's percentages)
 * and whole and partial days by term. Connect (WA): the year's authorised and unauthorised absences, and the current
 * term period by period. Fetched with each sync (the attendance steps) and by load.
 */

/** A term's rolls by class, asked of Compass for the term's own dates (up to today for the term under way). */
type TermRolls = { name: string; start: string; finish: string; classes: ClassAttendance[] };
/** Every roll this year, kept short: [start, class code, period or null, what the roll said, is a class (1) or not (0)]. */
type KeptRoll = [string, string, number | null, string, 0 | 1];
type CompassAttendanceRow = { year: number; classes: ClassAttendance[]; terms: TermAttendance[]; byTerm?: TermRolls[]; rolls?: KeptRoll[] };

/** A roll's words as a mark, in the codes the app's period grid reads (Connect's: P, L, AA, UA, "-"). */
function markOfRoll(status: string): { code: string; name: string; reason: string | null } {
  const reason = /\(([^)]*)\)\s*$/.exec(status)?.[1]?.trim() || null;
  if (/^present/i.test(status)) return { code: "P", name: "Present", reason: null };
  if (/^late/i.test(status)) return { code: "L", name: "Late", reason: /unexplained/i.test(status) ? "Unexplained" : reason };
  if (/^not present:\s*explained/i.test(status)) return { code: "AA", name: "Authorised absence", reason };
  if (/^not present/i.test(status)) return { code: "UA", name: "Unauthorised absence", reason: null };
  if (/^not marked/i.test(status)) return { code: "-", name: "Not recorded", reason: null };
  return { code: "?", name: status, reason: null };
}

/** A Compass date as ISO: its transport dates are ISO strings, older services send "/Date(1700000000000)/". */
const HOUR = 3600 * 1000;
/**
 * A term's first or last day as an instant. Compass's term list gives days as "02/04/2026" (day first); a term spans
 * from the start of its first day to the end of its last anywhere in Australia (UTC+8 to +11).
 */
const isoOf = (x: unknown, edge: "start" | "end") => {
  if (typeof x !== "string" || !x) return null;
  const dmy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(x.trim());
  const ms = /\/Date\((-?\d+)/.exec(x)?.[1];
  let t: number;
  if (dmy) {
    const day = Date.UTC(Number(dmy[3]), Number(dmy[2]) - 1, Number(dmy[1]));
    t = edge === "start" ? day - 11 * HOUR : day + 24 * HOUR - 8 * HOUR - 1;
  } else t = ms ? Number(ms) : Date.parse(x);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
};

export async function fetchCompassAttendance(ctx: ActionCtx, account: Doc<"accounts">, s: CompassSession) {
  const today = schoolToday(account.slug);
  const year = Number(today.slice(0, 4));
  const classes = await getClassAttendance(s, `${year - 1}-12-31T16:00:00.000Z`, new Date().toISOString());
  const terms = await getTermAttendanceDays(s, year);
  // Each term of the year so far on its own, so the app can show any one term (Compass's terms, with their dates).
  // Every roll this year, one by one (for any term's week-by-week and period grid, and why each absence was).
  const rolls: KeptRoll[] = (await getRolls(s, `${year - 1}-12-31T00:00:00Z`).catch(() => []))
    .filter(r => dayOf(r.start, account.slug).startsWith(String(year)))
    .map(r => [r.start, r.code, r.period, r.status, r.isClass ? 1 : 0]);
  const byTerm: TermRolls[] = [];
  const now = new Date().toISOString();
  const dated = (await getTerms(s).catch(() => []))
    .map(t => ({ name: t.name as string | null, year: t.year, start: isoOf(t.start, "start"), finish: isoOf(t.finish, "end") }))
    .filter((t): t is { name: string; year: number | null; start: string; finish: string } => !!t.name && !!t.start && !!t.finish)
    .filter(t => (t.year ?? Number(t.start.slice(0, 4))) === year && t.start <= now)
    .sort((a, b) => a.start.localeCompare(b.start));
  for (const t of dated) {
    const rolls = await getClassAttendance(s, t.start, t.finish < now ? t.finish : now).catch(() => null);
    if (rolls) byTerm.push({ name: t.name, start: t.start, finish: t.finish, classes: rolls });
  }
  await ctx.runMutation(internal.cache.put, {
    accountId: account._id,
    store: "compass",
    kind: "attendance",
    data: { year, classes, terms, byTerm, rolls } satisfies CompassAttendanceRow,
  });
  const marked = classes.reduce((a, c) => a + c.marked, 0);
  const present = classes.reduce((a, c) => a + c.present, 0);
  return { count: classes.length, note: marked ? `${Math.round((100 * present) / marked)}% of ${marked} rolls` : undefined };
}

export async function fetchConnectAttendance(ctx: ActionCtx, account: Doc<"accounts">, c: ConnectSession) {
  const a = await getAttendance(c);
  await ctx.runMutation(internal.cache.put, { accountId: account._id, store: "connect", kind: "attendance", data: a });
  return { count: a.days.length };
}

export type AttendanceClass = ClassAttendance & { short: string; hue: number | null };

export type Rolls = {
  /** Every roll in the span: present out of marked, as a share. */
  overall: { marked: number; present: number; absent: number; late: number; percent: number | null };
  classes: AttendanceClass[];
};

/** A span's rolls by class (the year, a term), summed, each class with its name and colour from the timetable. */
function rollsOf(rows: ClassAttendance[], known: StoredClass[], hues: Map<string, number>): Rolls {
  const marked = rows.reduce((a, x) => a + x.marked, 0);
  const present = rows.reduce((a, x) => a + x.present, 0);
  return {
    overall: {
      marked,
      present,
      absent: rows.reduce((a, x) => a + x.absent, 0),
      late: rows.reduce((a, x) => a + x.late, 0),
      percent: marked ? Math.round((1000 * present) / marked) / 10 : null,
    },
    classes: rows
      .filter(x => x.marked > 0)
      .map(x => {
        const k = known.find(k => k.code === x.code);
        return { ...x, short: k ? shortName(k.subject, k.code) : x.name, hue: k ? (hues.get(k.code) ?? null) : null };
      })
      .sort((a, b) => Number(b.hue != null) - Number(a.hue != null) || b.marked - a.marked),
  };
}

export type Attendance = {
  compass: {
    fetchedAt: number;
    year: number;
    /** Every roll this year: present out of marked, as a share. */
    overall: { marked: number; present: number; absent: number; late: number; percent: number | null };
    classes: AttendanceClass[];
    terms: TermAttendance[];
    /**
     * Each term so far on its own (its name, dates, and rolls by class, as for the year), in order; the one under way
     * has current: true. Empty until a sync after this was added.
     */
    byTerm: Array<Rolls & { name: string; start: string; finish: string; firstDay: string; lastDay: string; current: boolean }>;
    /**
     * Every school day this year, period by period, from Compass's rolls, in the shape of Connect's term grid (so the
     * same chart and grid draw any term, or the year). Empty until a sync after this was added.
     */
    days: Array<{ date: string; periods: Array<{ period: number; code: string; name: string; reason: string | null; class: string }> }>;
    /** Every absence and late this year, newest first: the day, why (Compass's reason), and the classes it took. */
    absences: Array<{ date: string; code: string; name: string; reason: string | null; classes: Array<{ period: number | null; class: string; classCode: string }> }>;
  } | null;
  connect: (ConnectAttendance & { fetchedAt: number; error: string | null }) | { error: string } | null;
};

export const get = query({
  args: { token: v.union(v.string(), v.null()) },
  handler: async (ctx, { token }): Promise<Attendance | null> => {
    if (!token) return null;
    const account = await accountFor(ctx, token);
    if (!account) return null;

    const c = await readRow(ctx, account._id, "compass", "attendance");
    let compass: Attendance["compass"] = null;
    if (c?.data) {
      const d = c.data as CompassAttendanceRow;
      const known = ((await compassRow(ctx, account._id, "classes"))?.data ?? []) as StoredClass[];
      const hues = huesFor(known.map(k => k.code));
      const fetched = new Date(c.fetchedAt ?? c.checkedAt).toISOString();
      compass = {
        fetchedAt: c.fetchedAt ?? c.checkedAt,
        year: d.year,
        ...rollsOf(d.classes, known, hues),
        terms: d.terms,
        ...daysOf(d.rolls ?? [], account.slug, known),
        byTerm: (d.byTerm ?? []).map(t => ({
          name: t.name,
          start: t.start,
          finish: t.finish,
          // The term's own first and last days (start and finish are padded to cover every Australian time zone).
          firstDay: new Date(Date.parse(t.start) + 11 * HOUR).toISOString().slice(0, 10),
          lastDay: t.finish.slice(0, 10),
          current: t.start <= fetched && fetched <= t.finish,
          ...rollsOf(t.classes, known, hues),
        })),
      };
    }

    let connect: Attendance["connect"] = null;
    if (isWA(account.slug)) {
      const r = await readRow(ctx, account._id, "connect", "attendance");
      if (r?.data) connect = { ...(r.data as ConnectAttendance), fetchedAt: r.fetchedAt ?? r.checkedAt, error: r.error };
      else if (r?.error) connect = { error: r.error };
    }
    return { compass, connect };
  },
});

/** The year's rolls as days of periods (the grid's shape) and as a list of absences with their reasons. */
function daysOf(rolls: KeptRoll[], slug: string, known: StoredClass[]) {
  const nameOf = (code: string) => {
    const k = known.find(k => k.code === code);
    return k ? shortName(k.subject, k.code) : code;
  };
  const byDay = new Map<string, Array<{ period: number; code: string; name: string; reason: string | null; class: string }>>();
  const off = new Map<string, { date: string; code: string; name: string; reason: string | null; classes: Array<{ period: number | null; class: string; classCode: string }> }>();
  for (const [start, code, period, status, isClass] of rolls) {
    const date = dayOf(start, slug);
    const m = markOfRoll(status);
    if (isClass && period != null) {
      const list = byDay.get(date) ?? [];
      // One mark per period: a class and an event in the same slot keep the class's.
      if (!list.some(x => x.period === period)) list.push({ period, code: m.code, name: m.name, reason: m.reason, class: nameOf(code) });
      byDay.set(date, list);
    }
    if (m.code === "AA" || m.code === "UA" || m.code === "L") {
      const key = `${date}|${m.code}|${m.reason ?? ""}`;
      const a = off.get(key) ?? { date, code: m.code, name: m.name, reason: m.reason, classes: [] };
      a.classes.push({ period, class: isClass ? nameOf(code) : code, classCode: code });
      off.set(key, a);
    }
  }
  return {
    days: [...byDay.entries()].map(([date, periods]) => ({ date, periods: periods.sort((a, b) => a.period - b.period) })).sort((a, b) => a.date.localeCompare(b.date)),
    absences: [...off.values()]
      .map(a => ({ ...a, classes: a.classes.sort((x, y) => (x.period ?? 99) - (y.period ?? 99)) }))
      .sort((a, b) => b.date.localeCompare(a.date)),
  };
}

/** Fetches attendance from both sides now (the attendance view's refresh). */
export const load = action({
  args: { token: v.string() },
  handler: async (ctx, { token }): Promise<{ ok: true } | Problem> => {
    const account = await deviceAccount(ctx, token, { reader: true });
    if (!account) return { ok: false, code: "signed-out", message: "This device is signed out." };
    const jobs: Array<Promise<unknown>> = [withCompass(ctx, account, s => fetchCompassAttendance(ctx, account, s))];
    if (isWA(account.slug) && account.sealedLogin) {
      jobs.push(
        withConnect(ctx, account, c => fetchConnectAttendance(ctx, account, c)).then(r =>
          r.ok ? r : ctx.runMutation(internal.cache.put, { accountId: account._id, store: "connect", kind: "attendance", error: r.message }),
        ),
      );
    }
    await Promise.all(jobs);
    return { ok: true };
  },
});
