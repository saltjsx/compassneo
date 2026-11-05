import type { ActionCtx } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";
import { internal } from "../_generated/api";
import { CanvasError, CanvasSession } from "@compassneo/canvas";
import { unseal } from "./crypto";
import type { Result } from "./compass";

/** Whether the account has Canvas added and Canvas still takes its token. */
export const hasCanvas = (account: Pick<Doc<"accounts">, "sealedCanvas" | "canvasOrigin" | "canvasRefused">) =>
  !!account.sealedCanvas && !!account.canvasOrigin && !account.canvasRefused;

export const REFUSED = "Canvas no longer accepts your access token. Add a new one from your profile.";

/**
 * Runs fn with the account's Canvas. A token Canvas refuses is noted on the account (canvasRefused), so the sync stops
 * asking until the student adds a new one; it does not touch the Compass account.
 */
export async function withCanvas<T>(ctx: ActionCtx, account: Doc<"accounts">, fn: (s: CanvasSession) => Promise<T>): Promise<Result<T>> {
  if (!account.sealedCanvas || !account.canvasOrigin) return { ok: false, code: "unavailable", message: "Canvas is not added." };
  if (account.canvasRefused) return { ok: false, code: "unavailable", message: account.canvasRefused };
  const token = await unseal<string>("CREDENTIALS_KEY", account.sealedCanvas, account.key).catch(() => null);
  if (!token) return { ok: false, code: "unavailable", message: "Add Canvas again from your profile." };
  try {
    return { ok: true, value: await fn(new CanvasSession(account.canvasOrigin, token)) };
  } catch (e) {
    if (!(e instanceof CanvasError)) throw e;
    if (e.code === "bad-token") {
      await ctx.runMutation(internal.canvas.refused, { accountId: account._id, message: REFUSED, sealed: account.sealedCanvas });
      return { ok: false, code: "unavailable", message: REFUSED };
    }
    return { ok: false, code: "upstream", message: e.message };
  }
}
