import { defineConfig, navigateTo, navigation, p } from "@mediansh/agent-tools";
import type { ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";

/**
 * The tools Median's agent can call, served from /api/median (http.ts). Each one reads the student from
 * context.visitor.externalId (their account key, signed by median.identity), never from its input, and answers in
 * fields for the agent to word. Nothing here reads grades, attendance or the timetable: a student's school data stays
 * in the app, not in a support inbox. The panels the tools open are read from the address by routes/home.tsx.
 */

const PAGES = ["grades", "attendance", "events", "chronicle", "notices"] as const;
const TABS = ["overview", "grades", "work", "files", "lessons"] as const;

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

export const medianConfig = (ctx: ActionCtx) =>
  defineConfig({
    plugins: [navigation({ routes: ["/", "/settings", "/login"] })],
    tools: {
      accountStatus: {
        description:
          "The signed-in student's Compass Neo account: their school, whether Compass Neo still holds a working saved login, whether Connect applies (WA public schools) and is linked, when Compass and Connect last let it in, and how many devices are signed in.",
        risk: "low",
        input: {},
        async execute(_input, context) {
          const key = context.visitor.externalId;
          if (!key) return { known: false };
          const account = await ctx.runQuery(internal.median.account, { key });
          return account ? { known: true, ...account } : { known: false, reason: "no_account" };
        },
      },

      syncStatus: {
        description:
          "The signed-in student's last five syncs with Compass and Connect, newest first: full or quick, why it ran, when it started and finished, and every step that failed or was skipped with its note. Use when something looks out of date or missing.",
        risk: "low",
        input: {},
        async execute(_input, context) {
          const key = context.visitor.externalId;
          if (!key) return { known: false };
          const runs = await ctx.runQuery(internal.median.syncs, { key });
          return runs ? { known: true, runs } : { known: false, reason: "no_account" };
        },
      },

      syncNow: {
        description:
          "Start a full sync of the signed-in student's Compass (and Connect) data, the same as pressing Sync now. A sync already running answers instead of starting another. Check syncStatus a minute later for how it went.",
        risk: "medium",
        input: {},
        async execute(_input, context) {
          const key = context.visitor.externalId;
          if (!key) return { known: false };
          const got = await ctx.runMutation(internal.median.syncNow, { key });
          return got ? { known: true, ...got } : { known: false, reason: "no_account" };
        },
      },

      openPage: {
        description: "Open one of the signed-in student's own pages in Compass Neo: grades (every subject), attendance, events (and excursions), chronicle, or the school's notices.",
        risk: "low",
        input: { page: p.enum(PAGES, "Which page to open.") },
        async execute({ page }, context) {
          if (!context.visitor.externalId) return { known: false };
          return navigateTo(`/?panel=${page}`, { known: true, opened: page });
        },
      },

      openClass: {
        description:
          "Open one of the signed-in student's classes in Compass Neo, optionally on a section: overview, grades, work, files or lessons. Matches the class by name or subject, like 'maths' or 'english'.",
        risk: "low",
        input: {
          class: p.string("The class's name or subject, as the student said it, like 'maths' or 'Year 10 Science'."),
          section: p.enum(TABS, "The section to open on. Leave out for the overview.").optional(),
        },
        async execute({ class: asked, section }, context) {
          const key = context.visitor.externalId;
          if (!key) return { known: false };
          const classes = await ctx.runQuery(internal.median.classes, { key });
          if (!classes) return { known: false, reason: "no_account" };
          const q = squash(asked);
          if (!q) return { found: false, classes: classes.map(c => c.name) };
          const exact = classes.filter(c => [c.code, c.name, c.subject].some(s => squash(s) === q));
          const loose = classes.filter(c => [c.code, c.name, c.subject].some(s => squash(s).includes(q) || q.includes(squash(s))));
          const hits = exact.length ? exact : loose;
          if (hits.length !== 1) return { found: false, ambiguous: hits.length > 1, classes: (hits.length ? hits : classes).map(c => c.name) };
          const c = hits[0]!;
          const path = `/?class=${encodeURIComponent(c.code)}${section ? `&tab=${section}` : ""}`;
          return navigateTo(path, { known: true, found: true, opened: c.name, section: section ?? "overview" });
        },
      },
    },
  });
