import { useEffect, useRef } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Button } from "@/components/glaze/ui/button";
import { Close, Icon, Pending, Sync } from "@/components/glaze/icon";
import { cn } from "@/lib/glaze/utils";
import { spring } from "@/lib/neo/motion";
import { ago } from "@/lib/neo/time";
import { useAttendance, useChronicle, useEvents } from "@/lib/neo/student";
import { useAnnouncements } from "@/lib/neo/announcements";
import { useOverviewGrades } from "@/lib/neo/overview";
import { useChecked, useSyncRefresh } from "@/lib/neo/sync";
import type { ClassTab } from "@/features/class/class-panel";
import { SidePanel, type PanelLayout } from "@/features/panel/side-panel";
import { AttendancePage } from "./attendance";
import { ChroniclePage } from "./chronicle";
import { EventsPage } from "./events";
import { NoticesPage } from "./notices";
import { GradesPage } from "./grades";
import { PAGES, pageHue, type StudentPage } from "./meta";
import { Notice, SkeletonSection } from "./parts";

export type { StudentPage } from "./meta";

type Props = {
  page: StudentPage | null;
  token: string;
  zone: string;
  now: number;
  today: string;
  layout: PanelLayout;
  onClose: () => void;
  /** Opens a class in the panel on a section, in this page's place (a subject on the grades page). */
  onOpenClass?: (code: string, el: HTMLElement, tab?: ClassTab) => void;
};

/**
 * The student's own pages in the side panel, the same panel a class opens in (one at a time): Attendance, Events,
 * Chronicle, Notices and Grades. Notices and grades have no fetch of their own (the sync brings them), so their refresh
 * runs a sync, as "Sync now" does; grades are today's semester's. Each has a header like a class's (its glyph and name over a wash of its colour, when it was last
 * fetched, refresh and close) and one scroll of labelled sections, each shown only when it has something. Another
 * page opened while one is up comes into focus in its place.
 */
export function StudentPanel(props: Props) {
  const { page, token, layout, onClose } = props;
  const attendance = useAttendance(token);
  const events = useEvents(token);
  const chronicle = useChronicle(token);
  const noticesData = useAnnouncements(token);
  const notices = { data: noticesData, ...useSyncRefresh(token, noticesData?.fetchedAt, STEPS.notices) };
  const gradesData = useOverviewGrades(token, props.today);
  const grades = { data: gradesData, ...useSyncRefresh(token, gradesData?.status === "ready" ? gradesData.fetchedAt : undefined, STEPS.grades) };
  const hue = page ? pageHue(page, attendance.data?.compass?.overall.percent) : undefined;
  return (
    <SidePanel open={!!page} name="student-panel" layout={layout} hue={hue} labelledBy="student-panel-title" onClose={onClose}>
      {page && <Body {...props} page={page} attendance={attendance} events={events} chronicle={chronicle} notices={notices} grades={grades} />}
    </SidePanel>
  );
}

type Queries = {
  attendance: ReturnType<typeof useAttendance>;
  events: ReturnType<typeof useEvents>;
  chronicle: ReturnType<typeof useChronicle>;
  notices: { data: ReturnType<typeof useAnnouncements> } & ReturnType<typeof useSyncRefresh>;
  grades: { data: ReturnType<typeof useOverviewGrades> } & ReturnType<typeof useSyncRefresh>;
};

/** The sync's steps that bring each page (server: sync.ts), for when it was last checked (useChecked). */
const STEPS: Record<StudentPage, string[]> = {
  attendance: ["compass:attendance", "connect:attendance"],
  events: ["compass:events"],
  chronicle: ["compass:chronicle"],
  notices: ["compass:news"],
  grades: ["connect:grades", "canvas:grades"],
};

function Body({ page, token, zone, now, today, onClose, onOpenClass, attendance, events, chronicle, notices, grades }: Props & Queries & { page: StudentPage }) {
  const close = useRef<HTMLButtonElement>(null);
  // Focus lands in the panel when it opens, so a keyboard or screen reader carries on from there.
  useEffect(() => close.current?.focus({ preventScroll: true }), []);

  const p = PAGES[page];
  const q = { attendance, events, chronicle, notices, grades }[page];
  const refresh = () => {
    if (!q.refreshing) void q.refresh();
  };

  const a = attendance.data;
  const rowAt =
    page === "attendance"
      ? (a?.compass?.fetchedAt ?? (a?.connect && "fetchedAt" in a.connect ? a.connect.fetchedAt : undefined))
      : page === "events"
        ? events.data?.fetchedAt
        : page === "notices"
          ? notices.data?.fetchedAt
          : page === "grades"
            ? grades.data?.status === "ready"
              ? grades.data.fetchedAt
              : undefined
            : chronicle.data?.fetchedAt;
  const fetchedAt = useChecked(token, rowAt, STEPS[page]);
  const status = q.refreshing ? "Getting the latest" :fetchedAt ? `Updated ${ago(fetchedAt, now)}` : q.data === null ? "Not synced yet" : "";

  const notYet = (
    <Notice
      icon={p.icon}
      title={`No ${p.what} yet`}
      body="It comes in with the next sync."
      action={
        <Button size="sm" variant="secondary" pending={q.refreshing} onClick={refresh}>
          Get {p.what} now
        </Button>
      }
    />
  );

  const content = (() => {
    switch (page) {
      case "attendance": {
        const d = attendance.data;
        if (d === undefined) return <Loading rows={[[56, 36], [40, 40, 40, 40], [36, 36]]} />;
        if (!d || (!d.compass && !d.connect)) return notYet;
        return <AttendancePage data={d} />;
      }
      case "events": {
        const d = events.data;
        if (d === undefined) return <Loading rows={[[40, 40], [36, 36, 36, 36]]} />;
        if (!d) return notYet;
        return <EventsPage data={d} chronicle={chronicle.data} zone={zone} today={today} now={now} />;
      }
      case "chronicle": {
        const d = chronicle.data;
        if (d === undefined) return <Loading rows={[[40, 40, 40], [36, 36]]} />;
        if (!d) return notYet;
        return <ChroniclePage data={d} events={events.data} zone={zone} today={today} />;
      }
      case "notices": {
        const d = notices.data;
        if (d === undefined) return <Loading rows={[[56, 36], [40, 40, 40]]} />;
        if (!d || (!d.notices.length && !d.assemblies.length)) return notYet;
        return <NoticesPage data={d} today={today} zone={zone} now={now} />;
      }
      case "grades": {
        const d = grades.data;
        if (d === undefined) return <Loading rows={[[56, 36], [40, 40, 40], [36, 36, 36, 36]]} />;
        if (!d || d.status === "loading") return notYet;
        if (d.status === "none") return <Notice icon={p.icon} title="No grades at this school" body="Grades come from Connect, which only WA public schools have." />;
        if (d.status === "unavailable") return <Notice icon={p.icon} title="Connect did not give grades" body={d.reason} />;
        if (!d.subjects.length && !d.other.length) return <Notice icon={p.icon} title="No grades yet" body="Connect has no assessment outlines for you yet." />;
        return <GradesPage data={d} zone={zone} today={today} now={now} onOpenClass={onOpenClass} />;
      }
    }
  })();

  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={page}
        initial={{ opacity: 0, filter: "blur(6px)" }}
        animate={{ opacity: 1, filter: "blur(0px)" }}
        exit={{ opacity: 0, filter: "blur(6px)", transition: { duration: 0.1 } }}
        transition={spring.focus}
        className="flex min-h-0 flex-1 flex-col"
      >
        <header className="neo-st-top relative shrink-0 px-4 pt-4 pb-3.5">
          <div className="flex min-w-0 items-center gap-2.5 pe-20">
            <Icon icon={p.icon} size={20} className="neo-glyph" />
            <h2 id="student-panel-title" className="neo-st-title min-w-0 truncate text-text-1">
              {p.title}
            </h2>
          </div>
          <p className="mt-1 min-h-4 truncate ps-7.5 type-label-sm text-text-2">
            {status}
          </p>
          <div className="absolute end-2.5 top-2.5 flex items-center gap-0.5">
            <Button variant="ghost" size="icon" aria-label={`Refresh ${p.what}`} aria-busy={q.refreshing || undefined} onClick={refresh}>
              {/* While it refreshes, the sync glyph gives way to the pending arc: the glyph's arrowheads wobble when turned. */}
              <Icon icon={q.refreshing ? Pending : Sync} size={16} className={cn(q.refreshing && "animate-spin motion-reduce:animate-none")} />
            </Button>
            <Button ref={close} variant="ghost" size="icon" aria-label={`Close ${p.what}`} onClick={onClose}>
              <Icon icon={Close} size={20} />
            </Button>
          </div>
        </header>

        <div aria-busy={q.data === undefined || undefined} className="neo-st-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain">
          <div className="flex flex-col gap-5 px-4 pt-4 pb-10">{content}</div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}

function Loading({ rows }: { rows: number[][] }) {
  return rows.map((r, i) => <SkeletonSection key={i} rows={r} />);
}
