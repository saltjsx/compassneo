import { flushSync } from "react-dom";

/**
 * Morphs the screen from one state to the next with the View Transitions API. Parts that carry a view-transition-name
 * on both sides (brand.css, the neo-vt-* classes) glide and resize from their old box to their new one; the rest of
 * the page dissolves, old and new at once, with nothing sliding in.
 *
 * The kind goes on <html> as data-morph while the morph plays, so brand.css can tell a step change (named parts glide,
 * the step's box is wiped from the top) from a change of route (the new screen is wiped over the old one, whole) from a
 * change of theme (the new palette washes across the old: theme.ts drives it, through onReady).
 *
 * Without the API, or with reduced motion, the update just happens.
 */

type ViewTransition = { finished: Promise<void>; ready: Promise<void> };
type WithTransitions = Document & { startViewTransition?: (update: () => unknown) => ViewTransition };
type Kind = "step" | "route" | "theme";

export const canMorph = () =>
  typeof document !== "undefined" &&
  typeof (document as WithTransitions).startViewTransition === "function" &&
  !matchMedia("(prefers-reduced-motion: reduce)").matches;

async function run(kind: Kind, update: () => unknown, onReady?: () => void): Promise<void> {
  const root = document.documentElement;
  root.dataset.morph = kind;
  try {
    const t = (document as WithTransitions).startViewTransition!(update);
    // Both pictures are taken: an animation of the transition's own (a wipe) can start.
    if (onReady) void t.ready.then(onReady, () => {});
    await t.finished;
  } catch {
    // A morph that is skipped (another one started) still applied its update.
  } finally {
    // A newer morph may have taken over the attribute; it clears its own.
    if (root.dataset.morph === kind) delete root.dataset.morph;
  }
}

/** A change on this screen: a new step, an error appearing, a new theme. onReady runs once both pictures are taken. */
export function morph(update: () => void, kind: Kind = "step", onReady?: () => void): Promise<void> {
  if (!canMorph()) {
    update();
    return Promise.resolve();
  }
  return run(kind, () => flushSync(update), onReady);
}

/** Resolves once a route root with data-route="<name>" is in the DOM, or after a second and a half. */
async function routeRendered(route: string) {
  const start = performance.now();
  // Timers, not animation frames: the browser holds frames while a transition's update runs.
  while (!document.querySelector(`[data-route="${route}"]`) && performance.now() - start < 1500) {
    await new Promise(r => setTimeout(r, 12));
  }
}

/**
 * A change of route. The transition starts while the current screen is still up, so it is the "before" picture,
 * then navigates inside the transition and waits until the new route's root (data-route) has rendered, so it is the
 * "after" picture. React Router's navigate settles before the new route commits, so it cannot be the signal.
 */
export function morphRoute(go: () => unknown, route: string): Promise<void> {
  if (!canMorph()) return Promise.resolve(go()).then(() => {});
  return run("route", async () => {
    await go();
    await routeRendered(route);
  });
}
