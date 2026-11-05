import type { QueryCtx } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";
import type { ConnectClass, ConnectNotice } from "@compassneo/connect";
import { connectClassFor } from "../classes";
import { compassRow, connectRow, type StoredClass, type StoredLesson } from "../timetable";
import { isWA } from "./connect";
import { canvasView, currentClasses } from "./courses";

/**
 * Where a class (by its Compass code, "10EN1") lives on each side: its Compass activity (for resources), and the
 * Connect class it matches (for content, submissions and learners), found the way the class panel finds its notices.
 */
export type ClassTarget = {
  code: string;
  activityId: number | null;
  connect: { classId: number; name: string; code: string | null } | null;
  /** The school has Connect (WA public schools). */
  hasConnect: boolean;
  /** The Canvas course it is, when the student has added Canvas and a course matches (lib/match.ts matchCourses). */
  canvas: { courseId: string; name: string; url: string } | null;
};

export async function classTarget(ctx: QueryCtx, account: Doc<"accounts">, code: string): Promise<ClassTarget> {
  const classes = ((await compassRow(ctx, account._id, "classes"))?.data ?? []) as StoredClass[];
  const known = classes.find(c => c.code === code);
  let activityId = known?.activityId ?? null;
  if (!activityId) {
    // Classes kept before their activity id was: look through the latest kept days for a lesson that has it.
    const rows = await ctx.db
      .query("compassCache")
      .withIndex("by_account_kind", i => i.eq("accountId", account._id).gte("kind", "day:").lt("kind", "day;"))
      .order("desc")
      .take(30);
    for (const r of rows) {
      const l = ((r.data ?? []) as StoredLesson[]).find(x => x.code === code && x.activityId);
      if (l?.activityId) {
        activityId = l.activityId;
        break;
      }
    }
  }
  const hasConnect = isWA(account.slug);
  let connect: ClassTarget["connect"] = null;
  if (hasConnect) {
    const connectClasses = ((await connectRow(ctx, account._id, "classes"))?.data ?? []) as ConnectClass[];
    const notices = ((await connectRow(ctx, account._id, "notices"))?.data ?? []) as ConnectNotice[];
    const subject = known?.subject ?? null;
    const k = connectClassFor(code, subject, known?.teachers ?? [], connectClasses, notices);
    if (k) connect = { classId: k.classId, name: k.name, code: k.code };
  }
  let canvas: ClassTarget["canvas"] = null;
  if (account.sealedCanvas && !account.canvasRefused) {
    const view = await canvasView(ctx, account, await currentClasses(ctx, account));
    const course = view?.courses.find(c => view.codeOf.get(c.id) === code);
    if (course) canvas = { courseId: course.id, name: course.name, url: course.url };
  }
  return { code, activityId, connect, hasConnect, canvas };
}
