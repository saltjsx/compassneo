import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  /** Every school we have proven lives at <slug>.compass.education. Grows as people sign in. */
  schools: defineTable({
    slug: v.string(),
    name: v.string(),
    organisationId: v.optional(v.string()),
    region: v.optional(v.string()),
    verifiedAt: v.number(),
    signIns: v.number(),
  })
    .index("by_slug", ["slug"])
    .index("by_organisation", ["organisationId"])
    .index("by_signIns", ["signIns"])
    .searchIndex("search_name", { searchField: "name" }),

  /** Compass's school search answers, kept for a week so a name is only ever asked about once. */
  directory: defineTable({
    key: v.string(),
    items: v.array(v.object({ organisationId: v.string(), name: v.string() })),
    fetchedAt: v.number(),
  }).index("by_key", ["key"]),

  /** Schools whose address we could not guess, so the next person does not wait on the same failed probes. */
  misses: defineTable({
    organisationId: v.string(),
    checkedAt: v.number(),
  }).index("by_organisation", ["organisationId"]),

  /** One Compass account (a school and a username), shared by every device signed in to it. See accounts.ts. */
  accounts: defineTable({
    key: v.string(),
    slug: v.string(),
    username: v.string(),
    schoolName: v.string(),
    compassUserId: v.number(),
    displayName: v.string(),
    fullName: v.optional(v.string()),
    formGroup: v.optional(v.string()),
    /** The Compass profile photo, copied into Convex storage, and the Compass path it came from (to spot a new one). */
    photoId: v.optional(v.id("_storage")),
    photoPath: v.optional(v.string()),
    sealedLogin: v.optional(v.string()),
    sealedCompass: v.string(),
    compassAt: v.number(),
    sealedConnect: v.optional(v.string()),
    connectAt: v.optional(v.number()),
    connectStudentId: v.optional(v.number()),
    /**
     * Canvas, when the student has added it (canvas.ts): the school's Canvas address, the student's own access token
     * (CREDENTIALS_KEY), who Canvas says they are, and why Canvas stopped accepting the token, when it has (then the
     * sync leaves Canvas alone until a new token is added).
     */
    canvasOrigin: v.optional(v.string()),
    sealedCanvas: v.optional(v.string()),
    canvasName: v.optional(v.string()),
    canvasRefused: v.optional(v.string()),
    /**
     * The calendar feed's current link (calendar.ts): a random value its URL is signed over. Unset until the student
     * asks for a link; a new one ends the old link.
     */
    calendarNonce: v.optional(v.string()),
    /**
     * When the background scheduler next syncs this account (convex/sync.ts). Each account keeps its own phase in the
     * quarter hour, so background syncs are spread out rather than all at once. Unset until the scheduler first sees it.
     */
    nextSyncAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_key", ["key"])
    .index("by_nextSync", ["nextSyncAt"]),

  /** A signed-in device: the hash of the token the browser holds, pointing at its account. */
  sessions: defineTable({
    tokenHash: v.string(),
    accountId: v.id("accounts"),
    createdAt: v.number(),
    lastSeenAt: v.number(),
  })
    .index("by_token", ["tokenHash"])
    .index("by_lastSeen", ["lastSeenAt"])
    .index("by_account", ["accountId"]),

  /**
   * Why a device was signed out behind its back (the stored login stopped working), kept a few days under its token's
   * hash so the device can say so after its session is gone. See accounts.ts.
   */
  farewells: defineTable({
    tokenHash: v.string(),
    code: v.union(v.literal("signed-out"), v.literal("password-changed")),
    message: v.string(),
    at: v.number(),
  })
    .index("by_token", ["tokenHash"])
    .index("by_at", ["at"]),

  /** What Connect last said for an account (grades), so the app shows it at once and asks Connect again only now and then. */
  connectCache: defineTable({
    accountId: v.id("accounts"),
    kind: v.string(),
    data: v.optional(v.any()),
    fetchedAt: v.optional(v.number()),
    error: v.optional(v.string()),
    checkedAt: v.number(),
  }).index("by_account_kind", ["accountId", "kind"]),

  /**
   * What Canvas last said for an account (canvas.ts): "courses", "announcements", and one "work:<courseId>" row per
   * course (its assignments with the student's submissions, and its assignment groups). Shaped as connectCache: an
   * error is kept beside the last good data.
   */
  canvasCache: defineTable({
    accountId: v.id("accounts"),
    kind: v.string(),
    data: v.optional(v.any()),
    fetchedAt: v.optional(v.number()),
    error: v.optional(v.string()),
    checkedAt: v.number(),
  }).index("by_account_kind", ["accountId", "kind"]),

  /**
   * What Compass last said for an account, trimmed to what the app shows: "tasks", "news", one "day:YYYY-MM-DD" row per
   * school day of the timetable (convex/timetable.ts), and "classes", every class seen on the timetable lately.
   */
  compassCache: defineTable({
    accountId: v.id("accounts"),
    kind: v.string(),
    data: v.any(),
    fetchedAt: v.number(),
  }).index("by_account_kind", ["accountId", "kind"]),

  /**
   * One pass over everything Compass Neo keeps for an account: a step per thing fetched, in order, Compass first and
   * then Connect. The app draws its sync dial from this as it fills in. See convex/sync.ts.
   */
  syncs: defineTable({
    accountId: v.id("accounts"),
    reason: v.union(v.literal("sign-in"), v.literal("open"), v.literal("manual"), v.literal("active"), v.literal("background")),
    /** full: every step. quick: the few that change minute to minute (an open tab's minute sync). Unset on older runs: full. */
    kind: v.optional(v.union(v.literal("full"), v.literal("quick"))),
    /** The workpool job running it (convex/pools.ts), and how many times it has been tried. */
    workId: v.optional(v.string()),
    attempts: v.optional(v.number()),
    /** A quiet run (active, background) someone asked to see after it had started: the gauges draw it after all. */
    watched: v.optional(v.boolean()),
    /** When it was asked for; it may wait in its pool a while before the job starts. */
    startedAt: v.number(),
    /** The job's last sign of life (an attempt starting, a step starting or ending). Unset while it waits its turn. */
    aliveAt: v.optional(v.number()),
    finishedAt: v.optional(v.number()),
    steps: v.array(
      v.object({
        key: v.string(),
        source: v.union(v.literal("compass"), v.literal("connect"), v.literal("canvas")),
        status: v.union(v.literal("waiting"), v.literal("running"), v.literal("done"), v.literal("failed"), v.literal("skipped")),
        count: v.optional(v.number()),
        note: v.optional(v.string()),
        at: v.optional(v.number()),
      }),
    ),
  })
    .index("by_account", ["accountId", "startedAt"])
    .index("by_work", ["workId"]),

  /** Teachers per school: the name and photo Compass shows for each (convex/teachers.ts). */
  teachers: defineTable({
    slug: v.string(),
    code: v.string(),
    userId: v.number(),
    name: v.optional(v.string()),
    photoPath: v.optional(v.string()),
    photoId: v.optional(v.id("_storage")),
    checkedAt: v.number(),
  }).index("by_slug_code", ["slug", "code"]),

  /** Sign-in attempts per school and username, to stop this server being used to guess passwords. */
  attempts: defineTable({
    key: v.string(),
    at: v.number(),
  }).index("by_key_at", ["key", "at"]),

  /**
   * The school's news items, one row per item per school (convex/announcements.ts), shared by every student there so
   * each is read with Claude once. Which items a student sees is their own "news" row in compassCache. hash is of the
   * title and text: an edited notice gets a new one and is read again. parsedHash is the version parsed holds.
   */
  announcements: defineTable({
    slug: v.string(),
    itemId: v.string(),
    title: v.string(),
    by: v.optional(v.string()),
    /** When Compass says it was posted (ISO), and when a sync first saw it. */
    postedAt: v.optional(v.string()),
    firstSeenAt: v.number(),
    seenAt: v.number(),
    important: v.boolean(),
    /** The attached files' names (what Claude is told of them). */
    attachments: v.array(v.string()),
    /**
     * Where each attached file is: path on the school's Compass (opened through the file route with a student's session,
     * lib/links.ts), or url, a link elsewhere. Missing on items kept before files were.
     */
    files: v.optional(v.array(v.object({ name: v.string(), path: v.union(v.string(), v.null()), url: v.union(v.string(), v.null()) }))),
    /** Plain text, capped. */
    text: v.string(),
    /**
     * The notice as it was written, as plain blocks (paragraphs and list items of bold, italic and link runs, from its
     * HTML by lib/plan.ts: nothing of the HTML itself), for showing the original. Missing on items kept before it was.
     */
    blocks: v.optional(
      v.array(
        v.object({
          kind: v.union(v.literal("p"), v.literal("li")),
          runs: v.array(v.object({ t: v.string(), b: v.optional(v.literal(true)), i: v.optional(v.literal(true)), href: v.optional(v.string()) })),
        }),
      ),
    ),
    hash: v.string(),
    status: v.union(v.literal("pending"), v.literal("done"), v.literal("failed"), v.literal("skipped")),
    /** Why it was not read: no API key yet (read once there is one), too old when first seen, or nothing to read. */
    skipped: v.optional(v.union(v.literal("no-key"), v.literal("old"), v.literal("empty"))),
    /** Until when a queued read holds the item, so syncs racing each other queue it once. */
    leaseUntil: v.optional(v.number()),
    workId: v.optional(v.string()),
    /** A failure worth trying again (the API was down through every retry) is tried again after this. */
    nextTryAt: v.optional(v.number()),
    error: v.optional(v.string()),
    model: v.optional(v.string()),
    parsedAt: v.optional(v.number()),
    parsedHash: v.optional(v.string()),
    /** What Claude read in it (convex/ai.ts): times are the school's own, "HH:MM"; years are year levels (7 is Year 7). */
    parsed: v.optional(
      v.object({
        kind: v.union(v.literal("daily-notices"), v.literal("announcement"), v.literal("other")),
        summary: v.string(),
        bullets: v.array(v.string()),
        assemblies: v.array(
          v.object({
            title: v.string(),
            date: v.string(),
            start: v.union(v.string(), v.null()),
            end: v.union(v.string(), v.null()),
            periods: v.array(v.number()),
            /** Empty: the whole school. */
            years: v.array(v.number()),
            /** A narrower group than whole year levels (the choir, award winners), else null. */
            group: v.union(v.string(), v.null()),
            place: v.union(v.string(), v.null()),
            notes: v.union(v.string(), v.null()),
            confidence: v.union(v.literal("high"), v.literal("medium"), v.literal("low")),
          }),
        ),
        /** A revised bell schedule for a day, when the notice gives one. */
        bells: v.array(
          v.object({
            date: v.string(),
            years: v.array(v.number()),
            reason: v.union(v.string(), v.null()),
            slots: v.array(v.object({ period: v.union(v.number(), v.null()), label: v.string(), start: v.string(), end: v.string() })),
            confidence: v.union(v.literal("high"), v.literal("medium"), v.literal("low")),
          }),
        ),
      }),
    ),
  }).index("by_slug_item", ["slug", "itemId"]),
});
