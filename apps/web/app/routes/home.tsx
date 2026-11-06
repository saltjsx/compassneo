import { useEffect, useRef, useState } from "react";
import { Navigate, PrefetchPageLinks, useNavigate, useSearchParams } from "react-router";
import { LayoutGroup, motion, type PanInfo } from "motion/react";
import type { Route } from "./+types/home";
import { signOutNotice, useSession, useSignOut } from "@/lib/neo/session";
import { NeoMark } from "@/components/brand/logo";
import { Button } from "@/components/glaze/ui/button";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/glaze/ui/alert";
import { morphRoute } from "@/lib/neo/morph";
import { useArrival } from "@/lib/neo/arrive";
import { cn } from "@/lib/glaze/utils";
import { addDays, dayIn, daysApart, zoneOf } from "@/lib/neo/days";
import { keysOf, useDay } from "@/lib/neo/timetable";
import { useNow } from "@/lib/neo/time";
import { SyncButton } from "@/features/sync/sync-button";
import { SupportButton } from "@/features/support/support";
import { useAutoSync } from "@/lib/neo/sync";
import { Profile } from "@/features/home/profile";
import { DayView } from "@/features/timetable/day-view";
import { DayPicker } from "@/features/timetable/day-picker";
import { ClassPanel, ClassPrefetch, PlanPrefetch, type ClassTab, type Picked } from "@/features/class/class-panel";
import { ActivePanel, dayRoom, usePanelLayout } from "@/features/panel/side-panel";
import { StudentPanel, type StudentPage } from "@/features/student/student-panel";
import { StudentShortcuts } from "@/features/student/shortcuts";
import { ClassList } from "@/features/home/class-list";
import { GradesRow } from "@/features/home/grades-row";
import { TodoList } from "@/features/home/todo-list";
import { Announcements } from "@/features/home/announcements";
import { lessonOfClass, useClassList, type ListedClass } from "@/lib/neo/classlist";
import { FileViewer } from "@/features/viewer/file-viewer";
import { spring } from "@/lib/neo/motion";

/** What the support agent may open by address (see the effect in Home). */
const PAGE_NAMES: StudentPage[] = ["grades", "attendance", "events", "chronicle", "notices"];
const TAB_NAMES: ClassTab[] = ["overview", "grades", "work", "files", "lessons"];

export function meta({}: Route.MetaArgs) {
  return [{ title: "Compass Neo" }];
}

/** How far a swipe has to travel, or how fast, to turn the day. */
const SWIPE_PX = 70;
const SWIPE_SPEED = 500;

/**
 * Where a signed-in person lands: the day's classes, biggest first, under the mark, the sync gauge and their photo.
 * The dock at the foot moves a day either way and back to today; so do a swipe, the arrow keys and T. A class opens
 * in the panel at the side (features/class): on a wide screen the day moves aside for it, on a phone it covers the
 * screen. It stays open while the days turn; pressing the same class again, Escape or its close button shuts it.
 */
export default function Home() {
  const session = useSession();
  const signOut = useSignOut();
  const navigate = useNavigate();
  const token = session.token;
  const me = session.me;
  const arrival = useArrival();

  const zone = zoneOf(me?.slug ?? "");
  const now = useNow(15_000);
  const today = dayIn(zone, now);
  // null follows today (past midnight too); a day picked stays picked.
  const [picked, setPicked] = useState<string | null>(null);
  const day = picked ?? today;
  const [dir, setDir] = useState(0);
  const [openClass, setOpenClass] = useState<Picked | null>(null);
  // The class panel asks for more room for a section that wants it (resources); see dayRoom.
  const [expanded, setExpanded] = useState(false);
  // One of the student's own pages (attendance, events, Chronicle), in the same place as a class. One panel at a time.
  const [page, setPage] = useState<StudentPage | null>(null);
  const openedFrom = useRef<HTMLElement | null>(null);
  const layout = usePanelLayout();

  const shown = useDay(token, day);
  // The days either side are fetched too, so turning to them is instant.
  useDay(token, addDays(day, -1));
  useDay(token, addDays(day, 1));

  const goTo = (next: string) => {
    if (next === day) return;
    setDir(Math.sign(daysApart(day, next)));
    setPicked(next === today ? null : next);
  };
  const move = (by: -1 | 1) => goTo(addDays(day, by));
  const toToday = () => goTo(today);

  const lessons = shown.day?.lessons ?? [];
  const keys = keysOf(lessons, day);
  // The open class's lesson on the day shown: the one it was opened from, else its first lesson that day.
  const lessonOnDay = openClass ? (lessons[keys.indexOf(openClass.key)] ?? lessons.find(l => l.code === openClass.code) ?? null) : null;

  const close = () => {
    setOpenClass(null);
    setExpanded(false);
    setPage(null);
    requestAnimationFrame(() => openedFrom.current?.focus({ preventScroll: true }));
  };
  const open = (k: string, el: HTMLElement) => {
    const lesson = lessons[keys.indexOf(k)];
    if (!lesson) return;
    // The class already open, pressed again, puts the panel away.
    if (openClass?.code === lesson.code && openClass.key === k) return close();
    openedFrom.current = el;
    setPage(null);
    setOpenClass({ code: lesson.code, key: k, lesson });
  };
  // A class from the list under the day: it opens even when it is not on the day shown (then the panel leads with its
  // next lesson). Pressing the open one again puts the panel away.
  const openListed = (c: ListedClass, el: HTMLElement) => {
    if (openClass?.code === c.code) return close();
    openedFrom.current = el;
    setPage(null);
    setOpenClass({ code: c.code, key: `list:${c.code}`, lesson: lessonOfClass(c, now) });
  };
  // A class by its code, from the to-do list and the grades page: it opens on the section asked for (its work, its grades).
  // Pressing the class already open on that section puts the panel away.
  const listed = useClassList(token, day);
  const openCode = (code: string, el: HTMLElement, tab?: ClassTab) => {
    const c = listed?.find(x => x.code === code);
    if (!c) return;
    if (openClass?.code === c.code && openClass.tab === tab) return close();
    openedFrom.current = el;
    setPage(null);
    setOpenClass({ code: c.code, key: `list:${c.code}${tab ? `:${tab}` : ""}`, lesson: lessonOfClass(c, now), tab });
  };
  const openPage = (p: StudentPage) => {
    if (page === p) return close();
    openedFrom.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setOpenClass(null);
    setExpanded(false);
    setPage(p);
  };
  const panelOpen = !!openClass || !!page;

  // The support agent opens a page or a class by address (/?panel=grades, /?class=<code>&tab=work; its tools are in
  // packages/backend/convex/lib/median.ts). Each is taken once, then dropped from the address, so a reload or Back does
  // not open it again. A class waits for the class list to arrive; one not in it is let go.
  const [params, setParams] = useSearchParams();
  useEffect(() => {
    const asked = params.get("panel");
    const code = params.get("class");
    if (!asked && !code) return;
    if (code && listed === undefined) return;
    if (asked && PAGE_NAMES.includes(asked as StudentPage)) {
      if (page !== asked) openPage(asked as StudentPage);
    } else if (code) {
      const c = listed?.find(x => x.code === code);
      const tab = params.get("tab");
      const at = tab && TAB_NAMES.includes(tab as ClassTab) ? (tab as ClassTab) : undefined;
      if (c) {
        openedFrom.current = null;
        setPage(null);
        setOpenClass({ code: c.code, key: `list:${c.code}${at ? `:${at}` : ""}`, lesson: lessonOfClass(c, now), tab: at });
      }
    }
    setParams({}, { replace: true });
    // Only a new address (or the class list arriving for one) acts; the rest is read as it is then.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, listed]);

  // Keeps the account synced while the app is open (lib/neo/sync.ts). If Compass has ended the session, the server signs
  // in again with the stored login; if that login no longer works, the account is forgotten and this device lands on
  // sign-in with the reason.
  useAutoSync(token);

  // The arrow keys turn the day, T goes back to today, Escape closes the class panel. With the panel beside the day
  // (a wide screen) the keys still turn the day, unless the panel has focus; on a phone it covers the day, so they wait.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "Escape" && panelOpen) return close();
      if (document.querySelector('[aria-modal="true"]')) return;
      const t = e.target as HTMLElement | null;
      if (t?.closest("input, textarea, select, [contenteditable], [role=radiogroup], [role=tablist], [data-class-panel]")) return;
      if (e.key === "ArrowLeft") move(-1);
      else if (e.key === "ArrowRight") move(1);
      else if (e.key === "t" || e.key === "T") toToday();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // On a phone the page holds still under the panel; beside the day, both scroll on their own.
  const covering = panelOpen && !layout.wide;
  useEffect(() => {
    if (!covering) return;
    const html = document.documentElement;
    const before = html.style.overflow;
    html.style.overflow = "hidden";
    return () => {
      html.style.overflow = before;
    };
  }, [covering]);

  if (session.status === "signed-out" || !me || !token) return <Navigate to="/login" replace />;

  // Back to sign-in: the mark flies back to the login's dial while the app goes out of focus. The session is cleared
  // once the login screen is up, so nothing flashes in between.
  const leave = async (to = "/login") => {
    await morphRoute(() => navigate(to, { replace: true, flushSync: true, state: { signedOut: true } }), "login");
    await signOut();
  };
  const signInAgain = () => leave(`/login/${me.slug}`);
  const openSettings = () => void morphRoute(() => navigate("/settings", { flushSync: true }), "settings");

  const swiped = (_: unknown, info: PanInfo) => {
    if (info.offset.x < -SWIPE_PX || info.velocity.x < -SWIPE_SPEED) move(1);
    else if (info.offset.x > SWIPE_PX || info.velocity.x > SWIPE_SPEED) move(-1);
  };

  return (
    <div data-route="home" className="min-h-dvh bg-page">
      {/* The login and settings routes' code is fetched ahead, so going to either morphs without waiting on the network. */}
      <PrefetchPageLinks page="/login" />
      <PrefetchPageLinks page="/settings" />
      <LayoutGroup>
        {/* On a wide screen the day moves aside for the class panel: the page's right padding springs to the panel's
            width as it slides in, on the same spring, so the day stays centred in what is left. */}
        <motion.div initial={false} animate={{ paddingRight: dayRoom(layout, panelOpen, !!openClass && expanded) }} transition={spring.panel}>
          <header className="neo-topbar sticky top-0 z-20">
            <div className="neo-column mx-auto flex w-full items-center gap-2 px-4 neo-safe-top pb-3">
              {/* eslint-disable-next-line glaze/no-native-control -- a picture that is its own button: a Glaze Button would draw a pill around the mark or the photo */}
              <button type="button" aria-label="Compass Neo, go to today" onClick={toToday} className="rounded-pill focus-visible:focus-ring">
                <NeoMark size={26} className="neo-vt-mark" />
              </button>
              <div className="ms-auto flex items-center gap-1.5">
                <SupportButton />
                <SyncButton token={token} />
                <Profile me={me} token={token} onSettings={openSettings} onSignOut={() => void leave()} />
              </div>
            </div>
          </header>

          <main onAnimationEnd={arrival.onAnimationEnd} className={cn("neo-column mx-auto w-full px-4 pb-16", arrival.className)}>
            {me.needsSignIn && !me.connect && (
              <Alert status="neutral" announce={false} className="mb-4">
                <AlertTitle>Sign in once more to stay signed in</AlertTitle>
                <AlertDescription>This device signed in before Compass Neo kept logins, so Compass will sign it out within a day.</AlertDescription>
                <AlertAction>
                  <Button size="sm" variant="secondary" onClick={signInAgain}>
                    Sign in again
                  </Button>
                </AlertAction>
              </Alert>
            )}

            <h1 className="sr-only">Your classes</h1>
            <motion.div
              drag="x"
              dragDirectionLock
              dragConstraints={{ left: 0, right: 0 }}
              dragElastic={0.22}
              onDragEnd={swiped}
              className="touch-pan-y"
            >
              <DayView
                day={shown.day}
                loading={shown.loading}
                dayKey={day}
                now={now}
                isToday={day === today}
                zone={zone}
                dir={dir}
                selected={openClass?.code ?? null}
                onOpen={open}
                onNextDay={() => move(1)}
              />
            </motion.div>
            <DayPicker day={day} today={today} dir={dir} onMove={move} onToday={toToday} />
            <GradesRow token={token} day={day} open={page === "grades"} onOpen={() => openPage("grades")} />
            <TodoList token={token} today={today} zone={zone} now={now} selected={openClass?.code ?? null} onOpenClass={openCode} />
            <ClassList token={token} day={day} today={today} zone={zone} now={now} selected={openClass?.code ?? null} onOpen={openListed} />
            <Announcements token={token} today={today} zone={zone} now={now} open={page === "notices"} onOpen={() => openPage("notices")} />
            <StudentShortcuts token={token} open={page} onOpen={openPage} />

          </main>
        </motion.div>

        <ActivePanel.Provider value={openClass ? "class-panel" : page ? "student-panel" : null}>
        <ClassPanel
          picked={openClass}
          lessonOnDay={lessonOnDay}
          token={token}
          day={day}
          today={today}
          now={now}
          zone={zone}
          isToday={day === today}
          connect={me.connect}
          layout={layout}
          expanded={expanded}
          onExpand={setExpanded}
          onClose={close}
        />
        <StudentPanel page={page} token={token} zone={zone} now={now} today={today} layout={layout} onClose={close} onOpenClass={openCode} />
        </ActivePanel.Provider>
        {/* Files and videos from either panel open over the app, never in another tab. */}
        <FileViewer />
        {/* Every class on the day is fetched ahead, so its panel opens with everything in it. */}
        {[...new Set(lessons.map(l => l.code))].map(code => (
          <ClassPrefetch key={code} token={token} code={code} day={day} />
        ))}
        <PlanPrefetch token={token} ids={lessons.map(l => l.id)} />
      </LayoutGroup>
    </div>
  );
}
