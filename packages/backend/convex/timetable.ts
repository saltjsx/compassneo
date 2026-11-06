import { v } from "convex/values";
import { action, internalMutation, query, type ActionCtx, type QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { getCalendarEvents, type CompassSession } from "@compassneo/compass";
import { percentOf, scoreOf, type ConnectNotice, type SubjectGrade } from "@compassneo/connect";
import { hashToken } from "./lib/crypto";
import { isAgentToken, readAgentToken } from "./lib/agent";
import { same } from "./lib/same";
import { deviceAccount, withCompass, type Problem } from "./lib/compass";
import { addDays, dayOf, daysBetween, isDay, schoolToday } from "./lib/days";
import { huesFor, shortName, subjectName, teacherDirectory, type Person } from "./lib/match";
import { key as teacherKey, teachersFor } from "./teachers";
import { layAssemblies, noticesFor, type DayAssembly, type LessonAssembly } from "./lib/assemblies";
import { gradeRows, subjectMatcher } from "./lib/grades";

export type { DayAssembly, LessonAssembly } from "./lib/assemblies";

/**
 * The timetable, one school day at a time.
 *
 * The sync fetches a window around today (WINDOW_BEHIND days back, WINDOW_AHEAD on) and keeps one compassCache row per
 * day ("day:YYYY-MM-DD", empty on a day without classes, so a weekend is known to be empty rather than missing). A day
 * outside the window is fetched when someone opens it (load). The day query joins each lesson to its teacher's name,
 * its colour, its grades from Connect and its learning tasks, so every client gets the same answer.
 */

export const WINDOW_BEHIND = 7;
export const WINDOW_AHEAD = 14;
/** Days kept around today; the rest are dropped as the window moves on. */
const KEEP_BEHIND = 45;
const KEEP_AHEAD = 120;
/** Classes not seen on the timetable for this long are forgotten (a new semester's timetable). */
const FORGET_CLASS_DAYS = 120;

/** A calendar entry as kept: the scheduled room and teacher, and any cover (a room change, a relief teacher). */
export type StoredLesson = {
  id: string;
  code: string;
  subject: string | null;
  start: string;
  finish: string;
  period: number | null;
  room: string | null;
  coverRoom: string | null;
  teacher: string | null;
  cover: string | null;
  /** Compass user ids for the teacher and the relief, where the calendar gave them (convex/teachers.ts). */
  teacherId?: number | null;
  coverId?: number | null;
  isClass: boolean;
  allDay: boolean;
  /** Compass's id for the class (its activity), which opens its resources. Missing on days kept before it was. */
  activityId?: number | null;
};

/** A class seen on the timetable lately, with every teacher scheduled for it, and Compass's id for it. */
export type StoredClass = { code: string; subject: string | null; teachers: string[]; lastSeen: string; activityId?: number | null };

export type Grade = {
  subject: string;
  semester: 1 | 2;
  /** Out of 100, worked out from the marked tasks; null until something is marked. */
  percent: number | null;
  letter: string | null;
  marked: number;
  total: number;
  tasks: Array<{ id: number; name: string; mark: number | null; max: number | null; weight: number | null }>;
};

export type Lesson = {
  id: string;
  code: string;
  /** What a card calls it: "Maths", "HASS". */
  name: string;
  /** The whole subject: "Mathematics", "Humanities & Social Sciences". */
  subject: string;
  start: string;
  finish: string;
  period: number | null;
  /** Where it is now; roomWas is the room it moved from, when it moved. */
  room: string | null;
  roomWas: string | null;
  /** Who takes it; teacherWas is the teacher a relief is covering for. */
  teacher: Person | null;
  teacherWas: Person | null;
  /** The class's colour, 0 to HUES - 1, the same every day. */
  hue: number;
  grade: Grade | null;
  /** The class's learning tasks due around this day. */
  tasks: Array<{ id: number | null; name: string; due: string | null }>;
  /** An assembly that takes all or part of it, from the school's notices (convex/announcements.ts, lib/assemblies.ts). */
  assembly?: LessonAssembly;
  /** The times Compass has for it, when a notice's revised bell schedule moved it (start and finish are the new ones). */
  timesWas?: { start: string; finish: string };
};

export type DayEvent = { id: string; title: string; start: string; finish: string; allDay: boolean };

export type Day =
  | { status: "ready"; day: string; lessons: Lesson[]; events: DayEvent[]; assemblies?: DayAssembly[] }
  /** Not fetched yet: the client asks for it with load. */
  | { status: "missing"; day: string };

/**
 * Which period each of a day's classes is, counted by the app rather than taken from Compass: Compass numbers its bell
 * slots, and homeroom has one, so the first class after an 8:50 start comes through as "period 2". Here homeroom is no
 * period, and the rest are numbered by start time from 1 (two classes starting together share a number).
 */
export function periodsOf(items: StoredLesson[]) {
  const counted = (l: StoredLesson) => l.isClass && !l.allDay && shortName(l.subject, l.code) !== "Homeroom";
  const starts = [...new Set(items.filter(counted).map(l => Date.parse(l.start)))].sort((a, b) => a - b);
  return new Map(items.map(l => [l.id, counted(l) ? starts.indexOf(Date.parse(l.start)) + 1 : null]));
}

// ---------- fetching ----------

const text = (x: unknown) => (typeof x === "string" && x.trim() ? x.trim() : null);

/**
 * Fetches the timetable from one day to another (both included) and keeps it. Returns how many lessons it holds, and
 * the field names Compass gives a lesson's teacher (so a sync can say where a school keeps teachers' details).
 */
export async function fetchDays(ctx: ActionCtx, account: Doc<"accounts">, s: CompassSession, from: string, to: string) {
  const events = await getCalendarEvents(s, { startDate: from, endDate: to, limit: 600 });
  const lessons: StoredLesson[] = events.map(e => {
    const room = text(e.room);
    const coverRoom = text(e.coveringRoom);
    const teacher = text(e.teacher);
    const cover = text(e.coveringTeacher);
    return {
      id: e.instanceId ?? `${e.title}@${e.start}`,
      code: e.title,
      subject: text(e.subjectLongName) ?? text(e.longTitle),
      start: e.start,
      finish: e.finish,
      period: e.period,
      room,
      coverRoom: coverRoom && coverRoom !== room ? coverRoom : null,
      teacher,
      cover: cover && cover !== teacher ? cover : null,
      teacherId: e.teacherId,
      coverId: cover && cover !== teacher ? e.coveringTeacherId : null,
      isClass: e.activityType === 1,
      allDay: e.allDay,
      activityId: e.activityId && e.activityId > 0 ? e.activityId : null,
    };
  });
  const days = daysBetween(from, to).map(day => ({
    day,
    items: lessons.filter(l => dayOf(l.start, account.slug) === day).sort((a, b) => a.start.localeCompare(b.start)),
  }));
  await ctx.runMutation(internal.timetable.keepDays, { accountId: account._id, days });
  return { lessons: lessons.filter(l => l.isClass).length, teacherFields: [...new Set(events.flatMap(e => e.teacherFields))].sort() };
}

/** Opening a day the sync has not fetched: fetches it and the fortnight around it. The day query updates by itself. */
export const load = action({
  args: { token: v.string(), day: v.string() },
  handler: async (ctx, { token, day }): Promise<{ ok: true } | Problem> => {
    if (!isDay(day)) return { ok: false, code: "unavailable", message: "That is not a day." };
    const account = await deviceAccount(ctx, token, { reader: true });
    if (!account) return { ok: false, code: "signed-out", message: "This device is signed out." };
    const today = schoolToday(account.slug);
    if (day < addDays(today, -365) || day > addDays(today, 365)) return { ok: false, code: "unavailable", message: "Compass Neo shows a year either way." };
    const r = await withCompass(ctx, account, s => fetchDays(ctx, account, s, addDays(day, -3), addDays(day, 10)));
    return r.ok ? { ok: true } : r;
  },
});

// ---------- reading ----------

/**
 * The account a device's token is for. An AI's link (lib/agent.ts) is taken too, but only by a query: it reads
 * everything a page does and changes nothing, so a mutation (whose db can insert) is never handed its account.
 */
export async function accountFor(ctx: QueryCtx, token: string) {
  if (isAgentToken(token)) return "insert" in ctx.db ? null : readAgentToken(ctx, token);
  const tokenHash = await hashToken(token);
  const session = await ctx.db.query("sessions").withIndex("by_token", i => i.eq("tokenHash", tokenHash)).first();
  return session && ctx.db.get(session.accountId);
}

export const compassRow = (ctx: QueryCtx, accountId: Id<"accounts">, kind: string) =>
  ctx.db.query("compassCache").withIndex("by_account_kind", i => i.eq("accountId", accountId).eq("kind", kind)).unique();
export const connectRow = (ctx: QueryCtx, accountId: Id<"accounts">, kind: string) =>
  ctx.db.query("connectCache").withIndex("by_account_kind", i => i.eq("accountId", accountId).eq("kind", kind)).unique();

/**
 * Teacher codes to people: names from Connect (subject teachers, notice authors), then Compass's own name and photo
 * where the sync has looked the teacher up.
 */
export async function peopleFor(ctx: QueryCtx, slug: string, grades: SubjectGrade[], notices: ConnectNotice[], codes: Array<string | null>) {
  const directory = teacherDirectory([...grades.flatMap(g => g.teachers), ...notices.map(n => n.author).filter((a): a is string => !!a)]);
  const known = await teachersFor(ctx, slug, codes);
  return (code: string | null): Person | null => {
    const p = directory(code);
    if (!p || !code) return p;
    const k = known.get(teacherKey(code));
    const full = p.full ?? k?.name ?? null;
    const words = k?.name?.trim().split(/\s+/) ?? [];
    // Initial and surname from Compass's name when Connect did not know the teacher.
    const name = !p.full && words.length > 1 ? `${words[0]![0]!.toUpperCase()}. ${words[words.length - 1]}` : p.name;
    return { ...p, name, full, photoUrl: k?.photoUrl ?? null };
  };
}

/** A Connect subject as a lesson carries it: the score worked out from its tasks (scoreOf) and Connect's letter. */
export function gradeFrom(g: SubjectGrade): Grade {
  const score = scoreOf(g.tasks);
  const percent = percentOf(g);
  return {
    subject: g.subject,
    semester: g.semester,
    percent,
    letter: g.grade,
    marked: score.marked,
    total: score.total,
    tasks: g.tasks.map(t => ({ id: t.taskId, name: t.name, mark: t.mark, max: t.maximumMark, weight: t.weightedMaximumMark })),
  };
}

/** The semester a day falls in: July on is the second. */
export const semesterOf = (day: string): 1 | 2 => (Number(day.slice(5, 7)) >= 7 ? 2 : 1);

/**
 * One school day: its lessons, each with its teacher, colour, grades and tasks, anything else on (tasks due), and the
 * assemblies the school's notices announce for it.
 */
export const day = query({
  args: { token: v.union(v.string(), v.null()), day: v.string() },
  handler: async (ctx, { token, day }): Promise<Day | null> => {
    if (!token || !isDay(day)) return null;
    const account = await accountFor(ctx, token);
    if (!account) return null;
    const row = await compassRow(ctx, account._id, `day:${day}`);
    if (!row) return { status: "missing", day };
    return (await readDays(ctx, account, [{ day, items: (row.data ?? []) as StoredLesson[] }]))[0]!;
  },
});

/**
 * Kept days as the app shows them: each lesson joined to its teacher, colour, grades and tasks, the day's other
 * entries, and the notices' assemblies laid over it. What every day shares (classes, grades, tasks, teachers, notices)
 * is read once, so many days cost little more than one (the calendar feed, calendar.ts).
 */
export async function readDays(ctx: QueryCtx, account: Doc<"accounts">, days: Array<{ day: string; items: StoredLesson[] }>): Promise<Day[]> {
  if (!days.length) return [];
  const classes = ((await compassRow(ctx, account._id, "classes"))?.data ?? []) as StoredClass[];
  const { source, grades: gradesRow } = await gradeRows(ctx, account);
  const grades = (gradesRow?.data ?? []) as SubjectGrade[];
  const subjectOfClass = await subjectMatcher(ctx, account, source);
  const notices = ((await connectRow(ctx, account._id, "notices"))?.data ?? []) as ConnectNotice[];
  const tasks = ((await compassRow(ctx, account._id, "tasks"))?.data ?? []) as Array<{
    id: number | null;
    className: string | null;
    name: string;
    due: string | null;
  }>;

  const who = await peopleFor(
    ctx,
    account.slug,
    grades,
    notices,
    days.flatMap(d => d.items.flatMap(l => [l.teacher, l.cover])),
  );
  const hues = huesFor([...classes.map(c => c.code), ...days.flatMap(d => d.items.filter(l => l.isClass).map(l => l.code))]);
  const sorted = days.map(d => d.day).sort();
  const news = await noticesFor(ctx, account, addDays(sorted[0]!, -30), addDays(sorted[sorted.length - 1]!, 1));

  return days.map(({ day, items }) => {
    // Grades for the semester this day is in, else the other one (a new semester before Connect has it).
    const semester = semesterOf(day);
    const inSemester = grades.filter(g => g.semester === semester);
    const pool = inSemester.length ? inSemester : grades;
    const gradeFor = new Map<string, Grade | null>();
    const gradeOf = (l: StoredLesson): Grade | null => {
      if (gradeFor.has(l.code)) return gradeFor.get(l.code)!;
      const known = classes.find(c => c.code === l.code);
      const teachers = [...new Set([...(known?.teachers ?? []), ...(l.teacher ? [l.teacher] : [])])];
      const g = subjectOfClass({ code: l.code, subject: l.subject, teachers }, pool);
      const out = g ? gradeFrom(g) : null;
      gradeFor.set(l.code, out);
      return out;
    };

    const from = addDays(day, -7);
    const to = addDays(day, 28);
    const periods = periodsOf(items);
    const lessons: Lesson[] = items
      .filter(l => l.isClass && !l.allDay)
      .map(l => ({
        id: l.id,
        code: l.code,
        name: shortName(l.subject, l.code),
        subject: subjectName(l.subject, l.code),
        start: l.start,
        finish: l.finish,
        period: periods.get(l.id) ?? null,
        room: l.coverRoom ?? l.room,
        roomWas: l.coverRoom ? l.room : null,
        teacher: who(l.cover ?? l.teacher),
        teacherWas: l.cover ? who(l.teacher) : null,
        hue: hues.get(l.code) ?? 0,
        grade: gradeOf(l),
        tasks: tasks
          .filter(t => t.className === l.code && (!t.due || (dayOf(t.due, account.slug) >= from && dayOf(t.due, account.slug) <= to)))
          .slice(0, 8)
          .map(t => ({ id: t.id, name: t.name, due: t.due })),
      }));
    const events: DayEvent[] = items
      .filter(l => !l.isClass || l.allDay)
      .map(l => ({ id: l.id, title: l.code, start: l.start, finish: l.finish, allDay: l.allDay }));

    // The school's notices over it: assemblies at their times, and the lessons they take marked. Laid here, at read
    // time, so a corrected notice (or a fresh read of one) changes the day without touching what Compass said.
    const laid = layAssemblies(lessons, day, news, account);
    return { status: "ready" as const, day, lessons: laid.lessons, events, assemblies: laid.assemblies };
  });
}

// ---------- keeping ----------

/** Keeps fetched days (each replacing the last copy, written only when it changed) and the classes seen on them. */
export const keepDays = internalMutation({
  args: { accountId: v.id("accounts"), days: v.array(v.object({ day: v.string(), items: v.any() })) },
  handler: async (ctx, { accountId, days }) => {
    const account = await ctx.db.get(accountId);
    if (!account) return;
    const now = Date.now();
    const put = async (kind: string, data: unknown) => {
      const row = await ctx.db.query("compassCache").withIndex("by_account_kind", i => i.eq("accountId", accountId).eq("kind", kind)).unique();
      if (!row) await ctx.db.insert("compassCache", { accountId, kind, data, fetchedAt: now });
      else if (!same(row.data, data)) await ctx.db.patch(row._id, { data, fetchedAt: now });
    };

    for (const { day, items } of days) if (isDay(day)) await put(`day:${day}`, items);

    // The classes seen lately, for colours that stay put and for matching grades by every teacher a class has had.
    const today = schoolToday(account.slug);
    const known = new Map<string, StoredClass>();
    const prior = await ctx.db.query("compassCache").withIndex("by_account_kind", i => i.eq("accountId", accountId).eq("kind", "classes")).unique();
    for (const c of (prior?.data ?? []) as StoredClass[]) if (c.lastSeen >= addDays(today, -FORGET_CLASS_DAYS)) known.set(c.code, c);
    for (const { day, items } of days) {
      for (const l of items as StoredLesson[]) {
        if (!l.isClass || !l.code) continue;
        const c = known.get(l.code) ?? { code: l.code, subject: l.subject, teachers: [], lastSeen: day };
        if (l.teacher && !c.teachers.includes(l.teacher)) c.teachers.push(l.teacher);
        if (l.activityId) c.activityId = l.activityId;
        if (day >= c.lastSeen) {
          c.lastSeen = day;
          c.subject = l.subject ?? c.subject;
        }
        known.set(l.code, c);
      }
    }
    await put("classes", [...known.values()].sort((a, b) => a.code.localeCompare(b.code)));

    // Days far from today go, so the cache follows the calendar instead of growing with it.
    const rows = await ctx.db
      .query("compassCache")
      .withIndex("by_account_kind", i => i.eq("accountId", accountId).gte("kind", "day:").lt("kind", "day;"))
      .collect();
    const keepFrom = addDays(today, -KEEP_BEHIND);
    const keepTo = addDays(today, KEEP_AHEAD);
    for (const r of rows) {
      const d = r.kind.slice(4);
      if (d < keepFrom || d > keepTo) await ctx.db.delete(r._id);
    }
    // The single-row timetable from before days were kept one by one.
    const old = await ctx.db.query("compassCache").withIndex("by_account_kind", i => i.eq("accountId", accountId).eq("kind", "timetable")).unique();
    if (old) await ctx.db.delete(old._id);
  },
});
