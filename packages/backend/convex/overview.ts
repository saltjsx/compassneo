import { v } from "convex/values";
import { query, type QueryCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import type { CompassTask } from "@compassneo/compass";
import type { ConnectClass, ConnectNotice, Spread, SubjectGrade } from "@compassneo/connect";
import { isWA } from "./lib/connect";
import { addDays, isDay, schoolToday } from "./lib/days";
import { historyKey, type History, type HistoryPoint } from "./lib/history";
import { lastLessons, type LastLesson } from "./lib/lessons";
import { huesFor, matchSubject, shortName } from "./lib/match";
import { readRow } from "./cache";
import { connectClassFor, semesterGrade, type Assessment, type SemesterGrade } from "./classes";
import { accountFor, compassRow, connectRow, semesterOf, type StoredClass } from "./timetable";
import { compassState, connectKind, connectState, type ConnectRow, type WorkState } from "./work";
import { canvasState } from "./canvas";
import { canvasView } from "./lib/courses";
import { gradeRows, subjectMatcher, type GradeSource } from "./lib/grades";

/**
 * Home's overview of the year, above the classes: every grade at once (grades, for the Grades row and its page in the
 * side panel) and every piece of work not handed in yet (todo). Both read only what the sync (or the class panel) has
 * kept: Connect's grades and the grade history, Compass's learning tasks in full, and each class's Connect submission
 * board (work.ts fetchConnectWork keeps those).
 *
 * A subject or a piece of work carries the timetable class it belongs to (its code and colour), matched the way the
 * class list on home does it (classlist.ts), so pressing it opens that class in the panel.
 */

/** A class not on the timetable for this long is a past one (as in classlist.ts): its work and grades open nothing. */
const STALE_DAYS = 28;
const WEEK = 7 * 86400 * 1000;
/** Recent marks kept across every subject, newest first. */
const RECENT = 12;
/** Assessments still to be marked, at most. */
const UPCOMING = 24;
/** A Compass task with no online hand-in (no status) is on the list from this long before its due date... */
const OFFLINE_AHEAD_DAYS = 14;
/**
 * ...until this long after it, as overdue: nothing online says whether it went in on paper, so it is shown for a week
 * and then trusted to have been dealt with. Work with an online hand-in stays overdue for as long as Compass keeps it
 * (work.ts KEEP_DAYS) or the Connect board lists it open.
 */
const OFFLINE_OVERDUE_DAYS = 7;
/**
 * Canvas marks everything not handed in by its date missing, quizzes nobody chased up among it, and keeps it so all
 * year. Overdue Canvas work is listed for four weeks after its date (as long as Canvas's own to-do keeps it); after
 * that it is left to the class's Work.
 */
const CANVAS_OVERDUE_DAYS = 28;

const DAY = 86400 * 1000;
const round1 = (n: number) => Math.round(n * 10) / 10;
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const finite = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);

// ---------- what both read ----------

/** The classes on the timetable now, by code, and their colours as the class list on home gives them. */
async function classesOf(ctx: QueryCtx, account: Doc<"accounts">) {
  const all = ((await compassRow(ctx, account._id, "classes"))?.data ?? []) as StoredClass[];
  const since = addDays(schoolToday(account.slug), -STALE_DAYS);
  const current = all.filter(c => c.lastSeen >= since).sort((a, b) => a.code.localeCompare(b.code));
  return { current, hues: huesFor(current.map(c => c.code)) };
}

type Board = { klass: ConnectClass; code: string | null; row: ConnectRow };

/**
 * Every Connect class's kept submission board, with the timetable class it belongs to: each current class finds its
 * Connect class the way the class panel does (lib/target.ts, connectClassFor), so a submission opens on the class whose
 * Work section lists it. Finished Connect classes no current class claims are left out.
 */
async function boardsOf(ctx: QueryCtx, account: Doc<"accounts">, current: StoredClass[]): Promise<Board[]> {
  if (!isWA(account.slug)) return [];
  const connectClasses = ((await connectRow(ctx, account._id, "classes"))?.data ?? []) as ConnectClass[];
  const notices = ((await connectRow(ctx, account._id, "notices"))?.data ?? []) as ConnectNotice[];
  const codeOf = new Map<number, string>();
  for (const c of current) {
    const k = connectClassFor(c.code, c.subject, c.teachers, connectClasses, notices);
    if (k && !codeOf.has(k.classId)) codeOf.set(k.classId, c.code);
  }
  const out: Board[] = [];
  for (const klass of connectClasses) {
    if (klass.finished && !codeOf.has(klass.classId)) continue;
    const row = (await readRow(ctx, account._id, "connect", connectKind(klass.classId)))?.data as ConnectRow | null | undefined;
    if (row?.list) out.push({ klass, code: codeOf.get(klass.classId) ?? null, row });
  }
  return out;
}

// ---------- grades ----------

/** How a score moved: change is in points out of 100, since the moment it is measured from. */
export type Trend = { change: number; since: number };

/** One subject in one semester: the class panel's grade (SemesterGrade), with the class it opens and how it is going. */
export type OverviewSubject = SemesterGrade & {
  /** By semester and subject, as the grade history keys it. */
  key: string;
  /** The timetable class it is (pressing it opens that class), when one on the timetable now matches it. */
  code: string | null;
  hue: number | null;
  /** What a card calls the class ("Maths"), else the subject, shortened the same way. */
  name: string;
  trend: Trend | null;
  /** The mark that came in last (by when a sync first saw it; in the outline's order for marks from before history). */
  latest: { id: number; name: string; percent: number | null; markedAt: number | null } | null;
};

export type GradeAggregate = {
  /**
   * The semester as one figure: the plain mean of the subjects' marks (each subject's own overall mark, percentOf),
   * every subject with a mark counting the same. Connect gives no credits or units to weight them by, so no other
   * weighting would be more than a guess. One decimal.
   */
  average: number | null;
  /** Subjects in the average, and every subject this semester (some have nothing marked yet). */
  counted: number;
  subjects: number;
  /** Connect's letter grades this semester, how many of each, A first. */
  letters: Array<{ letter: string; count: number }>;
  /** The average then against now, over the subjects that had a mark then (so a newly marked subject is not a jump). */
  trend: Trend | null;
  /** Assessments marked, out of every assessment this semester. */
  marked: number;
  total: number;
};

export type RecentMark = {
  key: string;
  /** The subject it is in (OverviewSubject.key). */
  subject: string;
  code: string | null;
  hue: number | null;
  name: string;
  task: string;
  percent: number | null;
  mark: number | null;
  max: number | null;
  markedAt: number;
  was: number | null;
  /** Its share of the subject's grade, out of 100. */
  share: number | null;
  spread: Spread | null;
};

export type UpcomingAssessment = {
  key: string;
  subject: string;
  code: string | null;
  hue: number | null;
  name: string;
  task: string;
  share: number | null;
  weight: number | null;
  /**
   * The piece of work it seems to be (a Compass task or a Connect submission of the same name in the same class): when
   * that is due, and whether it is handed in (then it is only waiting for its mark). Connect's outlines carry no dates.
   */
  due: string | null;
  handedIn: boolean;
};

export type OverviewGrades =
  /** No grades anywhere: not a WA public school (no Connect), and no Canvas added. */
  | { status: "none" }
  | { status: "unavailable"; reason: string }
  | { status: "loading"; source: GradeSource }
  | {
      status: "ready";
      /** Where the grades come from: Connect, or Canvas (lib/grades.ts). */
      source: GradeSource;
      fetchedAt: number;
      error: string | null;
      /** When Compass Neo began keeping this account's grade history. */
      historySince: number | null;
      /** The semester shown: the day's, or the only one Connect has. */
      semester: 1 | 2;
      aggregate: GradeAggregate;
      /** That semester's subjects, by name. */
      subjects: OverviewSubject[];
      /** The other semester's, by name. */
      other: OverviewSubject[];
      recent: RecentMark[];
      upcoming: UpcomingAssessment[];
    };

/** The point a score stood at, at a moment: the last one written at or before it (points are written as it moves). */
function pointAt(points: HistoryPoint[], at: number) {
  let out: HistoryPoint | null = null;
  for (const p of points) {
    if (p.at > at) break;
    out = p;
  }
  return out;
}

/**
 * How a subject moved: against where it stood at `from` (a week before the latest fetch, or when history began if
 * that is later), or, for a subject first seen after then, against its first point. Null with nothing to compare.
 */
function trendOf(points: HistoryPoint[], percent: number | null, from: number): Trend | null {
  if (percent == null) return null;
  const then = pointAt(points, from);
  const base = then ?? (points.length > 1 ? points[0]! : null);
  if (base?.percent == null) return null;
  return { change: round1(percent - base.percent), since: then ? from : base.at };
}

function latestOf(tasks: Assessment[]): OverviewSubject["latest"] {
  const last = tasks
    .map((t, i) => ({ t, i }))
    .filter(x => x.t.mark != null)
    .sort((a, b) => (b.t.markedAt ?? 0) - (a.t.markedAt ?? 0) || b.i - a.i)[0]?.t;
  return last ? { id: last.id, name: last.name, percent: last.percent, markedAt: last.markedAt } : null;
}

const squashName = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");

/**
 * Whether a piece of work and an assessment are the same thing, by name (Compass, Connect's submissions and its
 * outlines are kept apart, so names are all that tie them; as assessmentFor in the app): the same name, or one holding
 * the other when the shorter is long enough to mean something.
 */
function sameName(a: string, b: string) {
  const x = squashName(a);
  const y = squashName(b);
  if (x.length < 3 || y.length < 3) return false;
  if (x === y) return true;
  const short = x.length < y.length ? x : y;
  return short.length >= 8 && (x.includes(y) || y.includes(x));
}

/** The short task list the day keeps ("tasks", work.ts storeTasks): its status as a code (3 on time, 4 late). */
type ShortTask = { id: number | null; className: string | null; name: string; due: string | null; status: number | null };

/**
 * Every grade at once, for the Grades row on home and the Grades page in the side panel: the day's semester, the other
 * one, the semester as one figure, the marks as they came in, and what is still to be marked.
 */
export const grades = query({
  args: { token: v.union(v.string(), v.null()), day: v.string() },
  handler: async (ctx, { token, day }): Promise<OverviewGrades | null> => {
    if (!token || !isDay(day)) return null;
    const account = await accountFor(ctx, token);
    if (!account) return null;
    // The same answers as the class panel's ClassGrades.
    const { source, grades: gradesRow, history: historyRow } = await gradeRows(ctx, account);
    if (!source) return { status: "none" };
    if (!gradesRow?.data) {
      if (gradesRow?.error) return { status: "unavailable", reason: gradesRow.error };
      if (source === "connect" && !account.sealedLogin) return { status: "unavailable", reason: "Sign in again so Compass Neo can open Connect for you." };
      if (source === "canvas" && account.canvasRefused) return { status: "unavailable", reason: account.canvasRefused };
      return { status: "loading", source };
    }

    const all = gradesRow.data as SubjectGrade[];
    const history = (historyRow?.data ?? null) as History | null;
    const subjectOfClass = await subjectMatcher(ctx, account, source);
    const { current, hues } = await classesOf(ctx, account);
    const fetchedAt = gradesRow.fetchedAt ?? gradesRow.checkedAt;
    // Trends are measured from a week before the latest fetch, so the answer depends on the data, not the clock.
    const from = Math.max(fetchedAt - WEEK, history?.since ?? 0);

    // The day's semester, or the other when Connect has nothing for it yet (a new semester).
    const wanted = semesterOf(day);
    const semester: 1 | 2 = all.some(g => g.semester === wanted) ? wanted : (all[0]?.semester ?? wanted);
    const shown = all.filter(g => g.semester === semester);
    const rest = all.filter(g => g.semester !== semester);

    // Which class each subject is: every class on the timetable picks its subject the way its card's grade does
    // (classlist.ts). Homeroom is never a subject (its teacher may teach one). Two classes picking one subject (shared
    // teachers) go to the one whose name says so, else the first. The other semester's subject is the same class where
    // it has the same name; else a class picks it only when the names agree too (strict), since the teacher of last
    // semester's subject may well teach a different class now.
    const classOf = new Map<SubjectGrade, StoredClass>();
    const named = (c: StoredClass, g: SubjectGrade) =>
      source === "canvas" ? subjectOfClass(c, [g]) === g : !!matchSubject({ code: c.code, subject: c.subject, teachers: [] }, [g]);
    const pick = (subjects: SubjectGrade[], strict: boolean) => {
      const picked = new Map<SubjectGrade, StoredClass[]>();
      for (const c of current) {
        if (shortName(c.subject, c.code) === "Homeroom") continue;
        const g = subjectOfClass({ code: c.code, subject: c.subject, teachers: c.teachers }, subjects);
        if (g && (!strict || named(c, g))) picked.set(g, [...(picked.get(g) ?? []), c]);
      }
      for (const [g, cs] of picked) {
        if (classOf.has(g)) continue;
        const byName = cs.filter(c => named(c, g));
        classOf.set(g, byName.length === 1 ? byName[0]! : cs[0]!);
      }
    };
    pick(shown, false);
    for (const g of rest) {
      const twin = shown.find(s => squashName(s.subject) === squashName(g.subject));
      const c = twin && classOf.get(twin);
      if (c) classOf.set(g, c);
    }
    pick(
      rest.filter(g => !classOf.has(g)),
      true,
    );

    const subjectOf = (g: SubjectGrade): OverviewSubject => {
      const c = classOf.get(g) ?? null;
      const sg = semesterGrade(g, history);
      return {
        ...sg,
        key: historyKey(g.semester, g.subject),
        code: c?.code ?? null,
        hue: c ? (hues.get(c.code) ?? null) : null,
        name: c ? shortName(c.subject, c.code) : shortName(g.subject, g.subject),
        trend: trendOf(sg.points, sg.percent, from),
        latest: latestOf(sg.tasks),
      };
    };
    const byName = (a: OverviewSubject, b: OverviewSubject) => a.name.localeCompare(b.name);
    const subjects = shown.map(subjectOf).sort(byName);
    const other = rest.map(subjectOf).sort(byName);

    // The semester as one figure.
    const counted = subjects.filter(s => s.percent != null);
    const letters = new Map<string, number>();
    for (const s of subjects) if (s.letter) letters.set(s.letter, (letters.get(s.letter) ?? 0) + 1);
    const then = counted.map(s => ({ now: s.percent!, then: pointAt(s.points, from)?.percent })).filter((x): x is { now: number; then: number } => x.then != null);
    const aggregate: GradeAggregate = {
      average: counted.length ? round1(mean(counted.map(s => s.percent!))) : null,
      counted: counted.length,
      subjects: subjects.length,
      letters: [...letters.entries()].map(([letter, count]) => ({ letter, count })).sort((a, b) => a.letter.localeCompare(b.letter)),
      trend: then.length ? { change: round1(mean(then.map(x => x.now)) - mean(then.map(x => x.then))), since: from } : null,
      marked: subjects.reduce((n, s) => n + s.marked, 0),
      total: subjects.reduce((n, s) => n + s.total, 0),
    };

    // The latest marks across every subject, both semesters, by when a sync first saw them.
    const recent: RecentMark[] = [...subjects, ...other]
      .flatMap(s =>
        s.tasks
          .filter((t): t is Assessment & { markedAt: number } => t.mark != null && t.markedAt != null)
          .map(t => ({
            key: `${s.key}:${t.id}`,
            subject: s.key,
            code: s.code,
            hue: s.hue,
            name: s.name,
            task: t.name,
            percent: t.percent,
            mark: t.mark,
            max: t.max,
            markedAt: t.markedAt,
            was: t.was,
            share: t.share,
            spread: t.spread,
          })),
      )
      .sort((a, b) => b.markedAt - a.markedAt)
      .slice(0, RECENT);

    // What is still to be marked this semester and counts for something, each with the work it seems to be.
    const tasks = ((await compassRow(ctx, account._id, "tasks"))?.data ?? []) as ShortTask[];
    const boards = await boardsOf(ctx, account, current);
    const workFor = (code: string | null, name: string) => {
      if (!code) return null;
      const compass = tasks.filter(t => t.className === code && sameName(t.name, name));
      if (compass.length === 1) return { due: compass[0]!.due, handedIn: compass[0]!.status === 3 || compass[0]!.status === 4 };
      const connect = boards.filter(b => b.code === code).flatMap(b => b.row.list.filter(s => sameName(s.name, name)).map(s => ({ s, b })));
      if (connect.length === 1) {
        const { s, b } = connect[0]!;
        const state = connectState(s, b.row.mine[String(s.id)], fetchedAt);
        return { due: s.due, handedIn: state === "submitted" || state === "late" };
      }
      return null;
    };
    const at = (d: string | null) => (d ? Date.parse(d) : Infinity);
    const upcoming: UpcomingAssessment[] = subjects
      .flatMap(s =>
        s.tasks
          .filter(t => t.mark == null && finite(t.weight) && t.weight > 0)
          .map(t => {
            const w = workFor(s.code, t.name);
            return {
              key: `${s.key}:${t.id}`,
              subject: s.key,
              code: s.code,
              hue: s.hue,
              name: s.name,
              task: t.name,
              share: t.share,
              weight: t.weight,
              due: w?.due ?? null,
              handedIn: w?.handedIn ?? false,
            };
          }),
      )
      // Still to hand in first, soonest first, then the biggest share; work handed in and waiting for its mark last.
      .sort((a, b) => Number(a.handedIn) - Number(b.handedIn) || at(a.due) - at(b.due) || (b.share ?? 0) - (a.share ?? 0))
      .slice(0, UPCOMING);

    return {
      status: "ready",
      source,
      fetchedAt,
      error: gradesRow.error ?? null,
      historySince: history?.since ?? null,
      semester,
      aggregate,
      subjects,
      other,
      recent,
      upcoming,
    };
  },
});

// ---------- to do ----------

export type TodoItem = {
  /** The work item's key, as the class panel's Work section has it ("compass:4893", "connect:6973695042", "canvas:5521"). */
  key: string;
  source: "compass" | "connect" | "canvas";
  name: string;
  /** The timetable class it is for (pressing it opens that class's work), when one on the timetable now matches. */
  code: string | null;
  /** What a card calls the class ("Maths"), else what Compass or Connect calls it. */
  className: string;
  hue: number | null;
  due: string | null;
  overdue: boolean;
  /** Compass marks it important. */
  important: boolean;
  /** Nothing online keeps its hand-in (no Compass status, not handed in on Canvas), so it is listed only while its due date is near. */
  offline: boolean;
  /** The class's last lesson before it is due, from the kept timetable (lib/lessons.ts); null when that is not known. */
  lastLesson: LastLesson | null;
};

export type Todo = {
  /** Overdue first (the most recently missed first, as the class panel lists them), then by due date, undated last. */
  items: TodoItem[];
  overdue: number;
  /** Compass's learning tasks have been synced, so an empty list means nothing is due. */
  synced: boolean;
};

/**
 * Every piece of work not handed in yet, across every class: Compass's learning tasks still to do or overdue (from the
 * tasks kept in full) and Connect's open submissions not handed in (from each class's kept board). All overdue work is
 * listed, however late. A Compass task with nothing to hand in online is listed, marked offline, from
 * OFFLINE_AHEAD_DAYS before its date to OFFLINE_OVERDUE_DAYS after (overdue then), as nothing says whether it was done.
 */
export const todo = query({
  args: { token: v.union(v.string(), v.null()) },
  handler: async (ctx, { token }): Promise<Todo | null> => {
    if (!token) return null;
    const account = await accountFor(ctx, token);
    if (!account) return null;
    // Overdue is worked out against the clock, as the class panel's work query does.
    return todoFor(ctx, account, Date.now());
  },
});

/** The to-do list for an account at a moment: the query above, and the due dates in the calendar feed (calendar.ts). */
export async function todoFor(ctx: QueryCtx, account: Doc<"accounts">, now: number): Promise<Todo> {
  const { current, hues } = await classesOf(ctx, account);
  const known = new Map(current.map(c => [c.code, c]));
  const items: TodoItem[] = [];

  const detail = await readRow(ctx, account._id, "compass", "taskdetail");
  for (const t of (detail?.data ?? []) as CompassTask[]) {
    const offline = t.me?.status == null;
    const state: WorkState = compassState(t, now);
    const due = t.due ? Date.parse(t.due) : null;
    const listed = offline
      ? due != null && due >= now - OFFLINE_OVERDUE_DAYS * DAY && due <= now + OFFLINE_AHEAD_DAYS * DAY
      : state === "todo" || state === "overdue";
    if (!listed) continue;
    const c = t.className ? known.get(t.className) : undefined;
    items.push({
      key: `compass:${t.id}`,
      source: "compass",
      name: t.name,
      code: c?.code ?? null,
      className: c ? shortName(c.subject, c.code) : (t.className ?? "Compass"),
      hue: c ? (hues.get(c.code) ?? null) : null,
      due: t.due,
      overdue: offline ? due! < now : state === "overdue",
      important: t.important,
      offline,
      lastLesson: null,
    });
  }

  for (const b of await boardsOf(ctx, account, current)) {
    const c = b.code ? known.get(b.code) : undefined;
    for (const s of b.row.list) {
      const state = connectState(s, b.row.mine[String(s.id)], now);
      if (state !== "todo" && state !== "overdue") continue;
      items.push({
        key: `connect:${s.id}`,
        source: "connect",
        name: s.name,
        code: c?.code ?? null,
        className: c ? shortName(c.subject, c.code) : b.klass.name,
        hue: c ? (hues.get(c.code) ?? null) : null,
        due: s.due,
        overdue: state === "overdue",
        important: false,
        offline: false,
        lastLesson: null,
      });
    }
  }

  // Canvas's assignments with a date (Canvas's own to-do leaves undated ones out too), by where the student's own
  // submission stands; overdue ones for four weeks (CANVAS_OVERDUE_DAYS), and ones not handed in on Canvas as Compass's
  // offline tasks are.
  const view = await canvasView(ctx, account, current);
  for (const [, row] of view?.work ?? []) {
    for (const a of row.data?.assignments ?? []) {
      if (!a.due) continue;
      const state = canvasState(a, now);
      const due = Date.parse(a.due);
      const offline = state === "none";
      const listed = offline
        ? due >= now - OFFLINE_OVERDUE_DAYS * DAY && due <= now + OFFLINE_AHEAD_DAYS * DAY
        : state === "todo" || (state === "overdue" && due >= now - CANVAS_OVERDUE_DAYS * DAY);
      if (!listed) continue;
      const code = view!.classOf(a);
      const c = code ? known.get(code) : undefined;
      const course = view!.courses.find(x => x.id === a.courseId);
      items.push({
        key: `canvas:${a.id}`,
        source: "canvas",
        name: a.name,
        code: c?.code ?? null,
        className: c ? shortName(c.subject, c.code) : (course?.name ?? "Canvas"),
        hue: c ? (hues.get(c.code) ?? null) : null,
        due: a.due,
        overdue: offline ? due < now : state === "overdue" || due < now,
        important: false,
        offline,
        lastLesson: null,
      });
    }
  }

  const last = await lastLessons(ctx, account, items, now);
  for (const i of items) i.lastLesson = last.get(i.key) ?? null;

  const at = (d: string | null, none: number) => (d ? Date.parse(d) : none);
  items.sort((a, b) =>
    a.overdue !== b.overdue ? (a.overdue ? -1 : 1) : a.overdue ? at(b.due, 0) - at(a.due, 0) : at(a.due, Infinity) - at(b.due, Infinity),
  );
  return { items, overdue: items.filter(i => i.overdue).length, synced: !!detail?.data };
}
