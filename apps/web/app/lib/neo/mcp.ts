import { useAction, useMutation } from "convex/react";
import { useQuery } from "convex-helpers/react/cache/hooks";
import { api } from "@compassneo/backend/api";

/**
 * AI access (convex/mcp.ts): a link an AI app connects to, to read what Compass Neo shows. undefined while loading,
 * null for a signed-out device, else the link (null while it is off).
 */
export function useAiLink(token: string | null) {
  return useQuery(api.mcp.link, token ? { token } : "skip");
}

export function useAiControls() {
  return { enable: useAction(api.mcp.enable), disable: useMutation(api.mcp.disable) };
}
