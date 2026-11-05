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

/**
 * Canvas's grades in Connect's shape: a subject for each course that is a timetable class's, or that shows the student
 * a score of its own. Its tasks are the assignments that count (points, not left out of the grade, not excused), with
 * the ones from a course no class claims that belong to it by name (home: a school's course of formal assessments puts
 * each subject's exams there). A mark counts once Canvas has released it; the course's own score, when it shows one, is
 * the subject's overall mark.
 *
 * Weightings are only ever Canvas's own: assignment group weights shared by points, when the course weights its
 * groups. Otherwise (and in a subject that took tasks from another course, whose groups mean nothing here) a task has
 * no weighting, and the subject's mark is its points out of all of them, as Canvas works an unweighted course out
 * (scoreOf's raw marks). Schools often weight formal tasks in words in the task itself; Compass Neo never guesses a
 * share of the grade from points.
 */
export function canvasGrades(
  courses: CanvasCourse[],
  works: Map<string, CanvasWork>,
  semester: 1 | 2,
  /** The course an assignment's mark belongs under, or null for its own. */
  home: (a: CanvasAssignment) => string | null,
  /** The courses that are a timetable class's. */
  claimed: Set<string>,
): SubjectGrade[] {
  const counts = (a: CanvasAssignment) => (a.points ?? 0) > 0 && !a.omitted && !a.submission?.excused;
  const into = new Map<string, Array<{ a: CanvasAssignment; groups: CanvasGroup[]; moved: boolean }>>();
  for (const c of courses) {
    const w = works.get(c.id);
    // Every assignment that counts, all year (marks); rows kept before marks were, their recent assignments.
    for (const a of w?.marks ?? w?.assignments ?? []) {
      if (!counts(a)) continue;
      const to = claimed.has(c.id) ? c.id : (home(a) ?? c.id);
      into.set(to, [...(into.get(to) ?? []), { a, groups: w!.groups, moved: to !== c.id }]);
    }
  }

  const out: SubjectGrade[] = [];
  for (const c of courses) {
    if (!claimed.has(c.id) && c.score == null) continue;
    const list = into.get(c.id) ?? [];
    const byPoints = !c.weighted || list.some(x => x.moved);
    const inGroup = new Map<string, number>();
    for (const { a } of list) if (a.groupId) inGroup.set(a.groupId, (inGroup.get(a.groupId) ?? 0) + a.points!);
    const tasks: GradeTask[] = list.map(({ a, groups }) => {
      const gw = groups.find(g => g.id === a.groupId)?.weight ?? 0;
      const share = byPoints ? null : a.groupId ? (gw * a.points!) / (inGroup.get(a.groupId) || a.points!) : null;
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
        group: groups.find(g => g.id === a.groupId)?.name ?? null,
      };
    });
    if (c.score == null && !tasks.some(t => t.mark != null)) continue;
    const subject = courseSubject(c.name);
    out.push({
      semester,
      subject,
      area: subject,
      groupId: null,
      outlineId: null,
      outline: c.name,
      teachers: c.teachers,
      statusLine: null,
      cumulativePercent: c.score,
      grade: c.grade,
      tasks,
    });
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
