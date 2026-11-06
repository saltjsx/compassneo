import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useNavigate } from "react-router";
import { useAction } from "convex/react";
import { motion } from "motion/react";
import { MedianSupport, medianSupport, useMedianSupport, type MedianUser } from "@mediansh/widget";
import { api } from "@compassneo/backend/api";
import { Help, Icon } from "@/components/glaze/icon";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/glaze/ui/tooltip";
import { cn } from "@/lib/glaze/utils";
import { spring } from "@/lib/neo/motion";
import { useSession } from "@/lib/neo/session";

const KEY = import.meta.env.VITE_MEDIAN_PUBLIC_KEY as string | undefined;

/** Whether the help chat is on this build (it needs Median's public key). */
export const helpAvailable = !!KEY;

/**
 * What the student opened help about, from a button beside the thing ("adding Canvas"), told to the agent with their
 * next message (appState), so it can start there instead of asking. Kept until the page reloads.
 */
let topic: string | null = null;
const listeners = new Set<() => void>();
const useTopic = () =>
  useSyncExternalStore(
    l => (listeners.add(l), () => listeners.delete(l)),
    () => topic,
    () => null,
  );

/** Opens the help chat about something: the agent hears the topic with the student's first message. */
export function askForHelp(about: string) {
  topic = about;
  listeners.forEach(l => l());
  medianSupport.open();
}

/**
 * Median's support agent (median.sh), with the team behind it. No launcher of its own: it stays out of sight until
 * the help button in the top bar (SupportButton) opens it.
 *
 * A signed-in student is signed for Median on the server (convex/median.ts `identity`), so the agent's tools know whose
 * account they are reading; the browser never holds anything that could sign. Signed out, it is an anonymous visitor.
 * When this device signs out (by the person, or behind its back when Compass rejects the saved login) the widget
 * forgets its conversation, so the next person on a shared computer starts clean. The agent's tools open pages and
 * classes by address (routes/home.tsx reads it).
 */
export function Support() {
  const { token, me } = useSession();
  const navigate = useNavigate();
  const identity = useAction(api.median.identity);
  const [signed, setSigned] = useState<{ token: string; user: MedianUser } | null>(null);
  const had = useRef(token);
  const about = useTopic();

  useEffect(() => {
    if (had.current && !token) medianSupport.reset();
    had.current = token;
    if (!token) return;
    let live = true;
    identity({ token })
      .then(u => live && u && setSigned({ token, user: u }))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [token, identity]);

  if (!KEY) return null;
  // Until the signature arrives, the name is shown (unverified, display only); the id joins once it is signed.
  const user = signed && signed.token === token ? signed.user : me ? { name: me.fullName ?? me.displayName } : undefined;
  return (
    <MedianSupport
      apiKey={KEY}
      launcher="hidden"
      user={user}
      appState={about ? { helpingWith: about } : undefined}
      onNavigate={path => navigate(path)}
    />
  );
}

/** The help button in the top bar, beside the sync gauge: opens and closes support, and reads as pressed while it is open. */
export function SupportButton() {
  const support = useMedianSupport();
  if (!KEY) return null;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <motion.button
            type="button"
            aria-label="Help"
            aria-expanded={support.isOpen}
            onClick={support.toggle}
            whileHover={{ scale: 1.08 }}
            whileTap={{ scale: 0.88 }}
            transition={spring.snap}
            className={cn(
              "grid size-(--control) place-items-center rounded-tag focus-visible:focus-ring transition-colors duration-(--dur-state)",
              support.isOpen ? "text-neo" : "text-text-3 hover:text-text-2",
            )}
          />
        }
      >
        <Icon icon={Help} size={20} />
      </TooltipTrigger>
      <TooltipContent side="bottom">Help</TooltipContent>
    </Tooltip>
  );
}
