import type { QueryCtx } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";
import type { CanvasAssignment, CanvasCourse, CanvasGroup } from "@compassneo/canvas";
import type { GradeTask, SubjectGrade } from "@compassneo/connect";
import { isWA } from "./connect";
import { readRow, type Row } from "../cache";
import type { CanvasWork } from "../canvas";
import { matchCourses, matchSubject, type ClassInfo, type SubjectInfo } from "./match";
import { currentClasses } from "./courses";

/**
 * Where an account's grades come from: Connect at a WA public school, else Canvas when the student has added it, else
 * nowhere (no Grades row). Both are kept in the same shape (Connect's SubjectGrade: subjects, tasks, weightings), beside
 * a grade history of the same kind (lib/history.ts), so everything that shows grades reads them through here.
 */
export type GradeSource = "connect" | "canvas";

export const gradeSource = (account: Pick<Doc<"accounts">, "slug" | "sealedCanvas">): GradeSource | null =>
  isWA(account.slug) ? "connect" : account.sealedCanvas ? "canvas" : null;

/** The account's grades row and history row, from wherever its grades come from. */
export async function gradeRows(ctx: QueryCtx, account: Doc<"accounts">): Promise<{ source: GradeSource | null; grades: Row | null; history: Row | null }> {
  const source = gradeSource(account);
  if (!source) return { source, grades: null, history: null };
  return { source, grades: await readRow(ctx, account._id, source, "grades"), history: await readRow(ctx, account._id, source, "history") };
}

/** Canvas ids as the numbers a task is keyed by: the id itself while it fits, else a hash of it. */
function taskId(id: string) {
  const n = Number(id);
  if (Number.isSafeInteger(n)) return n;
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

/** "9 Science" is Science, "Year 9 Mathematics Core" is Mathematics Core. */
const courseSubject = (name: string) => name.replace(/^\s*(year|yr)?\s*\d{1,2}\b\s*/i, "").trim() || name;

/** "Semester 2", "Sem2", "S1" in a name: the semester it says it is in. */
const semesterIn = (name: string | null | undefined): 1 | 2 | null => {
  const m = /\b(?:sem(?:ester)?\s*|s)([12])\b/i.exec(name ?? "");
  return m ? (Number(m[1]) as 1 | 2) : null;
};
/** A name without its semester: "Drama Sem2" is Drama, "Commerce Semester 1" is Commerce. */
const withoutSemester = (name: string) => name.replace(/\s*[-–:]?\s*\b(?:sem(?:ester)?\s*|s)[12]\b/i, "").trim() || name;
/** Assignment groups that hold everything rather than one subject's work. */
const CATCH_ALL = /^(imported )?(assignments?|assessments?|tasks?|quizzes|homework|class activities|other)$/i;
/** Written weightings that add up to the whole subject, give or take rounding. */
const WHOLE = [99, 101] as const;

type Entry = { a: CanvasAssignment; groups: CanvasGroup[]; from: CanvasCourse; formal: boolean };

/**
 * Canvas's grades in Connect's shape: one subject per timetable class (its course) and semester.
 *
 * Formal assessments: many schools keep them in a course of their own, each named for its subject, while a class's
 * own course fills with homework, checkpoint quizzes and class activities that carry points but are not the grade. A
 * mark that reaches a subject from a course no class claims (home) is formal; when two or more subjects get formal
 * marks, the school works that way, and every subject's grade is its formal assessments alone: its own course's
 * practice does not count, nor Canvas's own score for the course, which blends it in. A subject with nothing formal
 * marked yet has no mark. Formal work no class claims makes a subject of its assignment group (a group named for a
 * subject that is not on the timetable now: last semester's) once the student has a mark in it, unless the group is
 * a catch-all. A class with nothing formal at all (a form group) has no subject.
 *
 * Without such a course, a subject is its course as Canvas marks it: Canvas's own score when the course shows one, else
 * its assignments that count.
 *
 * Weightings: the teacher's own, written into each task ("Task weighting 25%"), when every task in the subject states
 * one and they make the whole; else Canvas's assignment group weights, when the course uses them (and is not in formal
 * mode); else none, and the subject is its points out of all of them. No share of the grade is ever guessed.
 *
 * Semesters: work whose assignment group or course names a semester ("Commerce Semester 1", "Drama Sem2") is that
 * semester's; the rest is the semester it is now. A mark counts once Canvas has released it.
 */
export function canvasGrades(
  courses: CanvasCourse[],
  works: Map<string, CanvasWork>,
  semester: 1 | 2,
  /** The course an assignment's mark belongs under, when it is in a course no class claims; else null. */
  home: (a: CanvasAssignment) => string | null,
  /** The courses that are a timetable class's. */
  claimed: Set<string>,
): SubjectGrade[] {
  const counts = (a: CanvasAssignment) => (a.points ?? 0) > 0 && !a.omitted && !a.submission?.excused;
  const byId = new Map(courses.map(c => [c.id, c]));
  const groupOf = (e: Pick<Entry, "a" | "groups">) => e.groups.find(g => g.id === e.a.groupId) ?? null;

  // Every assignment that counts, all year (marks; rows kept before marks were, their recent assignments), into the
  // subject it belongs to: its claimed course, the course its name names, or (formal, no class) its group's name.
  const buckets = new Map<string, Entry[]>();
  const add = (key: string, e: Entry) => buckets.set(key, [...(buckets.get(key) ?? []), e]);
  for (const c of courses) {
    const w = works.get(c.id);
    for (const a of w?.marks ?? w?.assignments ?? []) {
      if (!counts(a)) continue;
      if (claimed.has(c.id)) {
        add(c.id, { a, groups: w!.groups, from: c, formal: false });
        continue;
      }
      const to = home(a);
      if (to) add(to, { a, groups: w!.groups, from: c, formal: true });
      else {
        const g = groupOf({ a, groups: w!.groups });
        if (g && !CATCH_ALL.test(g.name.trim())) add(`group:${withoutSemester(g.name).toLowerCase()}`, { a, groups: w!.groups, from: c, formal: true });
      }
    }
  }
  const formalMode = [...buckets].filter(([key, es]) => claimed.has(key) && es.some(e => e.formal)).length >= 2;

  const out: SubjectGrade[] = [];
  for (const [key, all] of buckets) {
    const course = byId.get(key) ?? null;
    if (!course && !formalMode) continue;
    const entries = formalMode ? all.filter(e => e.formal) : all;
    const name = course ? withoutSemester(courseSubject(course.name)) : withoutSemester(groupOf(entries[0]!)?.name ?? "");
    // Nothing that counts: no subject (in formal mode, a class with no formal assessments at all, such as a form group).
    if (!entries.length) continue;

    // Split by the semester the group or course names, else this one.
    const bySemester = new Map<1 | 2, Entry[]>();
    for (const e of entries) {
      const sem = semesterIn(groupOf(e)?.name) ?? semesterIn(e.from.name) ?? semester;
      bySemester.set(sem, [...(bySemester.get(sem) ?? []), e]);
    }

    for (const [sem, list] of bySemester) {
      const written = list.map(e => e.a.weight ?? null);
      const total = written.reduce<number>((n, w) => n + (w ?? 0), 0);
      const useWritten = list.length > 0 && written.every(w => w != null) && total >= WHOLE[0] && total <= WHOLE[1];
      const useGroups = !useWritten && !formalMode && !!course?.weighted;
      const inGroup = new Map<string, number>();
      for (const { a } of list) if (a.groupId) inGroup.set(a.groupId, (inGroup.get(a.groupId) ?? 0) + a.points!);
      const tasks: GradeTask[] = list.map(e => {
        const { a } = e;
        const gw = groupOf(e)?.weight ?? 0;
        const share = useWritten ? a.weight! : useGroups && a.groupId ? (gw * a.points!) / (inGroup.get(a.groupId) || a.points!) : null;
        const s = a.submission;
        const released = s?.score != null && (s.postedAt != null || s.state === "graded");
        return {
          taskId: taskId(a.id),
          name: a.name,
          description: null,
          mark: released ? s!.score : null,
          maximumMark: a.points,
          weightedMark: null,
          weightedMaximumMark: share != null && share > 0 ? Math.round(share * 100) / 100 : null,
          group: groupOf(e)?.name ?? null,
        };
      });
      // A subject from an assignment group (none of the student's classes) is only theirs once they have a mark in it: a
      // school's assessments course is shared by the whole year, and lists every elective's tasks to everyone.
      if (!course && !tasks.some(t => t.mark != null)) continue;
      // Canvas's own score only stands for the course as Canvas marks it, this semester.
      const own = !formalMode && course && sem === semester ? course : null;
      if (!formalMode && own?.score == null && !tasks.some(t => t.mark != null)) continue;
      out.push({
        semester: sem,
        subject: name,
        area: name,
        groupId: null,
        outlineId: null,
        // The course's own name: a class finds its subject by it (subjectMatcher).
        outline: course?.name ?? groupOf(list[0] ?? entries[0]!)?.name ?? name,
        teachers: course?.teachers ?? [],
        statusLine: null,
        cumulativePercent: own?.score ?? null,
        grade: own?.grade ?? null,
        tasks,
      });
    }
  }
  return out;
}

/**
 * Which subject a timetable class's grades are under. Connect's: matchSubject (teachers, then the name). Canvas's: the
 * class's own course's, as matchCourses gives it (the same course its work and files come from), and none when no
 * course is the class's.
 */
export async function subjectMatcher(ctx: QueryCtx, account: Doc<"accounts">, source: GradeSource | null) {
  if (source !== "canvas") return <S extends SubjectInfo>(k: ClassInfo, pool: S[]) => matchSubject(k, pool);
  const courses = ((await readRow(ctx, account._id, "canvas", "courses"))?.data ?? []) as CanvasCourse[];
  const byClass = matchCourses(await currentClasses(ctx, account), courses);
  return <S extends SubjectInfo>(k: ClassInfo, pool: S[]) => {
    const course = byClass.get(k.code);
    return (course && pool.find(g => (g as SubjectInfo & { outline?: string | null }).outline === course.name)) || null;
  };
}
