import { v } from "convex/values";
import { query } from "./_generated/server";
import { percentOf, scoreOf, weightedOf, type ConnectClass, type ConnectNotice, type Spread, type SubjectGrade } from "@compassneo/connect";
import { addDays, isDay } from "./lib/days";
import { historyKey, type History, type HistoryPoint } from "./lib/history";
import { huesFor, matchSubject, shortName, subjectName, type Person } from "./lib/match";
import { accountFor, compassRow, connectRow, peopleFor, periodsOf, semesterOf, type StoredClass, type StoredLesson } from "./timetable";
import { canvasView, currentClasses } from "./lib/courses";
import { gradeRows, subjectMatcher } from "./lib/grades";

/**
 * Everything Compass Neo knows about one class, for the class panel: its lessons over the weeks around the day being
 * looked at, its teachers, both semesters of grades from Connect with every assessment and the grade's history, its
 * learning tasks and its teachers' notices.
 *
 * The day sets which semester is "this" one and the window of lessons; nothing here depends on the clock, so the
 * answer only changes when the data does. The client splits the lessons into past and to come.
 */

/** Lessons from this many days before the day to this many after. */
const LESSONS_BEHIND = 14;
const LESSONS_AHEAD = 28;
const MAX_NOTICES = 12;

export type ClassLesson = {
  id: string;
  day: string;
  start: string;
  finish: string;
  period: number | null;
  room: string | null;
  roomWas: string | null;
  teacher: Person | null;
  teacherWas: Person | null;
};

export type Assessment = {
  id: number;
  name: string;
  description: string | null;
  mark: number | null;
  max: number | null;
  /** The mark out of 100. */
  percent: number | null;
  /**
   * What it counts for: weightedMark out of weight (Connect's weightedMaximumMark), in points of the subject. weightedMark
   * is worked out from the mark (Connect's own is rounded to a tenth).
   */
  weightedMark: number | null;
  weight: number | null;
  /** Its share of the subject's weighting, out of 100: weight out of every weighted task's (which need not total 100). */
  share: number | null;
  /** The part of the outline it sits in ("Chemical Sciences"), when the outline has parts. */
  group: string | null;
  /** When the mark first appeared in a sync; null for marks already there when history began. */
  markedAt: number | null;
  /** The mark before a teacher changed it. */
  was: number | null;
  /** How the class did on it, out of 100 (Connect's chart). */
  spread: Spread | null;
};

export type SemesterGrade = {
  subject: string;
  semester: 1 | 2;
  outline: string | null;
  statusLine: string | null;
  teachers: string[];
  /** Worked out from the marked tasks; Connect's own overall mark where it gave one is connectPercent. */
  percent: number | null;
  connectPercent: number | null;
  letter: string | null;
  marked: number;
  total: number;
  markedWeight: number | null;
  totalWeight: number | null;
  tasks: Assessment[];
  /** The score each time a sync saw it move, oldest first. */
  points: HistoryPoint[];
  /** How the class did on the subject, out of 100 (Connect's chart): where the student sits among them. */
  spread: Spread | null;
};

export type ClassGrades =
  /** No grades anywhere: not a WA public school (no Connect), and no Canvas added. */
  | { status: "none" }
  | { status: "unavailable"; reason: string }
  | { status: "loading" }
  | {
      status: "ready";
      fetchedAt: number;
      error: string | null;
      /** The semester the day is in (or the only one Connect has). */
      current: SemesterGrade | null;
      /** The same subject in the other semester. */
      other: SemesterGrade | null;
      /** When Compass Neo began keeping this account's grade history. */
      historySince: number | null;
    };

/** A teacher's notice to the class: a Connect notice, or a Canvas announcement in the class's course. */
export type ClassNotice = {
  id: number | string;
  title: string;
  text: string | null;
  author: string | null;
  at: string | null;
  source: "connect" | "canvas";
  /** Where it opens on its own site (Canvas). */
  url: string | null;
};
export type ClassTask = { id: number | null; name: string; due: string | null; status: number | null };

export type ClassDetail = {
  code: string;
  name: string;
  subject: string;
  hue: number;
  /** Everyone timetabled to take it lately, then Connect's staff for the subject. */
  teachers: Person[];
  lessons: ClassLesson[];
  /** Lessons in a usual week, and their minutes; null until a whole school week is known. */
  perWeek: number | null;
  minutesPerWeek: number | null;
  rooms: Array<{ room: string; count: number }>;
  grades: ClassGrades;
  tasks: ClassTask[];
  notices: ClassNotice[];
  /** The class on Connect its notices came from. */
  connectClass: { name: string; code: string | null } | null;
};

const finite = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

export function semesterGrade(g: SubjectGrade, history: History | null): SemesterGrade {
  const score = scoreOf(g.tasks);
  const h = history?.subjects[historyKey(g.semester, g.subject)];
  const connectPercent = finite(g.cumulativePercent) ? g.cumulativePercent : null;
  return {
    subject: g.subject,
    semester: g.semester,
    outline: g.outline,
    statusLine: g.statusLine,
    teachers: g.teachers,
    // Connect's own overall mark where it gives one (the figure teachers report), else the one worked out.
    percent: percentOf(g),
    connectPercent,
    letter: g.grade,
    marked: score.marked,
    total: score.total,
    markedWeight: score.markedWeight,
    totalWeight: score.totalWeight,
    tasks: g.tasks.map(t => {
      const seen = h?.marks[String(t.taskId)];
      return {
        id: t.taskId,
        name: t.name,
        description: t.description,
        mark: t.mark,
        max: t.maximumMark,
        percent: finite(t.mark) && finite(t.maximumMark) && t.maximumMark > 0 ? (100 * t.mark) / t.maximumMark : null,
        weightedMark: weightedOf(t),
        weight: t.weightedMaximumMark,
        share: finite(t.weightedMaximumMark) && score.totalWeight ? (100 * t.weightedMaximumMark) / score.totalWeight : null,
        group: t.group ?? null,
        markedAt: seen && !seen.baseline ? seen.at : null,
        was: seen?.was ?? null,
        spread: t.spread ?? null,
      };
    }),
    points: h?.points ?? [],
    spread: g.spread ?? null,
  };
}

/** The Connect class a Compass class's notices are posted on: by code, else by name and the notices' authors. */
export function connectClassFor(code: string, subject: string | null, teachers: string[], classes: ConnectClass[], notices: ConnectNotice[]) {
  const c = squash(code);
  const direct =
    classes.find(k => k.code && squash(k.code) === c) ?? (c.length >= 4 ? classes.find(k => squash(k.name).includes(c)) : undefined);
  if (direct) return direct;
  const live = classes.filter(k => !k.finished);
  const pool = (live.length ? live : classes).map(k => ({
    ...k,
    subject: k.name,
    teachers: [...new Set(notices.filter(n => n.classId === k.classId && n.author).map(n => n.author!))],
  }));
  return matchSubject({ code, subject, teachers }, pool);
}

/** The most usual count of lessons a school week holds, over the weeks whose five days are all known. */
function usualWeek(rows: Array<{ day: string; lessons: StoredLesson[] }>) {
  const weeks = new Map<string, { days: number; count: number; minutes: number }>();
  for (const { day, lessons } of rows) {
    const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
    if (weekday === 0 || weekday === 6) continue;
    const monday = addDays(day, 1 - weekday);
    const w = weeks.get(monday) ?? { days: 0, count: 0, minutes: 0 };
    w.days++;
    w.count += lessons.length;
    w.minutes += lessons.reduce((m, l) => m + (Date.parse(l.finish) - Date.parse(l.start)) / 60000, 0);
    weeks.set(monday, w);
  }
  const whole = [...weeks.values()].filter(w => w.days === 5 && w.count > 0);
  if (!whole.length) return null;
  const tally = new Map<number, { n: number; minutes: number }>();
  for (const w of whole) {
    const t = tally.get(w.count) ?? { n: 0, minutes: w.minutes };
    t.n++;
    tally.set(w.count, t);
  }
  const [count, t] = [...tally.entries()].sort((a, b) => b[1].n - a[1].n || b[0] - a[0])[0]!;
  return { perWeek: count, minutesPerWeek: Math.round(t.minutes) };
}

/** One class, by its Compass code, as seen from a day (the day's semester; the weeks around it). */
export const detail = query({
  args: { token: v.union(v.string(), v.null()), code: v.string(), day: v.string() },
  handler: async (ctx, { token, code, day }): Promise<ClassDetail | null> => {
    if (!token || !isDay(day) || !code) return null;
    const account = await accountFor(ctx, token);
    if (!account) return null;

    const classes = ((await compassRow(ctx, account._id, "classes"))?.data ?? []) as StoredClass[];
    const { source: gradeSource, grades: gradesRow, history: historyRow } = await gradeRows(ctx, account);
    const grades = (gradesRow?.data ?? []) as SubjectGrade[];
    const notices = ((await connectRow(ctx, account._id, "notices"))?.data ?? []) as ConnectNotice[];
    const connectClasses = ((await connectRow(ctx, account._id, "classes"))?.data ?? []) as ConnectClass[];
    const history = (historyRow?.data ?? null) as History | null;
    const allTasks = ((await compassRow(ctx, account._id, "tasks"))?.data ?? []) as Array<ClassTask & { className: string | null }>;

    // The class's lessons in the weeks around the day, from the kept days.
    const from = addDays(day, -LESSONS_BEHIND);
    const to = addDays(day, LESSONS_AHEAD);
    const dayRows = await ctx.db
      .query("compassCache")
      .withIndex("by_account_kind", i => i.eq("accountId", account._id).gte("kind", `day:${from}`).lte("kind", `day:${to}`))
      .collect();
    const days = dayRows
      .map(r => {
        // Periods are counted across the whole day before it is narrowed to this class.
        const all = (r.data ?? []) as StoredLesson[];
        const periods = periodsOf(all);
        const lessons = all.filter(l => l.isClass && !l.allDay && l.code === code).map(l => ({ ...l, period: periods.get(l.id) ?? null }));
        return { day: r.kind.slice(4), lessons };
      })
      .sort((a, b) => a.day.localeCompare(b.day));
    const mine = days.flatMap(d => d.lessons.map(l => ({ day: d.day, l })));

    const known = classes.find(c => c.code === code);
    const subjectRaw = known?.subject ?? mine.find(m => m.l.subject)?.l.subject ?? null;
    const teacherCodes = [...new Set([...(known?.teachers ?? []), ...mine.map(m => m.l.teacher).filter((t): t is string => !!t)])];
    const who = await peopleFor(ctx, account.slug, grades, notices, [...teacherCodes, ...mine.map(m => m.l.cover)]);

    // Grades: the day's semester (or whichever Connect has), and the same subject in the other.
    let gradesOut: ClassGrades;
    const subjectOfClass = await subjectMatcher(ctx, account, gradeSource);
    if (!gradeSource) gradesOut = { status: "none" };
    else if (gradesRow?.data) {
      const semester = semesterOf(day);
      const inSemester = grades.filter(g => g.semester === semester);
      const klass = { code, subject: subjectRaw, teachers: teacherCodes };
      const current = subjectOfClass(klass, inSemester.length ? inSemester : grades);
      const others = grades.filter(g => g !== current && g.semester !== current?.semester);
      const other = (current && others.find(g => squash(g.subject) === squash(current.subject))) ?? subjectOfClass(klass, others);
      gradesOut = {
        status: "ready",
        fetchedAt: gradesRow.fetchedAt ?? gradesRow.checkedAt,
        error: gradesRow.error ?? null,
        current: current ? semesterGrade(current, history) : null,
        other: other ? semesterGrade(other, history) : null,
        historySince: history?.since ?? null,
      };
    } else if (gradesRow?.error) gradesOut = { status: "unavailable", reason: gradesRow.error };
    else if (gradeSource === "connect" && !account.sealedLogin) gradesOut = { status: "unavailable", reason: "Sign in again so Compass Neo can open Connect for you." };
    else if (gradeSource === "canvas" && account.canvasRefused) gradesOut = { status: "unavailable", reason: account.canvasRefused };
    else gradesOut = { status: "loading" };

    // Teachers: the timetable's, then Connect's staff for the subject that the timetable did not name.
    const teachers = teacherCodes.map(t => who(t)).filter((p): p is Person => !!p);
    const staff = gradesOut.status === "ready" ? (gradesOut.current?.teachers ?? gradesOut.other?.teachers ?? []) : [];
    for (const full of staff) {
      if (teachers.some(p => p.full === full)) continue;
      const w = full.trim().split(/\s+/);
      teachers.push({ code: "", name: w.length > 1 ? `${w[0]![0]!.toUpperCase()}. ${w[w.length - 1]}` : full, full, photoUrl: null });
    }

    const rooms = new Map<string, number>();
    for (const { l } of mine) {
      const room = l.coverRoom ?? l.room;
      if (room) rooms.set(room, (rooms.get(room) ?? 0) + 1);
    }

    const connectClass = connectClassFor(code, subjectRaw, teacherCodes, connectClasses, notices);
    const canvas = await canvasView(ctx, account, await currentClasses(ctx, account));
    const week = usualWeek(days);

    return {
      code,
      name: shortName(subjectRaw, code),
      subject: subjectName(subjectRaw, code),
      hue: huesFor([...classes.map(c => c.code), code]).get(code) ?? 0,
      teachers,
      lessons: mine.map(({ day, l }) => ({
        id: l.id,
        day,
        start: l.start,
        finish: l.finish,
        period: l.period,
        room: l.coverRoom ?? l.room,
        roomWas: l.coverRoom ? l.room : null,
        teacher: who(l.cover ?? l.teacher),
        teacherWas: l.cover ? who(l.teacher) : null,
      })),
      perWeek: week?.perWeek ?? null,
      minutesPerWeek: week?.minutesPerWeek ?? null,
      rooms: [...rooms.entries()].map(([room, count]) => ({ room, count })).sort((a, b) => b.count - a.count),
      grades: gradesOut,
      tasks: allTasks
        .filter(t => t.className === code)
        .map(t => ({ id: t.id, name: t.name, due: t.due, status: t.status ?? null }))
        .sort((a, b) => (a.due ?? "9999").localeCompare(b.due ?? "9999")),
      notices: [
        ...(connectClass
          ? notices
              .filter(n => n.classId === connectClass.classId)
              .map(n => ({ id: n.id, title: n.title, text: n.text, author: n.author, at: n.at, source: "connect" as const, url: null }))
          : []),
        ...(canvas?.announcements ?? [])
          .filter(a => canvas!.classOfAnnouncement(a) === code)
          .map(a => ({ id: a.id, title: a.title, text: a.text, author: a.author, at: a.at, source: "canvas" as const, url: a.url })),
      ]
        .sort((a, b) => (b.at ?? "").localeCompare(a.at ?? ""))
        .slice(0, MAX_NOTICES),
      connectClass: connectClass ? { name: connectClass.name, code: connectClass.code } : null,
    };
  },
});
