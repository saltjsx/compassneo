import { expect, test } from "bun:test";
import { lastLessons } from "../convex/lib/lessons";

// A WA school (fixed +8, no daylight saving), so the instants below read plainly in local time.
const account = { _id: "acc", slug: "examplehs-wa" } as never;
const local = (day: string, hm: string) => new Date(`${day}T${hm}:00+08:00`).toISOString();
const lesson = (day: string, hm: string, code: string, id = `${day}-${hm}`) => ({
  id,
  code,
  subject: code,
  start: local(day, hm),
  finish: local(day, hm),
  period: null,
  room: null,
  coverRoom: null,
  teacher: null,
  cover: null,
  isClass: true,
  allDay: false,
});

/** Just enough of Convex's db for one indexed range read of kept days. */
function ctxWith(days: Record<string, ReturnType<typeof lesson>[]>) {
  return {
    db: {
      query: () => ({
        withIndex: (_: string, range: (i: any) => unknown) => {
          let lo = "";
          let hi = "￿";
          const i: any = { eq: () => i, gte: (_: string, v: string) => ((lo = v), i), lte: (_: string, v: string) => ((hi = v), i) };
          range(i);
          return {
            collect: async () =>
              Object.entries(days)
                .map(([d, data]) => ({ kind: `day:${d}`, data }))
                .filter(r => r.kind >= lo && r.kind <= hi),
          };
        },
      }),
    },
  } as never;
}

// Monday 1 June 2026, 10:00 at the school. Kept: Monday to Thursday; Wednesday has no Maths.
const now = Date.parse(local("2026-06-01", "10:00"));
const days = {
  "2026-06-01": [lesson("2026-06-01", "09:00", "MAT"), lesson("2026-06-01", "13:00", "MAT")],
  "2026-06-02": [lesson("2026-06-02", "09:00", "ENG"), lesson("2026-06-02", "11:00", "MAT")],
  "2026-06-03": [lesson("2026-06-03", "09:00", "ENG")],
  "2026-06-04": [lesson("2026-06-04", "09:00", "MAT")],
};

test("the last lesson of the class still to start before it is due, with its period", async () => {
  const r = await lastLessons(ctxWith(days), account, [{ key: "w", code: "MAT", due: local("2026-06-03", "23:59") }], now);
  expect(r.get("w")).toEqual({ kind: "lesson", day: "2026-06-02", start: local("2026-06-02", "11:00"), period: 2 });
});

test("a lesson on the due day counts only if it starts before the due time", async () => {
  const r = await lastLessons(ctxWith(days), account, [{ key: "w", code: "MAT", due: local("2026-06-04", "08:00") }], now);
  expect(r.get("w")).toMatchObject({ kind: "lesson", day: "2026-06-02" });
});

test("none left: every day kept, no lesson of the class still to start", async () => {
  const r = await lastLessons(ctxWith(days), account, [{ key: "w", code: "ENG", due: local("2026-06-02", "08:00") }], now);
  expect(r.get("w")).toEqual({ kind: "none" });
});

test("unknown: a day before the due date is not kept, or it is already due, or has no class", async () => {
  const r = await lastLessons(
    ctxWith(days),
    account,
    [
      { key: "far", code: "MAT", due: local("2026-06-08", "09:00") },
      { key: "past", code: "MAT", due: local("2026-06-01", "08:00") },
      { key: "nocls", code: null, due: local("2026-06-03", "09:00") },
    ],
    now,
  );
  expect(r.get("far")).toBeNull();
  expect(r.get("past")).toBeNull();
  expect(r.get("nocls")).toBeNull();
});
