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
