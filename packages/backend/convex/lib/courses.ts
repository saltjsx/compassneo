import type { QueryCtx } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";
import type { CanvasAnnouncement, CanvasAssignment, CanvasCourse } from "@compassneo/canvas";
import { readRow } from "../cache";
import type { CanvasWork } from "../canvas";
import { workKind } from "../canvas";
import { classForName, matchCourses } from "./match";
import { compassRow, type StoredClass } from "../timetable";
import { addDays, schoolToday } from "./days";

/** A class not on the timetable for this long is a past one (as overview.ts and classlist.ts have it). */
const STALE_DAYS = 28;

/** The classes on the timetable lately, as the to-do list and the class panel match work to them. */
export async function currentClasses(ctx: QueryCtx, account: Doc<"accounts">): Promise<StoredClass[]> {
  const all = ((await compassRow(ctx, account._id, "classes"))?.data ?? []) as StoredClass[];
  const since = addDays(schoolToday(account.slug), -STALE_DAYS);
  return all.filter(c => c.lastSeen >= since);
}

/**
 * Canvas as the timetable sees it: which course each class is (matchCourses), and which class each assignment and
 * announcement is for. An assignment is its course's class's; in a course no class claims (a school's own course for
 * formal assessments, a library course), it is the class its name names (classForName), else no class's.
 */
export type CanvasView = {
  courses: CanvasCourse[];
  /** Each claimed course's class code. */
  codeOf: Map<string, string>;
  /** Each course's kept work, as last fetched (missing until the sync's work step has run for it). */
  work: Map<string, { data: CanvasWork | null; fetchedAt: number | null; error: string | null }>;
  announcements: CanvasAnnouncement[];
  /** The class an assignment is for, by code, or null. */
  classOf: (a: CanvasAssignment) => string | null;
  /** The class an announcement is for, or null. */
  classOfAnnouncement: (a: CanvasAnnouncement) => string | null;
};

export async function canvasView(ctx: QueryCtx, account: Doc<"accounts">, classes: StoredClass[]): Promise<CanvasView | null> {
  if (!account.sealedCanvas) return null;
  const courses = ((await readRow(ctx, account._id, "canvas", "courses"))?.data ?? []) as CanvasCourse[];
  const matched = matchCourses(classes, courses);
  const codeOf = new Map([...matched].map(([code, c]) => [c.id, code]));
  const work: CanvasView["work"] = new Map();
  for (const c of courses) {
    const row = await readRow(ctx, account._id, "canvas", workKind(c.id));
    if (row) work.set(c.id, { data: (row.data as CanvasWork | null) ?? null, fetchedAt: row.fetchedAt, error: row.error });
  }
  const announcements = ((await readRow(ctx, account._id, "canvas", "announcements"))?.data ?? []) as CanvasAnnouncement[];
  // Each class under its own name, and under its course's ("Health and Movement" for a class Compass calls
  // HPE).
  const named = [...classes, ...[...matched].map(([code, c]) => ({ code, subject: c.name, teachers: [] as string[] }))];
  const byName = new Map<string, string | null>();
  const nameClass = (name: string) => {
    if (!byName.has(name)) byName.set(name, classForName(name, named));
    return byName.get(name)!;
  };
  return {
    courses,
    codeOf,
    work,
    announcements,
    classOf: a => codeOf.get(a.courseId) ?? nameClass(a.name),
    classOfAnnouncement: a => codeOf.get(a.courseId) ?? nameClass(a.title),
  };
}
