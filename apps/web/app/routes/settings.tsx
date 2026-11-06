import { useEffect } from "react";
import { Navigate, PrefetchPageLinks, useLocation, useNavigate } from "react-router";
import type { Route } from "./+types/settings";
import { useSession, useSignOut } from "@/lib/neo/session";
import { morphRoute } from "@/lib/neo/morph";
import { useArrival } from "@/lib/neo/arrive";
import { cn } from "@/lib/glaze/utils";
import { Button } from "@/components/glaze/ui/button";
import { ArrowLeft, Dark, Icon } from "@/components/glaze/icon";
import { Account } from "@/features/settings/account";
import { ThemeSwitch } from "@/features/settings/theme-switch";
import { CanvasLink } from "@/features/settings/canvas-link";
import { CalendarFeed } from "@/features/settings/calendar-feed";
import { AiAccess } from "@/features/settings/ai-access";

export function meta({}: Route.MetaArgs) {
  return [{ title: "Settings · Compass Neo" }];
}

/**
 * Settings, a page of its own (the profile card in the corner only says who and where now): the account and its sync,
 * the theme, Canvas, the calendar link and AI access, one card each. The arrow at the top, or Escape, goes back to the day.
 */
export default function Settings() {
  const session = useSession();
  const signOut = useSignOut();
  const navigate = useNavigate();
  const location = useLocation();
  const arrival = useArrival();
  const token = session.token;
  const me = session.me;

  // Back to the day: back through history when the day is where this page was opened from (so Forward still works),
  // else straight there, as from a link or a reload.
  const back = () =>
    void morphRoute(() => (location.key !== "default" ? navigate(-1) : navigate("/", { replace: true, flushSync: true })), "home");

  // Escape goes back, unless it belongs to something on the page: a field, the theme switch, a confirm that is asking.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (document.querySelector('[aria-modal="true"]')) return;
      const t = e.target as HTMLElement | null;
      if (t?.closest("input, textarea, select, [contenteditable], [role=radiogroup], [role=group]")) return;
      back();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (session.status === "signed-out" || !me || !token) return <Navigate to="/login" replace />;

  // As from home: the screen morphs to sign-in, and the session is cleared once it is up.
  const leave = async () => {
    await morphRoute(() => navigate("/login", { replace: true, flushSync: true, state: { signedOut: true } }), "login");
    await signOut();
  };

  return (
    <div data-route="settings" className="min-h-dvh bg-page">
      <PrefetchPageLinks page="/" />
      <PrefetchPageLinks page="/login" />
      <header className="neo-topbar sticky top-0 z-20">
        <div className="neo-column mx-auto flex w-full items-center gap-1 px-4 neo-safe-top pb-3">
          <Button variant="ghost" size="icon" aria-label="Back to today" onClick={back} className="-ms-2">
            <Icon icon={ArrowLeft} />
          </Button>
          <h1 className="type-heading text-text-1">Settings</h1>
        </div>
      </header>

      <main onAnimationEnd={arrival.onAnimationEnd} className={cn("neo-column mx-auto flex w-full flex-col gap-3 px-4 pb-16", arrival.className)}>
        <Account me={me} token={token} onSignOut={() => void leave()} />

        <section aria-labelledby="appearance-title" className="neo-stack neo-notice flex flex-col gap-3 p-4">
          <div className="flex items-start gap-2.5">
            <Icon icon={Dark} className="mt-0.5 text-text-2" />
            <div className="min-w-0 flex-1">
              <h2 id="appearance-title" className="type-label text-text-1">
                Appearance
              </h2>
              <p className="type-caption text-text-2">Light, dark, or whichever your device is using.</p>
            </div>
          </div>
          <ThemeSwitch />
        </section>

        <CanvasLink token={token} />
        <CalendarFeed token={token} />
        <AiAccess token={token} />
      </main>
    </div>
  );
}
