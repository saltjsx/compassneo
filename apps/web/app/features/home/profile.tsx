import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Button } from "@/components/glaze/ui/button";
import { Icon, School, Settings, SignOut, Sync } from "@/components/glaze/icon";
import { cn } from "@/lib/glaze/utils";
import { focusIn, spring } from "@/lib/neo/motion";
import { hostOf } from "@/lib/neo/schools";
import type { Me } from "@/lib/neo/session";
import { useSyncState } from "@/lib/neo/sync";
import { useNow } from "@/lib/neo/time";
import { syncLabel } from "@/features/sync/sync-button";

/** The card's padding and its photo, in px (p-4, size-11), so the photo can land on the picture it grew from. */
const CARD_PAD = 16;
const FACE_BIG = 44;
/** The card's corner, which is also exactly half the 28px picture (size-7): the circle and the card share one radius,
 * so the morph between them has no radius to tween (999 → 14 would hold round until the very end, then snap). */
const CARD_RADIUS = 14;
/** The least room left between the card and the screen's edge. */
const EDGE = 12;

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(w => [...w][0]!.toUpperCase())
    .join("");

/** The person: their Compass photo once a sync has copied it, else their initials on Neo blue. */
export function Face({
  me,
  layoutId,
  radius = 999,
  className,
  textClassName,
}: {
  me: Me;
  layoutId?: string;
  radius?: number;
  className?: string;
  textClassName?: string;
}) {
  return (
    <motion.span
      layoutId={layoutId}
      transition={spring.morph}
      // eslint-disable-next-line glaze/no-inline-style -- motion keeps a corner radius true while a box morphs only when it is set through style
      style={{ borderRadius: radius }}
      className={cn("neo-face grid shrink-0 place-items-center overflow-hidden", className)}
    >
      {me.photoUrl ? (
        <img src={me.photoUrl} alt="" className="size-full object-cover" draggable={false} />
      ) : (
        <span className={cn("font-display font-semibold", textClassName)}>{initials(me.fullName ?? me.displayName)}</span>
      )}
    </motion.span>
  );
}

/**
 * The profile picture in the corner. Pressing it grows the circle into a card (they share a motion name), and who is
 * signed in, where, the last sync and the ways on (settings, signing out) come into focus inside it. Pressing outside,
 * Escape or the photo shrinks it back into the circle. Everything to change lives on the settings page, not here.
 */
export function Profile({ me, token, onSettings, onSignOut }: { me: Me; token: string; onSettings: () => void; onSignOut: () => void }) {
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState<{ top: number; right: number } | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const synced = useSyncState(token);
  const now = useNow();

  // The card opens where the picture is: placed so the big photo inside it lands centred on the small one, and kept on
  // screen at the edges. Measured again if the window changes size while it is open.
  useEffect(() => {
    if (!open) return;
    const place = () => {
      const r = trigger.current?.getBoundingClientRect();
      if (!r) return;
      const reach = CARD_PAD + FACE_BIG / 2;
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      setAt({
        top: Math.max(EDGE, cy - reach),
        right: Math.max(EDGE, window.innerWidth - cx - reach),
      });
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && shut();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const shut = () => {
    setOpen(false);
    requestAnimationFrame(() => trigger.current?.focus({ preventScroll: true }));
  };

  return (
    <>
      {/* eslint-disable-next-line glaze/no-native-control -- a picture that is its own button: a Glaze Button would draw a pill around the mark or the photo */}
      <button
        ref={trigger}
        type="button"
        aria-label={`${me.displayName}, account`}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
        className="rounded-pill focus-visible:focus-ring"
      >
        {open ? <span className="block size-7" /> : <Face me={me} layoutId="profile" radius={CARD_RADIUS} className="size-7" textClassName="type-label-sm" />}
      </button>

      <AnimatePresence>
        {open && (
          <div className="fixed inset-0 z-40" onClick={e => e.target === e.currentTarget && shut()}>
            <motion.div className="neo-scrim pointer-events-none absolute inset-0" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={spring.focus} />
            <motion.div
              layoutId="profile"
              role="dialog"
              aria-modal="true"
              aria-label="Account"
              transition={spring.morph}
              // eslint-disable-next-line glaze/no-inline-style -- motion keeps a corner radius true while a box morphs only when it is set through style; the place is measured from the picture
              style={{ borderRadius: CARD_RADIUS, top: at?.top ?? EDGE, right: at?.right ?? EDGE }}
              className="neo-card neo-card-lifted neo-profile-card absolute p-4"
            >
              <motion.div {...focusIn} transition={{ ...spring.focus, delay: 0.06 }} className="flex flex-row-reverse items-center gap-3">
                {/* eslint-disable-next-line glaze/no-native-control -- a picture that is its own button: a Glaze Button would draw a pill around the mark or the photo */}
                <button type="button" aria-label="Close" onClick={shut} className="rounded-pill focus-visible:focus-ring">
                  <Face me={me} className="size-11" textClassName="type-label" />
                </button>
                <div className="min-w-0 flex-1 text-end">
                  <p className="truncate type-label-lg text-text-1">{me.fullName ?? me.displayName}</p>
                  <p className="type-caption text-text-2">{me.formGroup ? `Form ${me.formGroup}` : me.username}</p>
                </div>
              </motion.div>
              <motion.div {...focusIn} transition={{ ...spring.focus, delay: 0.1 }}>
                <div className="mt-3 flex flex-col gap-2 border-t border-line-faint pt-3">
                  <div className="flex items-start gap-2.5">
                    <Icon icon={School} className="mt-0.5 text-text-2" />
                    <div className="min-w-0">
                      <p className="type-label-sm text-text-1">{me.schoolName}</p>
                      <p className="truncate type-caption text-text-2">
                        {me.username} · {hostOf(me.slug)}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2.5">
                    <Icon icon={Sync} className="text-text-2" />
                    <p className="min-w-0 flex-1 type-caption text-text-2">{syncLabel(synced, now)}</p>
                  </div>
                </div>
                <div className="mt-3 flex gap-2">
                  <Button size="sm" variant="secondary" className="flex-1" onClick={onSettings}>
                    <Icon icon={Settings} />
                    Settings
                  </Button>
                  <Button size="sm" variant="secondary" className="flex-1" onClick={onSignOut}>
                    <Icon icon={SignOut} />
                    Sign out
                  </Button>
                </div>
              </motion.div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  );
}
