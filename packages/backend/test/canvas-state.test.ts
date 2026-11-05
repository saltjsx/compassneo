import { describe, expect, test } from "bun:test";
import type { CanvasAssignment } from "@compassneo/canvas";
import { canvasState } from "../convex/canvas";

const NOW = Date.parse("2026-06-10T00:00:00Z");
const DAY = 86400_000;
const at = (days: number) => new Date(NOW + days * DAY).toISOString();
const a = (over: Partial<CanvasAssignment> = {}, sub: Partial<NonNullable<CanvasAssignment["submission"]>> | null = {}): CanvasAssignment => ({
  id: "1",
  courseId: "9",
  name: "Task",
  description: null,
  due: at(3),
  unlockAt: null,
  lockAt: null,
  points: 10,
  types: ["online_upload"],
  groupId: null,
  omitted: false,
  url: "https://canvas.example.edu.au/courses/9/assignments/1",
  submission:
    sub === null
      ? null
      : { state: "unsubmitted", submittedAt: null, late: false, missing: false, excused: false, score: null, grade: null, postedAt: null, ...sub },
  ...over,
});

describe("canvasState", () => {
  test("from the student's own submission", () => {
    expect(canvasState(a(), NOW)).toBe("todo");
    expect(canvasState(a({}, { state: "submitted", submittedAt: at(-1) }), NOW)).toBe("submitted");
    expect(canvasState(a({}, { state: "submitted", submittedAt: at(-1), late: true }), NOW)).toBe("late");
    expect(canvasState(a({}, { state: "graded", score: 8 }), NOW)).toBe("submitted");
    expect(canvasState(a({}, { excused: true }), NOW)).toBe("closed");
  });

  test("past its date, missing, or locked", () => {
    expect(canvasState(a({ due: at(-1) }), NOW)).toBe("overdue");
    expect(canvasState(a({}, { missing: true }), NOW)).toBe("overdue");
    expect(canvasState(a({ due: at(-2), lockAt: at(-1) }), NOW)).toBe("closed");
  });

  test("not handed in on Canvas", () => {
    expect(canvasState(a({ types: ["on_paper"] }), NOW)).toBe("none");
    expect(canvasState(a({ types: ["none"], due: at(-1) }), NOW)).toBe("none");
  });
});
