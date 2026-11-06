import { v } from "convex/values";
import { internalMutation, internalQuery, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { hashToken } from "./lib/crypto";

/**
 * Accounts: one per school and username, shared by every device signed in to it.
 *
 * An account holds, sealed (lib/crypto.ts):
 *   sealedLogin    the username and password (CREDENTIALS_KEY), so Compass Neo can sign in again when Compass or
 *                  Connect ends the session. Compass does that every day.
 *   sealedCompass  Compass's session cookies (SESSION_KEY)
 *   sealedConnect  Connect's session cookies (SESSION_KEY), WA schools only
 *   sealedCanvas   the student's Canvas access token (CREDENTIALS_KEY), when they have added Canvas
 * Each is bound to the account's key, so it opens only on its own row.
 *
 * The cookies Compass and Connect rotate, and the scheduler's next turn, change on nearly every sync, and every query
 * reads the account row, so a write to it runs every open query again. Those land in accountState instead (stateOf,
 * setState): the row keeps what the sign-in left, and `live` lays the newer state over it for the sync's actions.
 *
 * Sessions are devices: a token hash pointing at an account. When the last device signs out, the account and its
 * stored login are deleted.
 *
 * When the stored login stops working (lib/compass.ts), the account is forgotten behind its devices' backs, often in a
 * background sync nobody is watching. Each device is left a farewell under its token's hash for a few days, saying
 * why: an open app reads it (`farewell`) and shows it on the sign-in screen, and one opened later hears it from
 * sync.now. The hourly sweep (auth.ts) clears old ones.
 */

export const accountKey = (slug: string, username: string) => `${slug}:${username.trim().toLowerCase()}`;

const HOUR = 60 * 60 * 1000;
const FAREWELL_FOR = 7 * 24 * HOUR;

const farewellV = v.object({ code: v.union(v.literal("signed-out"), v.literal("password-changed")), message: v.string() });
export type Farewell = { code: "signed-out" | "password-changed"; message: string };

export const byTokenHash = internalQuery({
  args: { tokenHash: v.string() },
  handler: async (ctx, { tokenHash }) => {
    const session = await ctx.db.query("sessions").withIndex("by_token", i => i.eq("tokenHash", tokenHash)).first();
    if (!session) return null;
    const account = await ctx.db.get(session.accountId);
    return account ? { session, account: await live(ctx, account) } : null;
  },
});

export const byId = internalQuery({
  args: { accountId: v.id("accounts") },
  handler: async (ctx, { accountId }) => {
    const account = await ctx.db.get(accountId);
    return account && live(ctx, account);
  },
});

// ---------- state: what changes on nearly every sync ----------

type State = Pick<Doc<"accountState">, "sealedCompass" | "compassAt" | "sealedConnect" | "connectAt" | "nextSyncAt">;

export const stateOf = (ctx: QueryCtx, accountId: Id<"accounts">) =>
  ctx.db.query("accountState").withIndex("by_account", i => i.eq("accountId", accountId)).unique();

/** Writes some of an account's state, making its row if it has none. Only the sync's actions and the scheduler read it. */
export async function setState(ctx: MutationCtx, accountId: Id<"accounts">, fields: Partial<State>) {
  const row = await stateOf(ctx, accountId);
  if (row) await ctx.db.patch(row._id, fields);
  else await ctx.db.insert("accountState", { accountId, ...fields });
}

/** The account as the sync's actions need it: its row, with the newer cookies from its state laid over. */
export async function live(ctx: QueryCtx, account: Doc<"accounts">): Promise<Doc<"accounts">> {
  const s = await stateOf(ctx, account._id);
  if (!s) return account;
  return {
    ...account,
    sealedCompass: s.sealedCompass ?? account.sealedCompass,
    compassAt: s.compassAt ?? account.compassAt,
    sealedConnect: s.sealedConnect ?? account.sealedConnect,
    connectAt: s.connectAt ?? account.connectAt,
  };
}

/** A successful sign-in: the account is created or refreshed with the new login and cookies, and a device added. */
export const signedIn = internalMutation({
  args: {
    tokenHash: v.string(),
    key: v.string(),
    slug: v.string(),
    username: v.string(),
    schoolName: v.string(),
    compassUserId: v.number(),
    displayName: v.string(),
    fullName: v.optional(v.string()),
    formGroup: v.optional(v.string()),
    sealedLogin: v.string(),
    sealedCompass: v.string(),
  },
  handler: async (ctx, { tokenHash, ...fields }): Promise<Id<"accounts">> => {
    const now = Date.now();
    const existing = await ctx.db.query("accounts").withIndex("by_key", i => i.eq("key", fields.key)).unique();
    const accountId = existing
      ? (await ctx.db.patch(existing._id, { ...fields, compassAt: now, updatedAt: now }), existing._id)
      : await ctx.db.insert("accounts", { ...fields, compassAt: now, createdAt: now, updatedAt: now });
    // The sign-in's cookies are the newest: they replace any the state kept from before.
    if (existing) {
      const state = await stateOf(ctx, accountId);
      if (state?.sealedCompass) await ctx.db.patch(state._id, { sealedCompass: fields.sealedCompass, compassAt: now });
    }
    await ctx.db.insert("sessions", { tokenHash, accountId, createdAt: now, lastSeenAt: now });
    const school = await ctx.db.query("schools").withIndex("by_slug", i => i.eq("slug", fields.slug)).unique();
    if (school) await ctx.db.patch(school._id, { signIns: school.signIns + 1 });
    return accountId;
  },
});

export const saveCompass = internalMutation({
  args: { accountId: v.id("accounts"), sealedCompass: v.string(), fresh: v.boolean() },
  handler: async (ctx, { accountId, sealedCompass, fresh }) => {
    if (!(await ctx.db.get(accountId))) return;
    await setState(ctx, accountId, { sealedCompass, ...(fresh ? { compassAt: Date.now() } : {}) });
  },
});

export const saveProfile = internalMutation({
  args: {
    accountId: v.id("accounts"),
    displayName: v.string(),
    fullName: v.optional(v.string()),
    formGroup: v.optional(v.string()),
    photoId: v.optional(v.id("_storage")),
    photoPath: v.optional(v.string()),
  },
  handler: async (ctx, { accountId, ...profile }) => {
    const account = await ctx.db.get(accountId);
    if (!account) {
      // Signed out while the photo was copied: it has nobody to belong to.
      if (profile.photoId) await ctx.storage.delete(profile.photoId);
      return;
    }
    if (profile.photoId && account.photoId && account.photoId !== profile.photoId) await ctx.storage.delete(account.photoId);
    // Most syncs bring the same name and form: then the row (which every query reads) is left alone.
    const changed = (Object.keys(profile) as Array<keyof typeof profile>).filter(k => profile[k] !== undefined && profile[k] !== account[k]);
    if (changed.length) await ctx.db.patch(accountId, { ...profile, updatedAt: Date.now() });
  },
});

export const saveConnect = internalMutation({
  args: { accountId: v.id("accounts"), sealedConnect: v.string(), connectStudentId: v.optional(v.number()), fresh: v.boolean() },
  handler: async (ctx, { accountId, sealedConnect, connectStudentId, fresh }) => {
    const account = await ctx.db.get(accountId);
    if (!account) return;
    await setState(ctx, accountId, { sealedConnect, ...(fresh ? { connectAt: Date.now() } : {}) });
    if (connectStudentId != null && connectStudentId !== account.connectStudentId) await ctx.db.patch(accountId, { connectStudentId, updatedAt: Date.now() });
  },
});

/** Marks a device as used, at most once an hour, so idle devices can be swept. */
export const touch = internalMutation({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, { sessionId }) => {
    const s = await ctx.db.get(sessionId);
    if (s && Date.now() - s.lastSeenAt > HOUR) await ctx.db.patch(sessionId, { lastSeenAt: Date.now() });
  },
});

/**
 * Deletes an account, its devices and everything cached for it: its stored login goes with it. With a farewell, each
 * device is told why (see above); a device signing itself out needs none. A sync job still waiting finds its run gone
 * and stops; one under way stops at its next step (convex/sync.ts).
 */
export async function forgetAccount(ctx: MutationCtx, account: Doc<"accounts">, farewell?: Farewell) {
  for (const s of await ctx.db.query("sessions").withIndex("by_account", i => i.eq("accountId", account._id)).collect()) {
    if (farewell) await ctx.db.insert("farewells", { tokenHash: s.tokenHash, ...farewell, at: Date.now() });
    await ctx.db.delete(s._id);
  }
  for (const c of await ctx.db.query("connectCache").withIndex("by_account_kind", i => i.eq("accountId", account._id)).collect()) {
    await ctx.db.delete(c._id);
  }
  for (const c of await ctx.db.query("compassCache").withIndex("by_account_kind", i => i.eq("accountId", account._id)).collect()) {
    await ctx.db.delete(c._id);
  }
  for (const c of await ctx.db.query("canvasCache").withIndex("by_account_kind", i => i.eq("accountId", account._id)).collect()) {
    await ctx.db.delete(c._id);
  }
  for (const r of await ctx.db.query("syncs").withIndex("by_account", i => i.eq("accountId", account._id)).collect()) {
    await ctx.db.delete(r._id);
  }
  const state = await stateOf(ctx, account._id);
  if (state) await ctx.db.delete(state._id);
  if (account.photoId) await ctx.storage.delete(account.photoId);
  await ctx.db.delete(account._id);
}

/** The stored login stopped working (the password changed) or there is none to sign in again with. */
export const forget = internalMutation({
  args: { accountId: v.id("accounts"), farewell: v.optional(farewellV) },
  handler: async (ctx, { accountId, farewell }) => {
    const account = await ctx.db.get(accountId);
    if (account) await forgetAccount(ctx, account, farewell);
  },
});

/** Why this device was signed out behind its back, if it was: the app shows it on the sign-in screen. */
export const farewell = query({
  args: { token: v.union(v.string(), v.null()) },
  handler: async (ctx, { token }): Promise<Farewell | null> => (token ? farewellFor(ctx, await hashToken(token)) : null),
});

export async function farewellFor(ctx: QueryCtx, tokenHash: string): Promise<Farewell | null> {
  const row = await ctx.db.query("farewells").withIndex("by_token", i => i.eq("tokenHash", tokenHash)).first();
  return row ? { code: row.code, message: row.message } : null;
}

/** Clears farewells older than FAREWELL_FOR, a bounded batch at a time (the hourly sweep, auth.ts). */
export async function sweepFarewells(ctx: MutationCtx, now: number) {
  const old = await ctx.db.query("farewells").withIndex("by_at", i => i.lt("at", now - FAREWELL_FOR)).take(500);
  for (const f of old) await ctx.db.delete(f._id);
}
