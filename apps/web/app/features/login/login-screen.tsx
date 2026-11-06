import { useEffect, useRef, useState, type CSSProperties } from "react";
import { PrefetchPageLinks, useNavigate } from "react-router";
import { useAction } from "convex/react";
import { api } from "@compassneo/backend/api";
import { coarsePointer } from "@/lib/glaze/portal";
import { Bezel, NeoMark, Wordmark } from "@/components/brand/logo";
import { sessionStore, signOutNotice, type Me } from "@/lib/neo/session";
import { Alert, AlertTitle } from "@/components/glaze/ui/alert";
import { hostOf, lastSchool, unbreakable, motionMs, rememberSchool, useRecentSchools, type School } from "@/lib/neo/schools";
import { normalizeSlug } from "@/lib/neo/slug";
import { morph, morphRoute } from "@/lib/neo/morph";
import { useArrival } from "@/lib/neo/arrive";
import { usePacedSync, useSyncRun } from "@/lib/neo/sync";
import { cn } from "@/lib/glaze/utils";
import { SchoolStep } from "./school-step";
import { AddressStep, type AddressHint } from "./address-step";
import { CredentialsStep } from "./credentials-step";
import { CheckingStep } from "./checking-step";
import { ThemeToggle } from "@/features/settings/theme-switch";

type Step =
  | { kind: "school" }
  | { kind: "checking"; slug: string }
  | { kind: "address"; hint: AddressHint | null; slug?: string; error?: string }
  | { kind: "credentials"; school: School }
  /** cached: the account was synced before, so the app opens on that at once. at: when the sign-in answered. */
  | { kind: "syncing"; token: string; me: Me; cached: boolean; at: number };

/** The sync gauge's span on the dial, centred on north. Matches --neo-sweep in brand.css. */
const SWEEP = 150;
/** However the sync is going, the app opens this long after signing in; the sync carries on behind it. */
const SYNC_PATIENCE = 20_000;
/** A sync still waiting its turn on the server this long after signing in does not hold the screen either. */
const QUEUE_PATIENCE = 5_000;

/** Where to start: the school in the address, else the last school this device used, else the picker. */
function firstStep(slugParam: string | undefined, recent: School[]): Step {
  if (slugParam) {
    const slug = normalizeSlug(slugParam);
    if (!slug) return { kind: "school" };
    const known = recent.find(s => s.slug === slug);
    return known ? { kind: "credentials", school: known } : { kind: "checking", slug };
  }
  const last = lastSchool();
  return last ? { kind: "credentials", school: last } : { kind: "school" };
}

function stepLabel(step: Step) {
  switch (step.kind) {
    case "school":
      return "Choose your school";
    case "checking":
      return "Checking the school's address";
    case "address":
      return "Enter your school's Compass address";
    case "credentials":
      return `Sign in to ${step.school.name}`;
    case "syncing":
      return "Syncing";
  }
}

/**
 * The sign-in screen. One question at a time: which school, then who you are.
 *
 * Signing in does not leave the screen: the form wipes away and the compass syncs. The dial behind the mark fills like
 * a gauge and the needle sweeps across it as the sync goes, then finds north, and the app takes over. It says nothing
 * about what is being fetched; the compass is the progress. An account synced before (another device, a sign-in again)
 * does not wait for it: the needle sweeps once to north and the app opens on what it already has, while the sync
 * carries on behind it in the corner gauge.
 *
 * Motion: nothing slides or rises. On a cold load the screen is uncovered from the top while the needle swings to
 * north and the dial draws itself out from north. After that every change is a morph (lib/neo/morph.ts): the school
 * field becomes the school card, the main button glides to its new place, and the step's box is wiped from the top
 * into the next one. The stage is anchored to the top, so the mark and wordmark never move.
 */
export function LoginScreen({ slugParam }: { slugParam?: string }) {
  const navigate = useNavigate();
  const recent = useRecentSchools();
  const verify = useAction(api.schools.verify);
  const [step, setStep] = useState<Step>(() => firstStep(slugParam, recent));
  // Bumps with each step, so focus can follow the person into the new one.
  const [stepKey, setStepKey] = useState(0);
  const arrival = useArrival();

  // The sync after a sign-in, paced so each step reads (lib/neo/sync.ts). Finding north is the end of it: the needle
  // back at north, the gauge full, and the app about to open.
  const syncing = step.kind === "syncing" ? step : null;
  const run = useSyncRun(syncing?.token ?? null);
  const sync = usePacedSync(syncing && !syncing.cached ? run : null);
  const [foundNorth, setFoundNorth] = useState(false);
  // Why this device was signed out, if it was ("Your Compass password has changed. Sign in again.").
  const notice = signOutNotice.use();
  const section = useRef<HTMLElement>(null);
  // While syncing, the step has nothing to focus; the status line takes focus instead, and is read out.
  const syncStatus = useRef<HTMLParagraphElement>(null);
  // A phone keeps its keyboard down until the person taps a field.
  const [focusOnMount] = useState(() => !coarsePointer());

  // Whether the person was working inside the step being replaced, so the next one should carry their focus on.
  const carryFocus = useRef(false);

  const go = (next: Step, alongside?: () => void) => {
    carryFocus.current = !!section.current?.contains(document.activeElement);
    return morph(() => {
      alongside?.();
      setStep(next);
      setStepKey(k => k + 1);
    });
  };

  const choose = (school: School) => {
    rememberSchool(school);
    void go({ kind: "credentials", school });
    navigate(`/login/${school.slug}`, { replace: true });
  };

  const changeSchool = () => {
    void go({ kind: "school" });
    navigate("/login", { replace: true });
  };

  // The person was in the old step and its control is gone: if the new step did not take focus itself (a phone, or a
  // step with no field), its region takes it, so a keyboard or screen reader carries on from the new step instead of
  // the top of the page. Focus nobody placed (a deep link) is left alone.
  useEffect(() => {
    if (stepKey === 0 || !carryFocus.current) return;
    carryFocus.current = false;
    if (section.current?.contains(document.activeElement)) return;
    (syncStatus.current ?? section.current)?.focus({ preventScroll: true });
  }, [stepKey]);

  // An address in the URL that this device has not used before: check it is a real school first.
  useEffect(() => {
    if (step.kind !== "checking") return;
    let live = true;
    const slug = step.slug;
    verify({ slug })
      .then(r => {
        if (!live) return;
        if (r.status === "found") choose(r.school);
        else
          void go({
            kind: "address",
            hint: null,
            slug,
            error:
              r.status === "blocked"
                ? "Compass did not answer just now; try again in a minute."
                : `No Compass school answers at ${unbreakable(hostOf(slug))}; check the spelling.`,
          });
      })
      .catch(() => live && void go({ kind: "address", hint: null, slug, error: "Compass Neo could not check that address; try again." }));
    return () => {
      live = false;
    };
    // Runs once per checking step; choose and go are recreated each render but do the same thing.
  }, [step]);

  // Signed in: the device keeps the session at once (a reload from here lands in the app), and the form morphs into
  // the sync.
  const signedIn = (token: string, me: Me, cached: boolean) => {
    void go({ kind: "syncing", token, me, cached, at: Date.now() }, () => {
      sessionStore.set({ token, me });
      signOutNotice.set(null);
    });
  };

  // Everything is in: the needle swings back to north and the line under the wordmark says so. An account synced before
  // has what home shows already, so the needle only takes one swing. A sync that is taking too long, or is still
  // waiting its turn on the server (or never started), does not hold the person here; it carries on behind the app.
  const waiting = syncing != null && !syncing.cached && (run === null || (!!run && !run.aliveAt && !run.finishedAt));
  useEffect(() => {
    if (!syncing || foundNorth) return;
    const finish = () => void morph(() => setFoundNorth(true));
    if (sync.complete) return finish();
    const left = (ms: number) => Math.max(0, syncing.at + ms - Date.now());
    const wait = syncing.cached ? motionMs("--dur-morph") * 1.5 : left(waiting ? QUEUE_PATIENCE : SYNC_PATIENCE);
    const t = window.setTimeout(finish, wait);
    return () => window.clearTimeout(t);
  }, [syncing, sync.complete, foundNorth, waiting]);

  // Then the app opens, once the needle has settled.
  useEffect(() => {
    if (!foundNorth) return;
    const t = window.setTimeout(
      () => void morphRoute(() => navigate("/", { replace: true, flushSync: true }), "home"),
      motionMs("--dur-morph") * 1.5 + 450,
    );
    return () => window.clearTimeout(t);
  }, [foundNorth]);

  // Once the needle has found north, the compass is alive: on a mouse, the needle leans toward the pointer and the bezel
  // turns a touch with it, both on the spring; left alone it wanders a degree or two either way, as a real one does.
  const dial = useRef<HTMLDivElement>(null);
  const [alive, setAlive] = useState(false);
  const [lean, setLean] = useState({ needle: 0, bezel: 0 });
  useEffect(() => {
    const t = window.setTimeout(() => setAlive(true), motionMs("--dur-needle"));
    return () => window.clearTimeout(t);
  }, []);
  useEffect(() => {
    if (!alive || syncing || coarsePointer()) return;
    const move = (e: PointerEvent) => {
      const r = dial.current?.getBoundingClientRect();
      if (!r) return;
      const dx = e.clientX - (r.left + r.width / 2);
      const dy = e.clientY - (r.top + r.height / 2);
      const toward = (Math.atan2(dx, -dy) * 180) / Math.PI;
      setLean({ needle: Math.max(-24, Math.min(24, toward * 0.3)), bezel: Math.max(-5, Math.min(5, (dx / window.innerWidth) * 10)) });
    };
    const rest = () => setLean({ needle: 0, bezel: 0 });
    window.addEventListener("pointermove", move);
    document.documentElement.addEventListener("pointerleave", rest);
    return () => {
      window.removeEventListener("pointermove", move);
      document.documentElement.removeEventListener("pointerleave", rest);
    };
  }, [alive, syncing]);

  const heading = syncing ? (foundNorth ? 0 : -SWEEP / 2 + SWEEP * sync.progress) : alive ? lean.needle : undefined;
  const gauge = syncing ? (foundNorth ? SWEEP : SWEEP * sync.progress) : 0;
  const tagline = !syncing ? "Sign in with your school's Compass account." : !foundNorth ? "Syncing" : "All synced";

  return (
    <div
      onAnimationEnd={arrival.onAnimationEnd}
      data-route="login"
      className={cn("neo-login relative isolate flex min-h-dvh flex-col overflow-hidden bg-page", arrival.className)}
    >
      {/* The app's code is fetched ahead, so a successful sign-in morphs straight into it. */}
      <PrefetchPageLinks page="/" />
      <ThemeToggle className="absolute top-3 right-3 z-10" />
      <main className="neo-stage mx-auto flex w-full max-w-sm flex-1 flex-col px-5 pb-10">
        <header className="flex flex-col items-center text-center">
          <div ref={dial} className="relative" style={{ "--neo-turn": `${syncing ? 0 : lean.bezel}deg` } as CSSProperties}>
            <Bezel className="neo-bezel-draw -z-10" />
            {/* A light passing slowly across the bearings while the compass waits; the gauge takes over for the sync. */}
            <Bezel ticks className={cn("neo-bezel-sheen -z-10", syncing && "opacity-0")} />
            {/* The sync gauge: the same bearings in Neo blue, filled from the west end of the arc as the sync goes. */}
            <Bezel ticks className={cn("neo-bezel-lit -z-10", !syncing && "opacity-0")} style={{ "--neo-gauge": `${gauge}deg` } as CSSProperties} />
            <NeoMark
              size={64}
              needle={syncing || alive ? undefined : "find"}
              heading={heading}
              needleClassName={syncing && !foundNorth ? "neo-needle-tremble" : alive && !syncing ? "neo-needle-wander" : undefined}
              className="neo-vt-mark"
            />
          </div>
          <h1 className="mt-6">
            <Wordmark label="Compass Neo" className="neo-vt-word h-6 text-text-1" />
          </h1>
          <p className="neo-vt-tag mt-3 type-body-sm text-text-2">{tagline}</p>
        </header>

        {notice && (
          <Alert status="warn" className="mt-8">
            <AlertTitle>{notice}</AlertTitle>
          </Alert>
        )}

        <section ref={section} tabIndex={-1} aria-label={stepLabel(step)} className="neo-vt-step mt-8">
          {step.kind === "school" && (
            <SchoolStep focusOnMount={focusOnMount} onChoose={choose} onNeedAddress={hint => void go({ kind: "address", hint })} />
          )}
          {step.kind === "checking" && <CheckingStep slug={step.slug} onCancel={changeSchool} />}
          {step.kind === "address" && (
            <AddressStep
              focusOnMount={focusOnMount}
              hint={step.hint}
              initial={step.slug}
              initialError={step.error}
              onChoose={choose}
              onBack={changeSchool}
            />
          )}
          {step.kind === "credentials" && (
            <CredentialsStep focusOnMount={focusOnMount} school={step.school} onChangeSchool={changeSchool} onSignedIn={signedIn} />
          )}
          {step.kind === "syncing" && (
            <p ref={syncStatus} role="status" tabIndex={-1} className="sr-only">
              {tagline}
            </p>
          )}
        </section>
      </main>

      <footer className="neo-vt-foot px-5 pb-6 text-center type-caption text-text-2">
        Compass Neo keeps your login encrypted and uses it only to keep you signed in.
      </footer>
    </div>
  );
}
