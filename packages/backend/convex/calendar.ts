import { v } from "convex/values";
import { action, internalMutation, internalQuery, mutation, query, type QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { deviceAccount, type Problem } from "./lib/compass";
import { newToken } from "./lib/crypto";
import { addDays, dayOf, schoolToday, schoolZone } from "./lib/days";
import { calendar, type IcsEvent } from "./lib/ics";
import { readToken, signToken, site } from "./lib/links";
import { accountFor, readDays, type StoredLesson } from "./timetable";
import { todoFor } from "./overview";

/**
 * The calendar feed: the timetable as Compass Neo shows it, for a phone's or laptop's own calendar to subscribe to.
 * More than Compass's own feed has: room changes and relief teachers, assemblies laid over the lessons they take (and
 * as entries of their own), the day's other entries, and the work still to hand in on the day it is due.
 *
 * It is built from what the sync keeps (never a call to Compass), from a week back to as far ahead as days are kept,
 * when a calendar app asks: GET /calendar/<link>/compass-neo.ics (http.ts).
 *
 * The link is the only key to it, as a calendar app cannot sign in: a signed token (lib/links.ts) naming the account
 * and a random value kept on it (calendarNonce). Asking for a new link changes the value, so the old link stops
 * working; turning the feed off clears it. Signing out deletes the account, and every link with it.
 */

const BEHIND_DAYS = 7;
/** As far ahead as the feed reads kept days: past the sync's fortnight, days are kept only when someone opened them. */
const AHEAD_DAYS = 60;
const DOMAIN = "calendar/v1";

type Link = { a: Id<"accounts">; n: string };

async function linkFor(account: Pick<Doc<"accounts">, "_id" | "calendarNonce">) {
  if (!account.calendarNonce) return null;
  const token = await signToken(DOMAIN, { a: account._id, n: account.calendarNonce } satisfies Link);
  return `${site()}/calendar/${token}/compass-neo.ics`;
}

/** This device's account's feed link, or null while the feed is off. */
export const link = query({
  args: { token: v.union(v.string(), v.null()) },
  handler: async (ctx, { token }): Promise<{ url: string | null } | null> => {
    if (!token) return null;
    const account = await accountFor(ctx, token);
    if (!account) return null;
    return { url: await linkFor(account) };
  },
});

/** Turns the feed on, or gives it a new link (fresh), which ends the old one. Answers with the link. */
export const enable = action({
  args: { token: v.string(), fresh: v.optional(v.boolean()) },
  handler: async (ctx, { token, fresh }): Promise<{ ok: true; url: string } | Problem> => {
    const account = await deviceAccount(ctx, token);
    if (!account) return { ok: false, code: "signed-out", message: "This device is signed out." };
    const nonce = account.calendarNonce && !fresh ? account.calendarNonce : newToken();
    await ctx.runMutation(internal.calendar.setNonce, { accountId: account._id, nonce });
    return { ok: true, url: (await linkFor({ _id: account._id, calendarNonce: nonce }))! };
  },
});

/** Turns the feed off: its link stops working. */
export const disable = mutation({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const account = await accountFor(ctx, token);
    if (account) await ctx.db.patch(account._id, { calendarNonce: undefined });
  },
});

export const setNonce = internalMutation({
  args: { accountId: v.id("accounts"), nonce: v.string() },
  handler: async (ctx, { accountId, nonce }) => {
    if (await ctx.db.get(accountId)) await ctx.db.patch(accountId, { calendarNonce: nonce });
  },
});

/** The account a feed link is for, if the link is one this server made and still the account's current one. */
export async function readCalendarLink(token: string) {
  const link = await readToken<Link>(DOMAIN, token);
  return link && typeof link.a === "string" && typeof link.n === "string" ? link : null;
}

/** The feed itself, as iCalendar text. Null when the link is not the account's current one. */
export const feed = internalQuery({
  args: { accountId: v.string(), nonce: v.string() },
  handler: async (ctx, { accountId, nonce }): Promise<string | null> => {
    const id = ctx.db.normalizeId("accounts", accountId);
    const account = id && (await ctx.db.get(id));
    if (!account?.calendarNonce || account.calendarNonce !== nonce) return null;
    const now = Date.now();
    return calendar({ name: "Compass Neo", zone: schoolZone(account.slug), events: await eventsFor(ctx, account, now), now });
  },
});

/** The school day an instant falls on, in the school's own zone (daylight saving and all). */
function localDay(iso: string, zone: string, slug: string) {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
  } catch {
    return dayOf(iso, slug);
  }
}

/** The day after an all-day entry's last day (iCalendar's end is exclusive); never before the day after it starts. */
function allDayEnd(start: string, finish: string, zone: string, slug: string) {
  const first = localDay(start, zone, slug);
  const last = localDay(new Date(Math.max(Date.parse(start), Date.parse(finish) - 1000)).toISOString(), zone, slug);
  return addDays(last > first ? last : first, 1);
}

/** "11:59 pm", in the school's zone. */
function clock(iso: string, zone: string) {
  try {
    return new Intl.DateTimeFormat("en-AU", { timeZone: zone, hour: "numeric", minute: "2-digit", hour12: true })
      .format(new Date(iso))
      .replace(/\s/g, " ")
      .replace(/\s*([ap])\.?\s*m\.?$/i, " $1m")
      .toLowerCase();
  } catch {
    return new Date(iso).toISOString().slice(11, 16);
  }
}

async function eventsFor(ctx: QueryCtx, account: Doc<"accounts">, now: number): Promise<IcsEvent[]> {
  const today = schoolToday(account.slug);
  const zone = schoolZone(account.slug);
  const rows = await ctx.db
    .query("compassCache")
    .withIndex("by_account_kind", i =>
      i
        .eq("accountId", account._id)
        .gte("kind", `day:${addDays(today, -BEHIND_DAYS)}`)
        .lte("kind", `day:${addDays(today, AHEAD_DAYS)}`),
    )
    .collect();
  const days = await readDays(
    ctx,
    account,
    rows.map(r => ({ day: r.kind.slice(4), items: (r.data ?? []) as StoredLesson[] })),
  );

  const out: IcsEvent[] = [];
  for (const d of days) {
    if (d.status !== "ready") continue;
    for (const l of d.lessons) {
      const a = l.assembly && !l.assembly.maybe ? l.assembly : null;
      const notes = [
        l.subject !== l.name ? l.subject : null,
        l.teacherWas && l.teacher ? `Relief: ${l.teacher.full ?? l.teacher.name}, for ${l.teacherWas.full ?? l.teacherWas.name}` : l.teacher ? (l.teacher.full ?? l.teacher.name) : null,
        l.roomWas ? `Room changed from ${l.roomWas}` : null,
        l.timesWas ? `Times changed by the day's notices (was ${clock(l.timesWas.start, zone)} to ${clock(l.timesWas.finish, zone)})` : null,
        a ? (a.replaces === "whole" ? `${a.title} instead of this lesson` : `${a.title}${a.start ? ` at ${clock(a.start, zone)}` : ""}, then class`) : null,
        l.code,
      ].filter(Boolean);
      out.push({
        uid: `${l.id}@compassneo`,
        summary: `${l.name}${l.room ? ` · ${l.room}` : ""}${a?.replaces === "whole" ? " (assembly instead)" : l.roomWas ? " (room change)" : l.teacherWas ? " (relief)" : ""}`,
        start: l.start,
        end: l.finish,
        location: l.room,
        description: notes.join("\n"),
      });
    }
    for (const a of d.assemblies ?? []) {
      const timed = !!a.start && !!a.finish && a.finish > a.start;
      out.push({
        uid: `assembly-${a.id}-${d.day}@compassneo`,
        summary: `${a.title}${a.maybe ? " (may be for you)" : ""}`,
        start: timed ? a.start! : d.day,
        end: timed ? a.finish! : addDays(d.day, 1),
        allDay: !timed,
        location: a.place,
        description: [a.audience, a.notes, `From the notice "${a.notice.title}"`].filter(Boolean).join("\n"),
      });
    }
    for (const e of d.events) {
      out.push({
        uid: `${e.id}@compassneo`,
        summary: e.title,
        start: e.allDay ? localDay(e.start, zone, account.slug) : e.start,
        // An all-day entry's last day is the one its finish falls in, or the day before when it finishes at midnight.
        end: e.allDay ? allDayEnd(e.start, e.finish, zone, account.slug) : e.finish,
        allDay: e.allDay,
      });
    }
  }

  // Work still to hand in, on the day it is due (a calendar keeps the time in the title, as an all-day entry sits at
  // the top of the day rather than at a moment in it).
  const todo = await todoFor(ctx, account, now);
  for (const w of todo.items) {
    if (!w.due) continue;
    const day = localDay(w.due, zone, account.slug);
    out.push({
      uid: `due-${w.key}@compassneo`,
      summary: `Due ${clock(w.due, zone)}: ${w.name}`,
      start: day,
      end: addDays(day, 1),
      allDay: true,
      description: [w.className, w.offline ? "Not handed in online" : null, w.overdue ? "Overdue" : null].filter(Boolean).join("\n"),
    });
  }
  return out;
}
