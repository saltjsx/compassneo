import { v } from "convex/values";
import { action, query, type ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { getEvents, type CompassEvent, type CompassSession } from "@compassneo/compass";
import { deviceAccount, withCompass, type Problem } from "./lib/compass";
import { addDays, schoolToday } from "./lib/days";
import { accountFor } from "./timetable";
import { teachersFor } from "./teachers";
import { teacherDirectory } from "./lib/match";
import type { ChronicleEntry } from "@compassneo/compass";
import type { ConnectNotice, SubjectGrade } from "@compassneo/connect";
import { readRow } from "./cache";
import { gradeRows } from "./lib/grades";

/**
 * Events: excursions, clubs, assemblies, exams, from Compass's calendar (everything that is not a class). This year
 * so far and the months ahead, fetched with each sync and by load. A club that meets every week is one event with
 * many sessions.
 */

const AHEAD_DAYS = 180;

export async function fetchEvents(ctx: ActionCtx, account: Doc<"accounts">, s: CompassSession) {
  const today = schoolToday(account.slug);
  const items = await getEvents(s, `${today.slice(0, 4)}-01-01`, addDays(today, AHEAD_DAYS));
  await ctx.runMutation(internal.cache.put, { accountId: account._id, store: "compass", kind: "events", data: items });
  const now = new Date().toISOString();
  return { count: items.filter(e => e.finish >= now).length };
}

export type EventSession = { id: string; start: string; finish: string; allDay: boolean; place: string | null; session: string | null; rollMarked: boolean };

export type SchoolEvent = {
  key: string;
  activityId: number | null;
  kind: CompassEvent["kind"];
  title: string;
  description: string | null;
  place: string | null;
  lead: string | null;
  /** Who runs it, by name and photo, when they are a teacher Compass Neo has looked up (one of the student's). */
  leadName: string | null;
  leadPhotoUrl: string | null;
  /** Every time it is on, in order. */
  sessions: EventSession[];
  /** The first session not over yet, else null (it is all in the past). */
  next: EventSession | null;
  last: EventSession;
};

export const get = query({
  args: { token: v.union(v.string(), v.null()) },
  handler: async (ctx, { token }): Promise<{ fetchedAt: number; events: SchoolEvent[] } | null> => {
    if (!token) return null;
    const account = await accountFor(ctx, token);
    if (!account) return null;
    const row = await readRow(ctx, account._id, "compass", "events");
    if (!row?.data) return null;
    const now = new Date(row.fetchedAt ?? Date.now()).toISOString();
    const groups = new Map<string, CompassEvent[]>();
    for (const e of row.data as CompassEvent[]) {
      const key = `${e.activityId ?? e.id}:${e.title}`;
      groups.set(key, [...(groups.get(key) ?? []), e]);
    }
    const leads = await teachersFor(ctx, account.slug, [...groups.values()].map(l => l[0]!.lead));
    // Staff codes to names, from every full name Compass Neo has seen: Chronicle's authors, Connect's staff and notices.
    const chronicle = ((await readRow(ctx, account._id, "compass", "chronicle"))?.data as { entries?: ChronicleEntry[] } | null)?.entries ?? [];
    const grades = ((await gradeRows(ctx, account)).grades?.data ?? []) as SubjectGrade[];
    const notices = ((await readRow(ctx, account._id, "connect", "notices"))?.data ?? []) as ConnectNotice[];
    const directory = teacherDirectory([
      ...chronicle.map(x => x.by),
      ...grades.flatMap(g => g.teachers),
      ...notices.map(n => n.author),
    ]
      .filter((n): n is string => !!n)
      // "Steven (Steve) Young" is Steven Young.
      .map(n => n.replace(/\s*\([^)]*\)/g, "")));
    const events: SchoolEvent[] = [...groups.entries()].map(([key, list]) => {
      const sorted = list.sort((a, b) => a.start.localeCompare(b.start));
      const sessions = sorted.map(e => ({ id: e.id, start: e.start, finish: e.finish, allDay: e.allDay, place: e.place, session: e.session, rollMarked: e.rollMarked }));
      const first = sorted[0]!;
      return {
        key,
        activityId: first.activityId,
        kind: first.kind,
        title: first.title,
        description: sorted.find(e => e.description)?.description ?? null,
        place: first.place,
        lead: first.lead,
        leadName: (first.lead && (directory(first.lead.toLowerCase())?.full ?? null)) || null,
        leadPhotoUrl: (first.lead && leads.get(first.lead.trim().toLowerCase())?.photoUrl) || null,
        sessions,
        next: sessions.find(x => x.finish >= now) ?? null,
        last: sessions[sessions.length - 1]!,
      };
    });
    // Coming up first (soonest first), then the past (latest first).
    events.sort((a, b) =>
      a.next && b.next ? a.next.start.localeCompare(b.next.start) : a.next ? -1 : b.next ? 1 : b.last.start.localeCompare(a.last.start),
    );
    return { fetchedAt: row.fetchedAt ?? row.checkedAt, events };
  },
});

export const load = action({
  args: { token: v.string() },
  handler: async (ctx, { token }): Promise<{ ok: true } | Problem> => {
    const account = await deviceAccount(ctx, token, { reader: true });
    if (!account) return { ok: false, code: "signed-out", message: "This device is signed out." };
    const r = await withCompass(ctx, account, s => fetchEvents(ctx, account, s));
    return r.ok ? { ok: true } : r;
  },
});
