import { expect, test } from "bun:test";
import type { CanvasAssignment, CanvasCourse } from "@compassneo/canvas";
import { canvasGrades } from "../convex/lib/grades";
import { percentOf } from "@compassneo/connect";

const course = (id: string, over: Partial<CanvasCourse> = {}): CanvasCourse => ({
  id,
  name: `9 Subject ${id}`,
  code: null,
  term: null,
  teachers: [],
  score: null,
  grade: null,
  weighted: false,
  url: "",
  ...over,
});
const task = (id: string, courseId: string, points: number, score: number | null, over: Partial<CanvasAssignment> = {}): CanvasAssignment => ({
  id,
  courseId,
  name: `Task ${id}`,
  description: null,
  due: null,
  unlockAt: null,
  lockAt: null,
  points,
  types: ["online_upload"],
  groupId: "g",
  omitted: false,
  url: "",
  submission: { state: score == null ? "unsubmitted" : "graded", submittedAt: null, late: false, missing: false, excused: false, score, grade: null, postedAt: score == null ? null : "2026-05-01T00:00:00Z" },
  ...over,
});
const work = (marks: CanvasAssignment[], weights: Record<string, number> = { g: 0 }) => ({
  assignments: [],
  groups: Object.entries(weights).map(([id, weight]) => ({ id, name: id, weight })),
  marks,
});

test("an unweighted subject is its points out of all of them, with no share of the grade claimed", () => {
  const [s] = canvasGrades([course("1")], new Map([["1", work([task("a", "1", 20, 15), task("b", "1", 80, 60), task("c", "1", 50, null)])]]), 1, () => null, new Set(["1"]));
  expect(s!.tasks.every(t => t.weightedMaximumMark == null)).toBe(true);
  expect(percentOf(s!)).toBe(75);
});

test("a weighted course keeps Canvas's own group weights", () => {
  const w = work([task("a", "1", 10, 5, { groupId: "exams" }), task("b", "1", 10, 10, { groupId: "homework" })], { exams: 70, homework: 30 });
  const [s] = canvasGrades([course("1", { weighted: true })], new Map([["1", w]]), 1, () => null, new Set(["1"]));
  expect(s!.tasks.map(t => t.weightedMaximumMark)).toEqual([70, 30]);
  expect(percentOf(s!)).toBe(65);
});

test("a mark in an unclaimed course goes to the subject it names; the course itself is no subject", () => {
  const works = new Map([
    ["1", work([task("a", "1", 10, 10)])],
    ["9", work([task("exam", "9", 100, 50)])],
  ]);
  const out = canvasGrades([course("1"), course("9")], works, 2, x => (x.id === "exam" ? "1" : null), new Set(["1"]));
  expect(out.map(s => s.outline)).toEqual(["9 Subject 1"]);
  expect(out[0]!.tasks.map(t => t.name)).toEqual(["Task a", "Task exam"]);
  expect(percentOf(out[0]!)).toBeCloseTo(54.5, 1);
});

test("unreleased, excused and omitted work does not count; the course's own score wins", () => {
  const w = work([
    task("a", "1", 10, 9, { submission: { state: "submitted", submittedAt: null, late: false, missing: false, excused: false, score: 9, grade: null, postedAt: null } }),
    task("b", "1", 10, null, { submission: { state: "unsubmitted", submittedAt: null, late: false, missing: false, excused: true, score: null, grade: null, postedAt: null } }),
    task("c", "1", 10, 3, { omitted: true }),
  ]);
  const [s] = canvasGrades([course("1", { score: 88 })], new Map([["1", w]]), 1, () => null, new Set(["1"]));
  expect(s!.tasks.map(t => t.name)).toEqual(["Task a"]);
  expect(s!.tasks[0]!.mark).toBeNull();
  expect(percentOf(s!)).toBe(88);
});

test("a course with nothing marked and no score is left out", () => {
  expect(canvasGrades([course("1")], new Map([["1", work([task("a", "1", 10, null)])]]), 1, () => null, new Set(["1"]))).toEqual([]);
});

// ---------- a school that keeps its formal assessments in a course of their own ----------

const formal = (id: string, name: string, points: number, score: number | null, group: string, weight: number | null = null) =>
  task(id, "A", points, score, { name, groupId: group, weight });
const assessments = () =>
  work(
    [
      formal("m1", "Maths Task 1", 50, 40, "maths", 40),
      formal("m2", "Maths Task 2", 50, null, "maths", 60),
      formal("s1", "Science Task 1", 20, 10, "science"),
      formal("h1", "Commerce Semester 1 Task 1", 10, 9, "commerce-s1"),
      formal("e1", "Economics Semester 2 Task 1", 10, null, "economics-s2"),
      formal("x1", "Assembly reflection", 10, 10, "imported"),
    ],
    { maths: 0, science: 0, "commerce-s1": 0, "economics-s2": 0, imported: 0 },
  );
const named = (w: ReturnType<typeof work>, names: Record<string, string>) => ({ ...w, groups: w.groups.map(g => ({ ...g, name: names[g.id] ?? g.id })) });
const school = () => {
  const courses = [course("1", { name: "9 Mathematics", score: 97 }), course("2", { name: "9 Science" }), course("A", { name: "Year 9 Assessments" })];
  const works = new Map([
    ["1", work([task("hw", "1", 1, 1)])],
    ["2", work([task("quiz", "2", 10, 10)])],
    ["A", named(assessments(), { maths: "Maths", science: "Science", "commerce-s1": "Commerce Semester 1", "economics-s2": "Economics Semester 2", imported: "Imported Assignments" })],
  ]);
  const home = (a: CanvasAssignment) => (a.groupId === "maths" ? "1" : a.groupId === "science" ? "2" : null);
  return canvasGrades(courses, works, 2, home, new Set(["1", "2"]));
};

test("formal assessments alone make the grade: no homework, no blended course score", () => {
  const maths = school().find(s => s.subject === "Mathematics")!;
  expect(maths.tasks.map(t => t.name)).toEqual(["Maths Task 1", "Maths Task 2"]);
  expect(maths.cumulativePercent).toBeNull();
  const science = school().find(s => s.subject === "Science")!;
  expect(science.tasks.map(t => t.name)).toEqual(["Science Task 1"]);
  expect(percentOf(science)).toBe(50);
});

test("weightings written into every task, making the whole, are used", () => {
  const maths = school().find(s => s.subject === "Mathematics")!;
  expect(maths.tasks.map(t => t.weightedMaximumMark)).toEqual([40, 60]);
  expect(percentOf(maths)).toBe(80);
});

test("written weightings that do not make the whole are not used", () => {
  const w = work([task("a", "1", 10, 5, { weight: 30 }), task("b", "1", 10, 10)]);
  const [s] = canvasGrades([course("1")], new Map([["1", w]]), 1, () => null, new Set(["1"]));
  expect(s!.tasks.every(t => t.weightedMaximumMark == null)).toBe(true);
});

test("an assessments group named for a semester's subject is that semester's, once there is a mark in it", () => {
  const out = school();
  const history = out.find(s => s.subject === "Commerce")!;
  expect(history.semester).toBe(1);
  expect(percentOf(history)).toBe(90);
  expect(out.some(s => s.subject === "Economics")).toBe(false);
  expect(out.some(s => /imported/i.test(s.subject))).toBe(false);
  expect(out.some(s => /assessments/i.test(s.subject))).toBe(false);
});
