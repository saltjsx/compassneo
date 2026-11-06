import { v } from "convex/values";
import { action, internalQuery, query } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { assetPath, CompassError, getClassResources, type CompassResource } from "@compassneo/compass";
import { getContent, type ContentNode } from "@compassneo/connect";
import { deviceAccount, withCompass, type Problem } from "./lib/compass";
import { withConnect } from "./lib/connect";
import { fileLink } from "./lib/links";
import { parsePlan, type PlanBlock } from "./lib/plan";
import { classTarget, type ClassTarget } from "./lib/target";
import { addDays, schoolToday } from "./lib/days";
import { accountFor, fetchDays } from "./timetable";
import { readRow, sideOf, type Side } from "./cache";
import type { CanvasModule } from "@compassneo/canvas";
import { withCanvas } from "./lib/canvas";

/**
 * A class's resources from every side, as one tree each: Compass's Resources (the class's folders of files, links and
 * pages), Connect's Learning Content (sections of files and links), and the modules of the class's Canvas course (its
 * files, links, and pages and assignments that open on Canvas). Fetched when the class panel's Resources tab
 * opens (load), kept per class, and asked for again after FRESH.
 *
 * Files are links to Compass Neo's own file route (lib/links.ts), so they open with the account's session.
 */

const FRESH = 3 * 3600 * 1000;

export type ResourceNode = {
  key: string;
  name: string;
  kind: "folder" | "file" | "link" | "page" | "submission" | "discussion";
  source: "compass" | "connect" | "canvas";
  /** A file: Compass Neo's link to it. A link: where it goes (external). */
  href: string | null;
  external: boolean;
  fileName: string | null;
  mime: string | null;
  size: number | null;
  by: string | null;
  at: string | null;
  /** A Compass page (a lesson plan, a page a teacher wrote): its text comes from resources.page. */
  page: { fileAssetId: string; nodeId: number } | null;
  /** Compass's folder of lesson plans, which every class has and is mostly empty pages. */
  lessonPlans?: true;
  children: ResourceNode[];
};

export type ClassResources = {
  compass: Side<ResourceNode[]>;
  connect: Side<ResourceNode[]>;
  /** The Connect class the content came from. */
  connectClass: { name: string; code: string | null } | null;
  canvas: Side<ResourceNode[]>;
};

const compassKind = (id: number) => `resources:${id}`;
const connectKind = (id: number) => `content:${id}`;
const canvasKind = (courseId: string) => `modules:${courseId}`;

/**
 * The module items Compass Neo shows: files (opened through its file route) and everything that opens somewhere,
 * outside links and Canvas's own pages, assignments, quizzes and discussions (opened on Canvas). Sub-headers are left out.
 */
const CANVAS_ITEMS = new Set(["File", "ExternalUrl", "Page", "Assignment", "Quiz", "Discussion", "ExternalTool"]);

/**
 * What a module item is, as a row shows it: an outside link is a link (its site's icon and name); Canvas's own pages,
 * assignments and discussions are those kinds, so they never pass as a link to the school's Canvas address.
 */
const canvasKindOf = (type: string): ResourceNode["kind"] =>
  type === "File"
    ? "file"
    : type === "ExternalUrl"
      ? "link"
      : type === "Assignment" || type === "Quiz"
        ? "submission"
        : type === "Discussion"
          ? "discussion"
          : "page";

/**
 * A course's modules as folders. A file opens through Compass Neo's file route; anything else opens on Canvas (a page
 * here is one of Canvas's, with no page to read inside Compass Neo: page stays null).
 */
async function fromCanvas(accountId: Id<"accounts">, modules: CanvasModule[]): Promise<ResourceNode[]> {
  const out: ResourceNode[] = [];
  for (const m of modules) {
    const children: ResourceNode[] = [];
    for (const i of m.items) {
      if (!CANVAS_ITEMS.has(i.type)) continue;
      const file = i.type === "File" && i.fileId;
      children.push({
        key: `canvas:${i.id}`,
        name: i.title,
        kind: file ? "file" : canvasKindOf(i.type),
        source: "canvas",
        href: file ? await fileLink(accountId, "canvas", `/api/v1/files/${i.fileId}`, i.title) : i.url,
        external: !file,
        fileName: file ? i.title : null,
        mime: null,
        size: null,
        by: null,
        at: null,
        page: null,
        children: [],
      });
    }
    if (children.length) out.push({ ...folder(`canvas:module:${m.id}`, m.name), children });
  }
  return out;
}

const folder = (key: string, name: string): Omit<ResourceNode, "children"> => ({
  key,
  name,
  kind: "folder",
  source: "canvas",
  href: null,
  external: false,
  fileName: null,
  mime: null,
  size: null,
  by: null,
  at: null,
  page: null,
});

async function fromCompass(accountId: Id<"accounts">, nodes: CompassResource[]): Promise<ResourceNode[]> {
  const out: ResourceNode[] = [];
  for (const n of nodes) {
    const file = n.kind === "file" && n.fileAssetId;
    out.push({
      key: `compass:${n.id}`,
      name: n.name,
      kind: n.kind,
      source: "compass",
      href: file ? await fileLink(accountId, "compass", assetPath(n.fileAssetId!, n.id), n.filename ?? n.name) : n.kind === "link" ? n.url : null,
      external: n.kind === "link",
      fileName: n.filename,
      mime: null,
      size: null,
      by: n.by,
      at: null,
      page: n.kind === "page" && n.fileAssetId ? { fileAssetId: n.fileAssetId, nodeId: n.id } : null,
      ...(n.lessonPlans ? { lessonPlans: true as const } : {}),
      children: await fromCompass(accountId, n.children),
    });
  }
  return out;
}

async function fromConnect(accountId: Id<"accounts">, nodes: ContentNode[]): Promise<ResourceNode[]> {
  const out: ResourceNode[] = [];
  for (const n of nodes) {
    if (n.kind === "other") continue;
    out.push({
      key: `connect:${n.id}`,
      name: n.name,
      kind: n.kind,
      source: "connect",
      href: n.file ? await fileLink(accountId, "connect", n.file.path, n.file.name) : n.kind === "link" ? n.url : null,
      external: n.kind === "link",
      fileName: n.file?.name ?? null,
      mime: n.file?.mime ?? null,
      size: n.file?.size ?? null,
      by: null,
      at: n.at,
      page: null,
      children: await fromConnect(accountId, n.children),
    });
  }
  return out;
}

/** Both sides' resources for a class, as last fetched. Reactive: a load lands here by itself. */
export const forClass = query({
  args: { token: v.union(v.string(), v.null()), code: v.string() },
  handler: async (ctx, { token, code }): Promise<ClassResources | null> => {
    if (!token || !code) return null;
    const account = await accountFor(ctx, token);
    if (!account) return null;
    const t = await classTarget(ctx, account, code);

    let compass: Side<ResourceNode[]> = { status: "missing" };
    if (t.activityId) {
      const row = await readRow(ctx, account._id, "compass", compassKind(t.activityId));
      const side = sideOf(row, d => d as CompassResource[]);
      compass = side.status === "ready" ? { ...side, data: await fromCompass(account._id, side.data) } : side;
    }
    let connect: Side<ResourceNode[]> = { status: "none" };
    if (t.connect) {
      const row = await readRow(ctx, account._id, "connect", connectKind(t.connect.classId));
      const side = sideOf(row, d => d as ContentNode[]);
      connect = side.status === "ready" ? { ...side, data: await fromConnect(account._id, side.data) } : side;
    }
    let canvas: Side<ResourceNode[]> = { status: "none" };
    if (t.canvas) {
      const side = sideOf(await readRow(ctx, account._id, "canvas", canvasKind(t.canvas.courseId)), d => d as CanvasModule[]);
      canvas = side.status === "ready" ? { ...side, data: await fromCanvas(account._id, side.data) } : side;
    }
    return { compass, connect, connectClass: t.connect && { name: t.connect.name, code: t.connect.code }, canvas };
  },
});

export const target = internalQuery({
  args: { accountId: v.id("accounts"), code: v.string() },
  handler: async (ctx, { accountId, code }): Promise<ClassTarget | null> => {
    const account = await ctx.db.get(accountId);
    return account && classTarget(ctx, account, code);
  },
});

/**
 * Fetches a class's resources from Compass, Connect and Canvas, unless they were fetched in the last FRESH (force: the app's
 * refresh). A class whose Compass id is not known yet (kept before it was) has the timetable fetched again first.
 */
export const load = action({
  args: { token: v.string(), code: v.string(), force: v.optional(v.boolean()) },
  handler: async (ctx, { token, code, force }): Promise<{ ok: true } | Problem> => {
    const account = await deviceAccount(ctx, token);
    if (!account) return { ok: false, code: "signed-out", message: "This device is signed out." };
    let t = await ctx.runQuery(internal.resources.target, { accountId: account._id, code });
    if (!t) return { ok: false, code: "signed-out", message: "This device is signed out." };
    const now = Date.now();
    const stale = async (store: "compass" | "connect" | "canvas", kind: string) => {
      if (force) return true;
      const row = await ctx.runQuery(internal.cache.get, { accountId: account._id, store, kind });
      return !row || now - row.checkedAt > FRESH;
    };

    if (!t.activityId) {
      const today = schoolToday(account.slug);
      await withCompass(ctx, account, s => fetchDays(ctx, account, s, addDays(today, -7), addDays(today, 14)));
      t = (await ctx.runQuery(internal.resources.target, { accountId: account._id, code })) ?? t;
    }

    // A job that throws (the network failing, not an answer) is kept as its side's error, never left unhandled while
    // the next side is being looked at.
    const failed = (store: "compass" | "connect" | "canvas", kind: string) => (e: unknown) =>
      ctx.runMutation(internal.cache.put, { accountId: account._id, store, kind, error: e instanceof Error && e.message ? e.message : "It did not answer." });
    const jobs: Array<Promise<unknown>> = [];
    if (t.activityId && (await stale("compass", compassKind(t.activityId)))) {
      const activityId = t.activityId;
      jobs.push(
        withCompass(ctx, account, s => getClassResources(s, activityId)).then(r =>
          ctx.runMutation(internal.cache.put, {
            accountId: account._id,
            store: "compass",
            kind: compassKind(activityId),
            ...(r.ok ? { data: r.value } : { error: r.message }),
          }),
        ).catch(failed("compass", compassKind(activityId))),
      );
    }
    if (t.canvas && (await stale("canvas", canvasKind(t.canvas.courseId)))) {
      const courseId = t.canvas.courseId;
      jobs.push(
        withCanvas(ctx, account, s => s.getModules(courseId)).then(r =>
          ctx.runMutation(internal.cache.put, {
            accountId: account._id,
            store: "canvas",
            kind: canvasKind(courseId),
            ...(r.ok ? { data: r.value } : { error: r.message }),
          }),
        ).catch(failed("canvas", canvasKind(courseId))),
      );
    }
    if (t.connect && (await stale("connect", connectKind(t.connect.classId)))) {
      const classId = t.connect.classId;
      jobs.push(
        withConnect(ctx, account, c => getContent(c, classId)).then(r =>
          ctx.runMutation(internal.cache.put, {
            accountId: account._id,
            store: "connect",
            kind: connectKind(classId),
            ...(r.ok ? { data: r.value } : { error: r.message }),
          }),
        ).catch(failed("connect", connectKind(classId))),
      );
    }
    await Promise.all(jobs);
    return { ok: true };
  },
});

/** A Compass page (a lesson plan, a page a teacher wrote), as plain blocks. */
export const page = action({
  args: { token: v.string(), fileAssetId: v.string(), nodeId: v.number() },
  handler: async (ctx, { token, fileAssetId, nodeId }): Promise<{ ok: true; blocks: PlanBlock[] } | Problem> => {
    const account = await deviceAccount(ctx, token);
    if (!account) return { ok: false, code: "signed-out", message: "This device is signed out." };
    if (!/^[\w-]{8,80}$/.test(fileAssetId)) return { ok: false, code: "unavailable", message: "That is not a Compass page." };
    const r = await withCompass(ctx, account, async s => {
      try {
        const f = await s.file(assetPath(fileAssetId, nodeId));
        return f ? parsePlan(new TextDecoder().decode(f.bytes)) : [];
      } catch (e) {
        if (e instanceof CompassError && e.code === "expired") throw e;
        return [];
      }
    });
    return r.ok ? { ok: true, blocks: r.value } : r;
  },
});

