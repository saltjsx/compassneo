import { useAction, useMutation } from "convex/react";
import { useQuery } from "convex-helpers/react/cache/hooks";
import type { FunctionReturnType } from "convex/server";
import { api } from "@compassneo/backend/api";

/**
 * Canvas beside Compass (convex/canvas.ts): whether this account has added it, and adding (an address and an access
 * token the student makes in Canvas) or removing it. Canvas's work then shows with the rest: the to-do list, each
 * class's Work, the calendar feed.
 */

export type CanvasStatus = NonNullable<FunctionReturnType<typeof api.canvas.status>>;

/** undefined while loading; null for a signed-out device. */
export function useCanvasStatus(token: string | null) {
  return useQuery(api.canvas.status, token ? { token } : "skip");
}

export function useCanvasControls() {
  return { add: useAction(api.canvas.add), remove: useMutation(api.canvas.remove) };
}
