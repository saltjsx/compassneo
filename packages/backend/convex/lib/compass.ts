import type { ActionCtx } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";
import { internal } from "../_generated/api";
import { CompassError, CompassSession, signIn, type Cookies } from "@compassneo/compass";
import { hashToken, seal, unseal } from "./crypto";
import { isAgentToken } from "./agent";

export type Login = { username: string; password: string };

/** Why a call for a device could not be made. The client signs out on "signed-out" and "password-changed". */
export type Problem =
  | { ok: false; code: "signed-out"; message: string }
  | { ok: false; code: "password-changed"; message: string }
  | { ok: false; code: "unavailable"; message: string }
  | { ok: false; code: "upstream"; message: string };

export type Result<T> = { ok: true; value: T } | Problem;

/**
 * The account a device's token is for, noting the device as used. An AI's link (lib/agent.ts) is taken only by an
 * action that asks for a reader: one that fetches what a page shows, and changes nothing a student did.
 */
export async function deviceAccount(ctx: ActionCtx, token: string, opts?: { reader?: boolean }) {
  if (isAgentToken(token)) return opts?.reader ? ctx.runQuery(internal.mcp.accountOf, { token }) : null;
  const found = await ctx.runQuery(internal.accounts.byTokenHash, { tokenHash: await hashToken(token) });
  if (found) await ctx.runMutation(internal.accounts.touch, { sessionId: found.session._id });
  return found?.account ?? null;
}

export async function storedLogin(account: Doc<"accounts">): Promise<Login | null> {
  if (!account.sealedLogin) return null;
  return unseal<Login>("CREDENTIALS_KEY", account.sealedLogin, account.key);
}

/**
 * What to do when a stored login can no longer sign in: forget the account, so every device is asked again. Often no
 * device is asking (a background sync), so each is left the reason as a farewell (accounts.ts) to show when it looks.
 */
export async function loginRejected(ctx: ActionCtx, account: Doc<"accounts">): Promise<Problem> {
  const farewell = { code: "password-changed", message: "Your Compass password has changed. Sign in again." } as const;
  await ctx.runMutation(internal.accounts.forget, { accountId: account._id, farewell });
  return { ok: false, ...farewell };
}

/**
 * A sign-in with the stored login, where a refusal is asked twice before it is believed. Forgetting an account deletes
 * everything kept for it, and background syncs now sign in again many times a day, so one odd refusal from a Compass
 * having a bad minute must not cost the account. Twice is still far short of Compass's lockout after a real password
 * change, and the account is forgotten on the second, so it is never asked again.
 */
async function signInConfirmed(slug: string, login: Login) {
  try {
    return await signIn({ slug, ...login });
  } catch (e) {
    if (!(e instanceof CompassError && e.code === "bad-credentials")) throw e;
    await new Promise(resolve => setTimeout(resolve, 2_500 + Math.random() * 1_500));
    return signIn({ slug, ...login });
  }
}

async function signInAgain(ctx: ActionCtx, account: Doc<"accounts">): Promise<CompassSession | Problem> {
  const login = await storedLogin(account);
  if (!login) {
    // Signed in before logins were kept: there is nothing to sign in again with.
    const farewell = { code: "signed-out", message: "Compass ended your session. Sign in again." } as const;
    await ctx.runMutation(internal.accounts.forget, { accountId: account._id, farewell });
    return { ok: false, ...farewell };
  }
  try {
    const session = await signInConfirmed(account.slug, login);
    await ctx.runMutation(internal.accounts.saveCompass, {
      accountId: account._id,
      sealedCompass: await seal("SESSION_KEY", session.cookies, account.key),
      fresh: true,
    });
    return session;
  } catch (e) {
    if (e instanceof CompassError && e.code === "bad-credentials") return loginRejected(ctx, account);
    if (e instanceof CompassError) return { ok: false, code: "upstream", message: e.message };
    throw e;
  }
}

/**
 * Runs fn with the account's Compass session. If Compass has ended it, signs in again with the stored login and
 * runs fn once more. Cookies Compass rotates along the way are kept.
 */
export async function withCompass<T>(
  ctx: ActionCtx,
  account: Doc<"accounts">,
  fn: (session: CompassSession) => Promise<T>,
): Promise<Result<T>> {
  const cookies = await unseal<Cookies>("SESSION_KEY", account.sealedCompass, account.key).catch(() => null);
  let session: CompassSession | Problem = cookies
    ? new CompassSession(account.slug, cookies, account.compassUserId || null)
    : await signInAgain(ctx, account);
  for (let attempt = 0; attempt < 2; attempt++) {
    if (!(session instanceof CompassSession)) return session;
    const before = JSON.stringify(session.cookies);
    try {
      const value = await fn(session);
      if (JSON.stringify(session.cookies) !== before) {
        await ctx.runMutation(internal.accounts.saveCompass, {
          accountId: account._id,
          sealedCompass: await seal("SESSION_KEY", session.cookies, account.key),
          fresh: false,
        });
      }
      return { ok: true, value };
    } catch (e) {
      if (!(e instanceof CompassError)) throw e;
      if (e.code !== "expired" || attempt === 1) return { ok: false, code: "upstream", message: e.message };
      session = await signInAgain(ctx, account);
    }
  }
  return { ok: false, code: "upstream", message: "Compass did not answer." };
}
