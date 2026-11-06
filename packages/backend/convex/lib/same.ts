/**
 * Whether two stored values say the same thing: the same fields and values at every depth, whatever order the keys
 * came in, with undefined fields counted as absent (Convex drops them on write). The cache writers ask this before a
 * write, so a sync that brings nothing new writes nothing, and no query reading the row runs again.
 */
export function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") {
    return typeof a === "number" && typeof b === "number" && Number.isNaN(a) && Number.isNaN(b);
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!same(a[i], b[i])) return false;
    return true;
  }
  if (a instanceof ArrayBuffer || b instanceof ArrayBuffer) {
    if (!(a instanceof ArrayBuffer && b instanceof ArrayBuffer) || a.byteLength !== b.byteLength) return false;
    const x = new Uint8Array(a);
    const y = new Uint8Array(b);
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false;
    return true;
  }
  const ka = Object.keys(a).filter(k => (a as Record<string, unknown>)[k] !== undefined);
  const kb = Object.keys(b).filter(k => (b as Record<string, unknown>)[k] !== undefined);
  if (ka.length !== kb.length) return false;
  for (const k of ka) if (!same((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) return false;
  return true;
}

/**
 * How long an unchanged row may go without its fetchedAt (or checkedAt) moving on. Moving it is a write, and a write
 * runs every query reading the row again, so a row that keeps coming back the same is stamped at most this often. The
 * app's "Updated" times come from the sync's steps instead (sync.ts latest, `checked`), so they stay exact.
 */
export const STAMP_EVERY = 60 * 60 * 1000;
