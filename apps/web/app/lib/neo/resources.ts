import { useCallback, useState } from "react";
import { useAction } from "convex/react";
import { useQuery } from "convex-helpers/react/cache/hooks";
import type { FunctionReturnType } from "convex/server";
import { api } from "@compassneo/backend/api";
import { useLoadOnce } from "./loads";

/**
 * A class's resources (convex/resources.ts): Compass's Resources, Connect's Learning Content and the class's Canvas
 * course's modules, one tree each.
 * Opening the hook asks the server to fetch them (it skips that if it did lately); the answer arrives through the query.
 *
 * Each side is a Side: "none" (this side has nothing for the class: no Connect, or the class is not on it), "missing"
 * (being fetched), "unavailable" (with a reason) or "ready" (with data, when it was fetched, and an error if the last
 * try failed and the data is older).
 */

export type ClassResources = NonNullable<FunctionReturnType<typeof api.resources.forClass>>;
export type ResourceSide = ClassResources["compass"];
export type ResourceNode = Extract<ResourceSide, { status: "ready" }>["data"][number];

export function useClassResources(token: string | null, code: string | null) {
  const data = useQuery(api.resources.forClass, token && code ? { token, code } : "skip");
  const load = useAction(api.resources.load);
  useLoadOnce(token && code ? `resources:${code}` : null, () => load({ token: token!, code: code! }), 5 * 60_000);
  const [refreshing, setRefreshing] = useState(false);
  const refresh = useCallback(async () => {
    if (!token || !code) return;
    setRefreshing(true);
    try {
      await load({ token, code, force: true });
    } finally {
      setRefreshing(false);
    }
  }, [token, code, load]);
  return { data, refresh, refreshing };
}

/** A Compass page (a lesson plan, a page a teacher wrote) as plain blocks, fetched when asked for. */
export function useResourcePage() {
  const page = useAction(api.resources.page);
  return page;
}
