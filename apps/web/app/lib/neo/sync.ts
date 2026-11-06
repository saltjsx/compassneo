import { useCallback, useEffect, useState } from "react";
import { useMutation } from "convex/react";
import { useQuery } from "convex-helpers/react/cache/hooks";
import type { FunctionReturnType } from "convex/server";
import { api } from "@compassneo/backend/api";
import { motionMs } from "./schools";
import { signOutNotice } from "./session";

/**
 * The account's syncs (convex/sync.ts). Each run waits its turn in a pool on the server, then its steps run one after
 * another, Compass first, then Connect at a WA school; each lands in the run as it starts and ends. The app shows only
 * how far along a run is, and only for runs someone is watching (a sign-in, opening the app, "Sync now"): the quiet
 * ones (an open tab's minute sync, the background's quarter hour) just move "Synced 2 minutes ago" on.
 */

export type SyncState = NonNullable<FunctionReturnType<typeof api.sync.latest>>;
export type SyncRun = NonNullable<SyncState["watched"]>;
export type SyncStep = SyncRun["steps"][number];
export type StepStatus = SyncStep["status"];

/**
 * A run still waiting for its job this long, or not heard from in ALIVE_STALE once going, is over as far as the screen
 * is concerned (the server lets it go at the same marks).
 */
const QUEUED_STALE = 30 * 60 * 1000;
const ALIVE_STALE = 10 * 60 * 1000;

/** Opening the app again after this long away counts as opening it: the gauge shows the sync it asks for. */
const AWAY = 15 * 60 * 1000;

/** The latest watched run and the latest finished one. */
export const useSyncState = (token: string | null) => useQuery(api.sync.latest, { token });

/** The latest run someone is watching, finished or not: undefined while loading, null if there is none. */
export function useSyncRun(token: string | null) {
  const state = useSyncState(token);
  return state === undefined ? undefined : (state?.watched ?? null);
}

export const isRunning = (run: SyncRun | null | undefined): boolean =>
  !!run && !run.finishedAt && (run.aliveAt ? Date.now() - run.aliveAt < ALIVE_STALE : Date.now() - run.startedAt < QUEUED_STALE);

const settled = (s: StepStatus) => s === "done" || s === "failed" || s === "skipped";

/**
 * How far along the run is, as the screen shows it: steps count as settled one at a time, at most one per pace (the
 * needle's swing), so a sync quicker than the eye still sweeps the gauge smoothly instead of jumping to the end.
 */
export function usePacedSync(run: SyncRun | null | undefined) {
  const total = run?.steps.length ?? 0;
  let real = 0;
  while (run && real < total && settled(run.steps[real].status)) real++;

  const [shown, setShown] = useState(0);
  const [forRun, setForRun] = useState(run?._id);
  if (run?._id !== forRun) {
    setForRun(run?._id);
    setShown(0);
  }

  useEffect(() => {
    if (shown >= real) return;
    const pace = motionMs("--dur-morph") * 1.5;
    const t = window.setTimeout(() => setShown(n => n + 1), pace);
    return () => window.clearTimeout(t);
  }, [shown, real]);

  const complete = !!run?.finishedAt && shown >= total;
  return { progress: total ? shown / total : 0, complete };
}

/**
 * Keeps the signed-in account synced while the app is open. On opening it asks for an "open" sync; then, while the tab
 * is in front of someone, an "active" one about once a minute: first at a random point in the first minute and a half,
 * then every 55 to 65 seconds, so devices opened together drift apart instead of asking in step. A hidden tab asks
 * nothing; shown again it asks at once (as an "open" after a quarter hour away, so the gauge shows it). The server
 * decides what each ask gets: a full run, a quick one, or nothing (convex/sync.ts).
 *
 * If the account was forgotten behind this device's back (its stored login stopped working, maybe in a background sync),
 * the farewell it left says why, and the sign-in screen shows it.
 */
export function useAutoSync(token: string | null) {
  const syncNow = useMutation(api.sync.now);
  const farewell = useQuery(api.accounts.farewell, { token });

  useEffect(() => {
    if (farewell) signOutNotice.set(farewell.message);
  }, [farewell]);

  useEffect(() => {
    if (!token) return;
    let timer: number | undefined;
    let hiddenAt: number | null = null;

    const ask = (reason: "open" | "active") =>
      void syncNow({ token, reason })
        .then(r => {
          if (!r.ok && (r.code === "signed-out" || r.code === "password-changed")) signOutNotice.set(r.message);
        })
        .catch(() => {});
    const after = (ms: number) => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (document.visibilityState !== "visible") return;
        ask("active");
        after(55_000 + Math.random() * 10_000);
      }, ms);
    };
    const onVisibility = () => {
      if (document.visibilityState !== "visible") {
        hiddenAt ??= Date.now();
        window.clearTimeout(timer);
        return;
      }
      const away = hiddenAt != null && Date.now() - hiddenAt > AWAY;
      hiddenAt = null;
      ask(away ? "open" : "active");
      after(55_000 + Math.random() * 10_000);
    };

    ask("open");
    if (document.visibilityState === "visible") after(30_000 + Math.random() * 60_000);
    else hiddenAt = Date.now();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [token, syncNow]);
}

/** A refresh that has not brought newer data in this long has failed quietly (Compass or Connect did not answer). */
const REFRESH_GIVE_UP = 90_000;

/**
 * When something the sync brings was last checked: its row's fetchedAt, or later, when one of its steps ("compass:news",
 * "connect:grades") came back done since. A row that comes back the same is not written again (the server's
 * lib/same.ts), so its own time can trail the last check. Undefined while there is no row.
 */
export function useChecked(token: string | null, fetchedAt: number | undefined, steps: string[]) {
  const checked = useSyncState(token)?.checked;
  if (fetchedAt == null) return undefined;
  return Math.max(fetchedAt, ...steps.map(k => checked?.[k] ?? 0));
}

/**
 * Refreshing something the sync brings and nothing else fetches (grades, notices): it starts a sync now, as "Sync now"
 * does, and counts as refreshing until the thing was checked after the ask (useChecked, with its steps), so it needs
 * nothing of the run but what it writes. The query updates by itself; after REFRESH_GIVE_UP it stops spinning either way.
 */
export function useSyncRefresh(token: string | null, fetchedAt: number | undefined, steps: string[]) {
  const syncNow = useMutation(api.sync.now);
  const [askedAt, setAskedAt] = useState<number | null>(null);
  const checkedAt = useChecked(token, fetchedAt, steps);
  const landed = askedAt != null && checkedAt != null && checkedAt >= askedAt;
  useEffect(() => {
    if (askedAt == null) return;
    if (landed) return setAskedAt(null);
    const t = window.setTimeout(() => setAskedAt(null), REFRESH_GIVE_UP);
    return () => window.clearTimeout(t);
  }, [askedAt, landed]);
  const refresh = useCallback(async () => {
    if (!token) return;
    setAskedAt(Date.now());
    try {
      await syncNow({ token, force: true });
    } catch {
      // The query keeps the last answer; a failed refresh changes nothing on screen.
      setAskedAt(null);
    }
  }, [token, syncNow]);
  return { refresh, refreshing: askedAt != null && !landed };
}
