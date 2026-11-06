import type { QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { readToken, signToken, site } from "./links";

/**
 * An AI's link to an account (mcp.ts): "mcp." and a signed token (lib/links.ts) naming the account and a random value
 * kept on it (mcpNonce), as the calendar feed's link does. It stands in for a device's token, but only to read:
 *
 *   queries      take it (timetable.ts accountFor); a mutation never does, so it cannot change anything
 *   actions      only the ones that fetch what a page shows (the loads) take it, by asking deviceAccount for a reader
 *                (lib/compass.ts); handing in work, adding Canvas and the calendar link never do
 *
 * A new link changes the value, so the old one stops working; turning AI access off clears it, and signing out deletes
 * the account and the link with it.
 */

const PREFIX = "mcp.";
const DOMAIN = "mcp/v1";
type Link = { a: string; n: string };

export const isAgentToken = (token: string) => token.startsWith(PREFIX);

export async function agentToken(accountId: Id<"accounts">, nonce: string) {
  return PREFIX + (await signToken(DOMAIN, { a: accountId, n: nonce } satisfies Link));
}

/** The address an AI app connects to. */
export const agentUrl = (token: string) => `${site()}/mcp/${token}`;

/** The account an AI's link is for, if this server made it and it is still the account's current one. */
export async function readAgentToken(ctx: QueryCtx, token: string): Promise<Doc<"accounts"> | null> {
  if (!isAgentToken(token)) return null;
  const link = await readToken<Link>(DOMAIN, token.slice(PREFIX.length));
  const id = link && ctx.db.normalizeId("accounts", link.a);
  const account = id ? await ctx.db.get(id) : null;
  return account?.mcpNonce && account.mcpNonce === link!.n ? account : null;
}
