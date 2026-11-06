import { v } from "convex/values";
import { action, httpAction, internalMutation, internalQuery, mutation, query, type ActionCtx } from "./_generated/server";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { deviceAccount, type Problem } from "./lib/compass";
import { newToken } from "./lib/crypto";
import { addDays, isDay, schoolToday, schoolZone } from "./lib/days";
import { agentToken, agentUrl, isAgentToken, readAgentToken } from "./lib/agent";
import { accountFor } from "./timetable";
import { live } from "./accounts";
import { begin } from "./sync";

/**
 * AI access: an MCP server (Model Context Protocol) that lets an AI app such as Claude read what Compass Neo shows the
 * student. It answers at POST /mcp/<link> (http.ts), or at POST /mcp with the link as a bearer token, over MCP's
 * streamable HTTP transport, statelessly: every request stands alone and is answered with plain JSON.
 *
 * The link (lib/agent.ts) reads everything the app's pages read and changes nothing: each tool is one of the app's
 * own queries, asked with the link in place of a device's token, so an AI sees exactly what the student does. What is
 * missing (a day, a class's work or files never opened) is fetched first, as opening it in the app would. The one
 * thing a tool may start is a sync. The student turns it on and off on the settings page; a new link ends the old one.
 */

// ---------- the link ----------

/** This device's account's AI link, or null while AI access is off. */
export const link = query({
  args: { token: v.union(v.string(), v.null()) },
  handler: async (ctx, { token }): Promise<{ url: string | null } | null> => {
    if (!token || isAgentToken(token)) return null;
    const account = await accountFor(ctx, token);
    if (!account) return null;
    return { url: account.mcpNonce ? agentUrl(await agentToken(account._id, account.mcpNonce)) : null };
  },
});

/** Turns AI access on, or gives it a new link (fresh), which ends the old one. Answers with the link. */
export const enable = action({
  args: { token: v.string(), fresh: v.optional(v.boolean()) },
  handler: async (ctx, { token, fresh }): Promise<{ ok: true; url: string } | Problem> => {
    const account = await deviceAccount(ctx, token);
    if (!account) return { ok: false, code: "signed-out", message: "This device is signed out." };
    const nonce = account.mcpNonce && !fresh ? account.mcpNonce : newToken();
    await ctx.runMutation(internal.mcp.setNonce, { accountId: account._id, nonce });
    return { ok: true, url: agentUrl(await agentToken(account._id, nonce)) };
  },
});

/** Turns AI access off: its link stops working at once. */
export const disable = mutation({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const account = await accountFor(ctx, token);
    if (account) await ctx.db.patch(account._id, { mcpNonce: undefined });
  },
});

export const setNonce = internalMutation({
  args: { accountId: v.id("accounts"), nonce: v.string() },
  handler: async (ctx, { accountId, nonce }) => {
    if (await ctx.db.get(accountId)) await ctx.db.patch(accountId, { mcpNonce: nonce });
  },
});

/** An account's current AI link, for support and testing from the dashboard (`npx convex run mcp:linkFor`). */
export const linkFor = internalQuery({
  args: { accountId: v.id("accounts") },
  handler: async (ctx, { accountId }) => {
    const account = await ctx.db.get(accountId);
    return account?.mcpNonce ? agentUrl(await agentToken(account._id, account.mcpNonce)) : null;
  },
});

/** The account an AI link is for, as an action needs it (lib/compass.ts deviceAccount, for a reader). */
export const accountOf = internalQuery({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const account = await readAgentToken(ctx, token);
    return account && live(ctx, account);
  },
});

/** Who the link is for, and when their data was last synced: what an AI needs to read the rest. */
export const profile = internalQuery({
  args: { accountId: v.id("accounts") },
  handler: async (ctx, { accountId }) => {
    const a = await ctx.db.get(accountId);
    if (!a) return null;
    const runs = await ctx.db.query("syncs").withIndex("by_account", i => i.eq("accountId", accountId)).order("desc").take(7);
    const at = (t?: number) => (t ? new Date(t).toISOString() : null);
    return {
      name: a.fullName ?? a.displayName,
      preferredName: a.displayName,
      formGroup: a.formGroup ?? null,
      school: a.schoolName,
      username: a.username,
      today: schoolToday(a.slug),
      timeZone: schoolZone(a.slug),
      canvas: a.canvasOrigin ? { host: new URL(a.canvasOrigin).host, working: !a.canvasRefused } : null,
      lastSync: at(runs.find(r => r.finishedAt)?.finishedAt),
      lastFullSync: at(runs.find(r => r.finishedAt && (r.kind ?? "full") === "full")?.finishedAt),
    };
  },
});

export const syncNow = internalMutation({
  args: { accountId: v.id("accounts") },
  handler: async (ctx, { accountId }) => {
    const account = await ctx.db.get(accountId);
    return account ? !!(await begin(ctx, account, "manual", true, Date.now())) : false;
  },
});

// ---------- the tools ----------

type Args = Record<string, unknown>;
type Tool = {
  name: string;
  title: string;
  description: string;
  properties?: Record<string, object>;
  required?: string[];
  /** Answers with what the tool found, as JSON for the AI; a string is said as it is. */
  run: (ctx: ActionCtx, token: string, accountId: Id<"accounts">, args: Args) => Promise<unknown>;
};

const DATE = { type: "string", description: "A date, YYYY-MM-DD, in the school's time zone. Leave out for today." };
const CODE = { type: "string", description: "The class's code, as list_classes gives it (like 10MAT1)." };

/** Some part of a page's answer has not been fetched yet (a class's work, its files, its classmates). */
const missing = (r: unknown): boolean =>
  r == null ||
  (typeof r === "object" &&
    ((r as { status?: unknown }).status === "missing" ||
      Object.values(r).some(x => !!x && typeof x === "object" && (x as { status?: unknown }).status === "missing")));

/** Asks a page's query; if it has nothing yet, fetches it as opening the page does, and asks again. */
async function withLoad<T>(ask: () => Promise<T>, load: () => Promise<unknown>): Promise<T> {
  const first = await ask();
  if (!missing(first)) return first;
  await load().catch(() => {});
  return ask();
}

const today = async (ctx: ActionCtx, accountId: Id<"accounts">, date: unknown) => {
  if (typeof date === "string" && isDay(date)) return date;
  if (date != null && date !== "") throw new Error("Dates are YYYY-MM-DD.");
  const p = await ctx.runQuery(internal.mcp.profile, { accountId });
  return p?.today ?? new Date().toISOString().slice(0, 10);
};
const code = (args: Args) => {
  if (typeof args.code !== "string" || !args.code.trim()) throw new Error("Give a class code; list_classes has them.");
  return args.code.trim();
};

const TOOLS: Tool[] = [
  {
    name: "get_profile",
    title: "Profile",
    description:
      "Who the student is (name, form group, school), today's date and time zone at the school, whether Canvas is added, and when Compass Neo last synced. Call it first: the other tools' dates are the school's.",
    run: (ctx, _t, accountId) => ctx.runQuery(internal.mcp.profile, { accountId }),
  },
  {
    name: "get_timetable",
    title: "Timetable",
    description:
      "The timetable day by day: each lesson's time, class, room, teacher, relief teachers and room changes, the work due, assemblies laid over lessons, and the day's other entries. Up to 14 days from the date.",
    properties: { date: DATE, days: { type: "integer", minimum: 1, maximum: 14, description: "How many days from the date, 1 to 14. Default 1." } },
    run: async (ctx, token, accountId, args) => {
      const from = await today(ctx, accountId, args.date);
      const n = Math.min(14, Math.max(1, Math.floor(Number(args.days ?? 1)) || 1));
      const dates = Array.from({ length: n }, (_, i) => addDays(from, i));
      const ask = () => Promise.all(dates.map(day => ctx.runQuery(api.timetable.day, { token, day })));
      let days = await ask();
      const gap = dates.find((_, i) => missing(days[i]));
      if (gap) {
        await ctx.runAction(api.timetable.load, { token, day: gap }).catch(() => {});
        days = await ask();
      }
      return days;
    },
  },
  {
    name: "list_classes",
    title: "Classes",
    description: "Every class the student is in this term: code, name, subject, teachers and when it next meets. The codes are what the class tools take.",
    properties: { date: DATE },
    run: async (ctx, token, accountId, args) => ctx.runQuery(api.classlist.all, { token, day: await today(ctx, accountId, args.date) }),
  },
  {
    name: "get_class",
    title: "Class",
    description:
      "One class in full, as of a date: its lessons in the weeks around it, usual week, rooms, teachers, this semester's grades and the other's, work, Connect notices and Canvas course.",
    properties: { code: CODE, date: DATE },
    required: ["code"],
    run: async (ctx, token, accountId, args) => ctx.runQuery(api.classes.detail, { token, code: code(args), day: await today(ctx, accountId, args.date) }),
  },
  {
    name: "get_class_work",
    title: "Class work",
    description: "A class's work from Compass, Connect and Canvas: each task, its due date, instructions, attachments, and what the student has handed in.",
    properties: { code: CODE },
    required: ["code"],
    run: (ctx, token, _a, args) => {
      const c = code(args);
      return withLoad(() => ctx.runQuery(api.work.forClass, { token, code: c }), () => ctx.runAction(api.work.load, { token, code: c }));
    },
  },
  {
    name: "get_class_resources",
    title: "Class files",
    description: "A class's files and links from Compass, Connect and Canvas, by folder. File links open the file itself.",
    properties: { code: CODE },
    required: ["code"],
    run: (ctx, token, _a, args) => {
      const c = code(args);
      return withLoad(() => ctx.runQuery(api.resources.forClass, { token, code: c }), () => ctx.runAction(api.resources.load, { token, code: c }));
    },
  },
  {
    name: "get_class_people",
    title: "Classmates",
    description: "Who is in a class, as Connect lists them.",
    properties: { code: CODE },
    required: ["code"],
    run: (ctx, token, _a, args) => {
      const c = code(args);
      return withLoad(() => ctx.runQuery(api.learners.forClass, { token, code: c }), () => ctx.runAction(api.learners.load, { token, code: c }));
    },
  },
  {
    name: "get_lesson_plans",
    title: "Lesson plans",
    description: "What teachers wrote in the lesson plans of some lessons, by lesson id (each lesson in get_timetable has one).",
    properties: { lesson_ids: { type: "array", items: { type: "string" }, maxItems: 20, description: "Lesson ids from get_timetable, up to 20." } },
    required: ["lesson_ids"],
    run: async (ctx, token, _a, args) => {
      const ids = Array.isArray(args.lesson_ids) ? args.lesson_ids.filter((x): x is string => typeof x === "string").slice(0, 20) : [];
      if (!ids.length) throw new Error("Give lesson ids from get_timetable.");
      const ask = () => ctx.runQuery(api.plans.forLessons, { token, ids });
      const first = await ask();
      const gaps = ids.filter(id => !(id in first));
      if (!gaps.length) return first;
      await ctx.runAction(api.plans.load, { token, ids: gaps }).catch(() => {});
      return ask();
    },
  },
  {
    name: "get_todo",
    title: "To do",
    description: "The work still to hand in across every class, soonest first, with when each class last meets before it is due.",
    run: (ctx, token) => ctx.runQuery(api.overview.todo, { token }),
  },
  {
    name: "get_grades",
    title: "Grades",
    description: "Every subject's grades for the semester the date falls in: marks, scores, the grade so far and how it moved.",
    properties: { date: DATE },
    run: async (ctx, token, accountId, args) => ctx.runQuery(api.overview.grades, { token, day: await today(ctx, accountId, args.date) }),
  },
  {
    name: "get_attendance",
    title: "Attendance",
    description: "This year's attendance: overall, by term, by class, and each absence or late arrival with its reason.",
    run: (ctx, token) => withLoad(() => ctx.runQuery(api.attendance.get, { token }), () => ctx.runAction(api.attendance.load, { token })),
  },
  {
    name: "get_events",
    title: "Events",
    description: "Excursions, clubs, assemblies and exams this year and in the months ahead, with their sessions and places.",
    run: (ctx, token) => withLoad(() => ctx.runQuery(api.events.get, { token }), () => ctx.runAction(api.events.load, { token })),
  },
  {
    name: "get_chronicle",
    title: "Chronicle",
    description: "What staff have noted about the student in Chronicle that the student may see: commendations, house points and other entries.",
    run: (ctx, token) => withLoad(() => ctx.runQuery(api.chronicle.get, { token }), () => ctx.runAction(api.chronicle.load, { token })),
  },
  {
    name: "get_notices",
    title: "Notices",
    description: "The school's notices: the news feed, its daily notices read into points, and the assemblies coming up.",
    run: (ctx, token) => ctx.runQuery(api.announcements.list, { token }),
  },
  {
    name: "sync_now",
    title: "Sync now",
    description: "Starts a full sync with Compass (and Connect and Canvas), as Sync now does in the app. It takes about a minute; the other tools show the new data after.",
    run: async (ctx, _t, accountId) => ((await ctx.runMutation(internal.mcp.syncNow, { accountId })) ? "A sync has started. Give it a minute." : "A sync is already running."),
  },
];

// ---------- the protocol ----------

const PROTOCOLS = ["2025-06-18", "2025-03-26", "2024-11-05"];
const INSTRUCTIONS =
  "Compass Neo: a school student's own Compass data (timetable, classes, work, grades, attendance, events, Chronicle, notices), with Connect and Canvas where the school uses them. Read only. Call get_profile first for today's date at the school; class tools take codes from list_classes.";

type Rpc = { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, unknown> };
class RpcError extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message);
  }
}

async function answer(ctx: ActionCtx, token: string, accountId: Id<"accounts">, msg: Rpc): Promise<unknown> {
  switch (msg.method) {
    case "initialize": {
      const asked = String(msg.params?.protocolVersion ?? "");
      return {
        protocolVersion: PROTOCOLS.includes(asked) ? asked : PROTOCOLS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "compass-neo", title: "Compass Neo", version: "1.0.0" },
        instructions: INSTRUCTIONS,
      };
    }
    case "ping":
      return {};
    case "tools/list":
      return {
        tools: TOOLS.map(t => ({
          name: t.name,
          title: t.title,
          description: t.description,
          inputSchema: { type: "object", properties: t.properties ?? {}, ...(t.required ? { required: t.required } : {}), additionalProperties: false },
          annotations: { title: t.title, readOnlyHint: t.name !== "sync_now", openWorldHint: false },
        })),
      };
    case "tools/call": {
      const tool = TOOLS.find(t => t.name === msg.params?.name);
      if (!tool) throw new RpcError(-32602, `No tool called ${String(msg.params?.name)}.`);
      try {
        const out = await tool.run(ctx, token, accountId, (msg.params?.arguments ?? {}) as Args);
        if (out == null) return { content: [{ type: "text", text: "Compass Neo has nothing for this yet. Try sync_now, then ask again in a minute." }] };
        return { content: [{ type: "text", text: typeof out === "string" ? out : JSON.stringify(out) }] };
      } catch (e) {
        return { content: [{ type: "text", text: e instanceof Error && e.message ? e.message : "That did not work." }], isError: true };
      }
    }
    default:
      throw new RpcError(-32601, `Compass Neo does not know ${String(msg.method)}.`);
  }
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, Accept, Mcp-Protocol-Version, Mcp-Session-Id",
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...CORS } });
const rpcError = (id: Rpc["id"], code: number, message: string) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });

/** The link from the address (/mcp/<link>) or the bearer token. */
const linkOf = (req: Request) => {
  const fromPath = new URL(req.url).pathname.split("/")[2];
  if (fromPath) return decodeURIComponent(fromPath);
  return req.headers.get("Authorization")?.match(/^Bearer\s+(\S+)$/i)?.[1] ?? null;
};

export const handle = httpAction(async (ctx, req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  // Stateless: no stream to open (GET) and no session to end (DELETE).
  if (req.method !== "POST") return new Response(null, { status: 405, headers: { Allow: "POST, OPTIONS", ...CORS } });

  const token = linkOf(req);
  const account = token && isAgentToken(token) ? await ctx.runQuery(internal.mcp.accountOf, { token }) : null;
  if (!token || !account) return json(401, rpcError(null, -32001, "This Compass Neo link is not on. Make a new one in Compass Neo's settings, under AI access."));

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json(400, rpcError(null, -32700, "That was not JSON."));
  }
  const batch = Array.isArray(body);
  const msgs = (batch ? body : [body]) as Rpc[];
  const replies: unknown[] = [];
  for (const msg of msgs) {
    if (!msg || typeof msg !== "object" || typeof msg.method !== "string") {
      replies.push(rpcError(msg?.id, -32600, "Not a JSON-RPC request."));
      continue;
    }
    // A notification (no id) is taken and not answered.
    if (msg.id === undefined) continue;
    try {
      replies.push({ jsonrpc: "2.0", id: msg.id, result: await answer(ctx, token, account._id, msg) });
    } catch (e) {
      replies.push(rpcError(msg.id, e instanceof RpcError ? e.code : -32603, e instanceof Error ? e.message : "Something went wrong."));
    }
  }
  if (!replies.length) return new Response(null, { status: 202, headers: CORS });
  return json(200, batch ? replies : replies[0]);
});
