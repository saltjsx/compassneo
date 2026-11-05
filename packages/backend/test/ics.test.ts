import { expect, test } from "bun:test";
import { calendar } from "../convex/lib/ics";

const lines = (events: Parameters<typeof calendar>[0]["events"]) =>
  calendar({ name: "Compass Neo", zone: "Australia/Sydney", now: Date.parse("2026-06-01T00:00:00Z"), events }).split("\r\n");

test("text is escaped as RFC 5545 asks", () => {
  const out = lines([{ uid: "u", summary: "Maths; then, \\ room\nB2", start: "2026-06-02T00:00:00Z", end: "2026-06-02T01:00:00Z" }]);
  expect(out).toContain("SUMMARY:Maths\\; then\\, \\\\ room\\nB2");
});

test("times are UTC; all-day entries are dates with an exclusive end", () => {
  const out = lines([
    { uid: "a", summary: "Lesson", start: "2026-06-02T00:00:00.000Z", end: "2026-06-02T00:55:00.000Z" },
    { uid: "b", summary: "Due", start: "2026-06-03", end: "2026-06-04", allDay: true },
  ]);
  expect(out).toContain("DTSTART:20260602T000000Z");
  expect(out).toContain("DTEND:20260602T005500Z");
  expect(out).toContain("DTSTART;VALUE=DATE:20260603");
  expect(out).toContain("DTEND;VALUE=DATE:20260604");
});

test("long lines fold at 75 octets without splitting a character", () => {
  const out = lines([{ uid: "u", summary: "é".repeat(100), start: "2026-06-02T00:00:00Z", end: "2026-06-02T01:00:00Z" }]);
  const enc = new TextEncoder();
  for (const l of out) expect(enc.encode(l).length).toBeLessThanOrEqual(75);
  const unfolded = out.join("\r\n").replace(/\r\n /g, "");
  expect(unfolded).toContain(`SUMMARY:${"é".repeat(100)}`);
});

test("lines end in CRLF and the calendar is closed", () => {
  const text = calendar({ name: "x", zone: "Australia/Perth", now: 0, events: [] });
  expect(text.endsWith("END:VCALENDAR\r\n")).toBe(true);
  expect(text.split("\r\n").every(l => !l.includes("\n"))).toBe(true);
});
