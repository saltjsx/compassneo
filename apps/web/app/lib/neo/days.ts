/**
 * School days on the client, in the school's own time zone (a WA student in Melbourne for the week still sees Perth
 * times, as the timetable on the wall does). A day is written YYYY-MM-DD, as the server keeps it (convex/lib/days.ts).
 */

const ZONES: Record<string, string> = {
  wa: "Australia/Perth",
  sa: "Australia/Adelaide",
  nt: "Australia/Darwin",
  qld: "Australia/Brisbane",
  nsw: "Australia/Sydney",
  act: "Australia/Sydney",
  vic: "Australia/Melbourne",
  tas: "Australia/Hobart",
};

export const zoneOf = (slug: string) => ZONES[/-([a-z]{2,3})$/.exec(slug)?.[1] ?? ""] ?? "Australia/Melbourne";

const dayFormat = new Map<string, Intl.DateTimeFormat>();
/** The day an instant falls on at the school. */
export function dayIn(zone: string, at: number | string | Date = Date.now()) {
  let f = dayFormat.get(zone);
  if (!f) dayFormat.set(zone, (f = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" })));
  return f.format(new Date(at));
}

const DAY = 24 * 60 * 60 * 1000;
const noon = (day: string) => Date.parse(`${day}T12:00:00Z`);
export const addDays = (day: string, n: number) => new Date(noon(day) + n * DAY).toISOString().slice(0, 10);
export const daysApart = (from: string, to: string) => Math.round((noon(to) - noon(from)) / DAY);

const weekday = new Intl.DateTimeFormat("en-AU", { weekday: "long", timeZone: "UTC" });
const short = new Intl.DateTimeFormat("en-AU", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const long = new Intl.DateTimeFormat("en-AU", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });

/** "Today", "Tomorrow", "Yesterday", a weekday this week or last, else "Mon 10 Nov". */
export function dayName(day: string, today: string) {
  const n = daysApart(today, day);
  if (n === 0) return "Today";
  if (n === 1) return "Tomorrow";
  if (n === -1) return "Yesterday";
  if (n > 1 && n < 7) return weekday.format(noon(day));
  return short.format(noon(day)).replace(",", "");
}

const dayMonth = new Intl.DateTimeFormat("en-AU", { day: "numeric", month: "short", timeZone: "UTC" });
/** "5 Nov". */
export const shortDate = (day: string) => dayMonth.format(noon(day));

/** "Thursday 5 November". */
export const longDay = (day: string) => long.format(noon(day)).replace(",", "");
export const weekdayOf = (day: string) => weekday.format(noon(day));
export const isWeekend = (day: string) => [0, 6].includes(new Date(noon(day)).getUTCDay());

const timeFormat = new Map<string, Intl.DateTimeFormat>();
/** "9:50", "1:20": the clock on the timetable, without am or pm (a lesson is never at 9:50 at night). */
export function clock(iso: string, zone: string) {
  let f = timeFormat.get(zone);
  if (!f) timeFormat.set(zone, (f = new Intl.DateTimeFormat("en-AU", { timeZone: zone, hour: "numeric", minute: "2-digit", hour12: true })));
  return f
    .formatToParts(new Date(iso))
    .filter(p => p.type === "hour" || p.type === "minute" || p.type === "literal")
    .map(p => p.value)
    .join("")
    .trim();
}

/** "45 min", "1 hr", "1 hr 20 min". */
export function minutes(ms: number) {
  const m = Math.max(0, Math.round(ms / 60000));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h} hr ${m % 60} min` : `${h} hr`;
}

/** The class's last lesson before a piece of work is due, as the server works it out (convex/lib/lessons.ts). */
export type LastLesson = { kind: "lesson"; day: string; start: string; period: number | null } | { kind: "none" };

/**
 * "Last lesson Thursday, P3", "Last lesson today, 1:20", "No lessons left" (before it is due). Short, for a row's caption;
 * null when the server does not know (the timetable is not kept that far ahead).
 */
export function lastLessonText(l: LastLesson | null | undefined, today: string, zone: string) {
  if (!l) return null;
  if (l.kind === "none") return "No lessons left";
  const n = daysApart(today, l.day);
  const day = n === 0 || n === 1 ? dayName(l.day, today).toLowerCase() : dayName(l.day, today);
  return `Last lesson ${day}, ${l.period != null ? `P${l.period}` : clock(l.start, zone)}`;
}

/**
 * "Last lesson: Thu 5 Nov, P3 (9:50)", "Last lesson: today, 1:20": the same, with its date and clock time, for the
 * work's own page. Short enough for one line at phone width, and allowed to wrap where it is not.
 */
export function lastLessonLong(l: LastLesson | null | undefined, today: string, zone: string) {
  if (!l) return null;
  if (l.kind === "none") return "No lessons of this class left before it's due";
  const n = daysApart(today, l.day);
  const day = n === 0 ? "today" : n === 1 ? "tomorrow" : short.format(noon(l.day)).replace(",", "");
  return `Last lesson: ${day}, ${l.period != null ? `P${l.period} (${clock(l.start, zone)})` : clock(l.start, zone)}`;
}
