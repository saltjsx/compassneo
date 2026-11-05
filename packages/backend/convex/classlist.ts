import { v } from "convex/values";
import { query } from "./_generated/server";
import type { ConnectNotice, SubjectGrade } from "@compassneo/connect";
import { addDays, isDay, schoolToday } from "./lib/days";
import { huesFor, shortName, subjectName, type Person } from "./lib/match";
import { accountFor, compassRow, connectRow, gradeFrom, peopleFor, semesterOf, type Grade, type StoredClass, type StoredLesson } from "./timetable";
import { gradeRows, subjectMatcher } from "./lib/grades";

/**
 * Every class the student takes, for the list on home: each with its colour, teacher, this semester's grade and its
 * next few lessons, so any class opens in the class panel whether or not it is on the day being looked at.
 *
 * The classes are the timetable's ("classes", every class seen lately); one not seen for a few weeks (last semester's)
 * is left out. Lessons come from the kept days from today on.
 */

/** A class not on the timetable for this long is a past one. */
const STALE_DAYS = 28;
/** How far ahead the next lessons are looked for. */
const AHEAD_DAYS = 21;

export type ListedClass = {
  code: string;
  name: string;
  subject: string;
  hue: number;
  teacher: Person | null;
  /** The room it is usually in. */
  room: string | null;
  grade: Grade | null;
  /** Its next lessons from today on (the app drops any already over). */
  upcoming: Array<{ id: string; day: string; start: string; finish: string; room: string | null }>;
};

export const all = query({
  args: { token: v.union(v.string(), v.null()), day: v.string() },
  handler: async (ctx, { token, day }): Promise<ListedClass[] | null> => {
    if (!token || !isDay(day)) return null;
    const account = await accountFor(ctx, token);
    if (!account) return null;

    const today = schoolToday(account.slug);
    const classes = (((await compassRow(ctx, account._id, "classes"))?.data ?? []) as StoredClass[]).filter(
      c => c.lastSeen >= addDays(today, -STALE_DAYS),
    );
    const { source, grades: gradesRow } = await gradeRows(ctx, account);
    const grades = (gradesRow?.data ?? []) as SubjectGrade[];
    const subjectOfClass = await subjectMatcher(ctx, account, source);
    const notices = ((await connectRow(ctx, account._id, "notices"))?.data ?? []) as ConnectNotice[];

    // The kept days from today on: each class's next lessons, and the rooms it is in.
    const rows = await ctx.db
      .query("compassCache")
      .withIndex("by_account_kind", i => i.eq("accountId", account._id).gte("kind", `day:${today}`).lte("kind", `day:${addDays(today, AHEAD_DAYS)}`))
      .collect();
    const lessons = rows
      .flatMap(r => ((r.data ?? []) as StoredLesson[]).filter(l => l.isClass && !l.allDay).map(l => ({ day: r.kind.slice(4), l })))
      .sort((a, b) => a.l.start.localeCompare(b.l.start));

    const who = await peopleFor(ctx, account.slug, grades, notices, classes.flatMap(c => c.teachers));
    const hues = huesFor(classes.map(c => c.code));
    const semester = semesterOf(day);
    const pool = grades.filter(g => g.semester === semester).length ? grades.filter(g => g.semester === semester) : grades;

    return classes
      .map(c => {
        const mine = lessons.filter(x => x.l.code === c.code);
        const rooms = new Map<string, number>();
        for (const { l } of mine) {
          const room = l.coverRoom ?? l.room;
          if (room) rooms.set(room, (rooms.get(room) ?? 0) + 1);
        }
        const g = subjectOfClass({ code: c.code, subject: c.subject, teachers: c.teachers }, pool);
        const next = mine[0]?.l;
        return {
          code: c.code,
          name: shortName(c.subject, c.code),
          subject: subjectName(c.subject, c.code),
          hue: hues.get(c.code) ?? 0,
          // Who takes it most: the teacher of its next lesson, else the first it has had.
          teacher: who(next?.teacher ?? c.teachers[0] ?? null),
          room: [...rooms.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null,
          grade: g ? gradeFrom(g) : null,
          upcoming: mine.slice(0, 4).map(({ day, l }) => ({ id: l.id, day, start: l.start, finish: l.finish, room: l.coverRoom ?? l.room })),
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  },
});
