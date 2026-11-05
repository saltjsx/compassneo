import { SourceMark } from "@/components/brand/source-mark";
import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Button } from "@/components/glaze/ui/button";
import {
  ArrowDownRight,
  ArrowUpRight,
  Assessments as AssessmentsGlyph,
  Calendar,
  ChevronDown,
  Document,
  Grade,
  ChevronRight,
  Icon,
  LearningTask,
  Notice,
  Pending,
  Relief,
  RoomChange,
  type GlazeIcon,
} from "@/components/glaze/icon";
import { cn } from "@/lib/glaze/utils";
import { clock, dayIn, dayName, daysApart, minutes } from "@/lib/neo/days";
import { spring } from "@/lib/neo/motion";
import { pct, rankOf, type Rank, type ClassDetail, type ClassGrades, type SemesterGrade, type Spread } from "@/lib/neo/classes";
import type { Lesson } from "@/lib/neo/timetable";
import type { LessonPlan, PlanBlock } from "@/lib/neo/plans";
import { Donut } from "@/features/timetable/donut";
import { toneText } from "./grade-history";

/**
 * The pieces of the class panel. Each block is a labelled card on its own, so a page reads top to bottom as a few plain
 * answers. The overview holds the short version of each (when the class is, the grade and its latest marks, what is
 * due, what the teacher said, the next lessons); a block with more behind it links to its own section (pages.tsx).
 */

/** A labelled card: the label sits above it, outside, so every block is plainly its own thing. */
export function Block({
  icon,
  title,
  aside,
  onMore,
  children,
  className,
  fill,
}: {
  icon: GlazeIcon;
  title: string;
  aside?: React.ReactNode;
  /** Opens the section with the whole of this. */
  onMore?: () => void;
  children: React.ReactNode;
  className?: string;
  /** The card stretches to the height its row gives it (two blocks side by side on a maximised page). */
  fill?: boolean;
}) {
  const id = `cp-${title.toLowerCase().replace(/\W+/g, "-")}`;
  return (
    <section aria-labelledby={id} className={fill ? "flex flex-col" : undefined}>
      <div className="mb-2 flex min-h-(--control-sm) items-center gap-1.5 ps-1">
        <Icon icon={icon} size={16} className="neo-section-glyph" />
        <h3 id={id} className="type-label text-text-1">
          {title}
        </h3>
        {(aside || onMore) && (
          <div className="ms-auto flex items-center">
            {aside}
            {onMore && (
              <Button variant="ghost" size="sm" onClick={onMore} className="-me-1.5">
                More
                <Icon icon={ChevronRight} size={14} />
              </Button>
            )}
          </div>
        )}
      </div>
      <div className={cn("neo-stack neo-notice", fill && "flex-1", className)}>{children}</div>
    </section>
  );
}

/** Rows inside a card, split by hairlines. */
export function Row({ children, className, dim }: { children: React.ReactNode; className?: string; dim?: boolean }) {
  return <div className={cn("border-t border-line-faint px-3.5 py-3 first:border-t-0", dim && "text-text-3", className)}>{children}</div>;
}

/** A row that opens to show more under it (an assessment's description, a notice's text). */
export function OpenRow({ head, body, dim }: { head: React.ReactNode; body: React.ReactNode | null; dim?: boolean }) {
  const [open, setOpen] = useState(false);
  if (!body) return <Row dim={dim}>{head}</Row>;
  return (
    <div className="border-t border-line-faint first:border-t-0">
      {/* eslint-disable-next-line glaze/no-native-control -- a whole list row that opens: a Glaze Button would draw a pill inside the card */}
      <button type="button" aria-expanded={open} onClick={() => setOpen(o => !o)} className="neo-row-button flex w-full items-center gap-2 px-3.5 py-3 text-start">
        <div className="min-w-0 flex-1">{head}</div>
        <motion.span animate={{ rotate: open ? 180 : 0 }} transition={spring.fold} className="inline-grid shrink-0 text-text-3">
          <Icon icon={ChevronDown} size={16} />
        </motion.span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={spring.fold} className="overflow-hidden">
            <div className="neo-pre-line px-3.5 pb-3.5 type-body-sm text-text-2">{body}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ---------- the lesson ----------

/** A lesson as both the day's cards and the class's schedule have it. */
export type PanelLesson = {
  /** The lesson's Compass instance id (its plan is kept by it). */
  id: string;
  day: string;
  start: string;
  finish: string;
  period: number | null;
  room: string | null;
  roomWas: string | null;
  teacher: Lesson["teacher"];
  teacherWas: Lesson["teacherWas"];
};

/** The one lesson that matters: the one on now, the next one, or the one on the day being looked at. Bare, it is the
 * card's content without the card (a cell in a maximised page's strip of figures). */
export function LessonCard({ lesson, next, zone, now, today, bare }: { lesson: PanelLesson; next?: boolean; zone: string; now: number; today: string; bare?: boolean }) {
  const start = Date.parse(lesson.start);
  const finish = Date.parse(lesson.finish);
  const on = start <= now && now < finish;
  const over = finish <= now;
  const day = dayName(lesson.day, today);
  const when = on
    ? `On now · ${minutes(finish - now)} left`
    : over
      ? `${day} · finished`
      : lesson.day === today && start - now < 90 * 60000
        ? `Today · starts in ${minutes(start - now)}`
        : day;
  const label = next && !on ? `Next lesson · ${when}` : when;
  return (
    <div className={cn(!bare && "neo-stack neo-notice", "px-4 py-3.5", over && "text-text-2")}>
      <div className="flex items-baseline justify-between gap-3">
        <p className={cn("type-label-sm", on ? "neo-section-glyph" : "text-text-2")}>{label}</p>
        {lesson.period != null && <p className="type-label-sm text-text-3">Period {lesson.period}</p>}
      </div>
      <p className={cn("neo-lesson-time mt-0.5", over ? "text-text-2" : "text-text-1")}>
        {clock(lesson.start, zone)} – {clock(lesson.finish, zone)}
      </p>
      {on && (
        <div className="neo-meter mt-2.5">
          <motion.div initial={{ scaleX: 0 }} animate={{ scaleX: Math.max(0.02, Math.min(1, (now - start) / (finish - start))) }} transition={spring.morph} />
        </div>
      )}
      {(lesson.roomWas || lesson.teacherWas) && (
        <div className="mt-2.5 flex flex-col gap-1 type-label-sm text-warn-text">
          {lesson.roomWas && (
            <p className="flex items-center gap-1.5">
              <Icon icon={RoomChange} size={14} /> Room moved from {lesson.roomWas} to {lesson.room}
            </p>
          )}
          {lesson.teacherWas && lesson.teacher && (
            <p className="flex items-center gap-1.5">
              <Icon icon={Relief} size={14} /> {lesson.teacher.full ?? lesson.teacher.name} is covering for {lesson.teacherWas.name}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ---------- the grade ----------

/** Up or down against the other semester, as a small coloured figure. */
function Trend({ from, to, against }: { from: number; to: number; against: number }) {
  const d = Math.round((to - from) * 10) / 10;
  if (d === 0) return <span className="shrink-0 type-label-sm text-text-2">Same as Sem {against}</span>;
  const up = d > 0;
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-0.5 type-label-sm", up ? "text-ok-text" : "text-warn-text")}>
      <Icon icon={up ? ArrowUpRight : ArrowDownRight} size={14} />
      {pct(Math.abs(d))} from Sem {against}
    </span>
  );
}

/** The grade in one line: its ring, the figure and letter, how much is marked, and the move on the other semester. */
export function GradeSummary({ g, vs }: { g: SemesterGrade; vs: SemesterGrade | null }) {
  return (
    <>
      <div className="flex items-center gap-3.5 px-4 py-3.5">
        {g.percent != null ? (
          <Donut percent={g.percent} letter={g.letter} thickness={11} className="size-11" />
        ) : (
          <span className="neo-face grid size-11 shrink-0 place-items-center rounded-pill type-label text-text-3">–</span>
        )}
        <div className="min-w-0 flex-1">
          <p className="neo-grade-big text-text-1">
            {g.percent != null ? `${pct(g.percent)}%` : "No marks yet"}
            {g.letter && <span className="ms-2 type-label text-text-2">{g.letter}</span>}
          </p>
          <p className="mt-0.5 type-label-sm text-text-2">
            {g.marked} of {g.total} marked
          </p>
        </div>
        {vs?.percent != null && g.percent != null && <Trend from={vs.percent} to={g.percent} against={vs.semester} />}
      </div>
      {g.percent != null && g.spread && <ClassRank mark={g.percent} spread={g.spread} />}
    </>
  );
}

/**
 * Where the grade sits in the class, as Connect's chart has it: which quarter of the class, and about how many it is
 * ahead of. The track is the class in four equal quarters, lowest to highest; the quarters up to the student's fill
 * in, and the dot sits at their percentile.
 */
export function ClassRank({ mark, spread }: { mark: number; spread: Spread }) {
  const r = rankOf(mark, spread);
  return (
    <div className="neo-rank border-t border-line-faint px-4 pt-3.5 pb-4" data-tone={r.tone}>
      <div className="flex items-center gap-3">
        <span className="neo-rank-badge grid size-9 shrink-0 place-items-center rounded-pill">
          <Icon icon={Grade} size={20} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="type-label text-text-1">{r.phrase}</p>
          <p className="neo-tabular mt-0.5 type-caption text-text-3">
            {r.percentile >= 100 ? "Ahead of everyone" : `Ahead of about ${r.percentile}%`} · median {pct(spread.median)}% · top {pct(spread.max)}%
          </p>
        </div>
      </div>
      <RankTrack rank={r} className="mt-3.5" />
      <div className="mt-1.5 flex justify-between type-caption text-text-3">
        <span>Lowest</span>
        <span>Highest</span>
      </div>
    </div>
  );
}

/**
 * The class as four equal quarters, lowest to highest: the quarters up to the student's fill in its tone, theirs solid,
 * and a dot at their percentile. Sits inside an element carrying the rank's tone (neo-rank, data-tone). Compact, it is
 * a slim strip for a row.
 */
export function RankTrack({ rank: r, compact, className }: { rank: Rank; compact?: boolean; className?: string }) {
  return (
    <div
      className={cn("neo-rank-track", className)}
      data-compact={compact || undefined}
      role="img"
      aria-label={`${r.phrase}: ahead of about ${r.percentile}% of the class.`}
      // eslint-disable-next-line glaze/no-inline-style -- the dot sits at the student's percentile
      style={{ "--p": `${r.percentile}%` } as React.CSSProperties}
    >
      {[0, 1, 2, 3].map(q => (
        <span key={q} className="neo-rank-quarter" data-on={q <= r.quarter || undefined} data-mine={q === r.quarter || undefined} />
      ))}
      <span className="neo-rank-dot" />
    </div>
  );
}

/** An assessment's place in its class, for its row: the chip ("Top 25%"), then the slim track beside it. */
function RankLine({ mark, spread }: { mark: number; spread: Spread }) {
  const r = rankOf(mark, spread);
  return (
    <div className="neo-rank mt-2 flex items-center gap-2.5" data-tone={r.tone}>
      <span className="neo-chip" data-tone={r.tone}>
        {r.label}
      </span>
      <RankTrack rank={r} compact className="max-w-40 flex-1" />
    </div>
  );
}

/** A mark's place in its class as a small chip: "Top 25%", "Top half". */
export function RankChip({ mark, spread, plain }: { mark: number; spread: Spread; plain?: boolean }) {
  const r = rankOf(mark, spread);
  return (
    <span className="neo-chip" data-tone={r.tone} data-plain={plain || undefined}>
      {r.label}
    </span>
  );
}

const WEEK = 7 * 86400000;

/** Assessments as rows: the name, the mark and its share of the grade, and the score in its colour. They don't open:
 * Compass's description only ever repeats the name. */
export function AssessmentRows({ tasks, semester, now }: { tasks: SemesterGrade["tasks"]; semester: number; now: number }) {
  return tasks.map((t, i) => {
    const marked = t.mark != null;
    const fresh = t.markedAt != null && now - t.markedAt < WEEK;
    const ranked = marked && t.percent != null && t.spread ? { mark: t.percent, spread: t.spread } : null;
    const detail = [t.max != null && marked ? `${t.mark}/${t.max}` : null, t.share != null ? `${pct(Math.round(t.share * 10) / 10)}% of grade` : null, t.was != null ? `was ${t.was}` : null]
      .filter(Boolean)
      .join(" · ");
    return (
      <Row key={`${semester}-${t.id ?? i}`} dim={!marked}>
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className={cn("flex items-center gap-2 type-label", marked ? "text-text-1" : "text-text-2")}>
              <span className="min-w-0 truncate">{t.name}</span>
              {fresh && <span className="neo-new shrink-0">New</span>}
            </p>
            {detail && <p className="neo-tabular mt-0.5 type-caption text-text-3">{detail}</p>}
            {ranked && <RankLine mark={ranked.mark} spread={ranked.spread} />}
          </div>
          {marked && t.percent != null ? (
            <span className={cn("neo-tabular shrink-0 type-label", toneText(t.percent))}>{pct(t.percent)}%</span>
          ) : (
            <span className="shrink-0 type-label-sm text-text-3">{marked ? t.mark : "Not marked"}</span>
          )}
        </div>
      </Row>
    );
  });
}

/** Why there is no grade to show yet, or nothing when there is one (or there are no grades: no Connect, no Canvas). */
export function GradeWaiting({ grades }: { grades: ClassGrades }) {
  if (grades.status !== "loading" && grades.status !== "unavailable") return null;
  return (
    <Block icon={AssessmentsGlyph} title="Grade" className="px-4 py-3.5">
      {grades.status === "loading" ? (
        <p role="status" className="flex items-center gap-2 type-body-sm text-text-2">
          <Icon icon={Pending} size={16} className="animate-spin text-neo-text motion-reduce:animate-none" />
          Getting your grades
        </p>
      ) : (
        <p className="type-body-sm text-text-2">{grades.reason}</p>
      )}
    </Block>
  );
}

const LATEST = 3;

/** The overview's grade: the summary and the latest few marks. Everything else is in the Grades section. */
export function GradeBlock({ g, vs, now, onMore }: { g: SemesterGrade; vs: SemesterGrade | null; now: number; onMore: () => void }) {
  const latest = g.tasks
    .map((t, i) => ({ t, i }))
    .filter(x => x.t.mark != null)
    .sort((a, b) => (b.t.markedAt ?? 0) - (a.t.markedAt ?? 0) || b.i - a.i)
    .slice(0, LATEST)
    .map(x => x.t);
  return (
    <Block icon={AssessmentsGlyph} title={`Grade · Semester ${g.semester}`} onMore={onMore}>
      <GradeSummary g={g} vs={vs} />
      {latest.length > 0 && (
        <div className="border-t border-line">
          <p className="px-3.5 pt-2.5 type-caption text-text-3">Latest marks</p>
          {/* In a box of their own, so the first row has no hairline between it and the caption. */}
          <div>
            <AssessmentRows tasks={latest} semester={g.semester} now={now} />
          </div>
        </div>
      )}
    </Block>
  );
}

// ---------- due ----------

/** Learning tasks as rows: the name and the day it is due (amber from the day before). */
export function TaskRows({ tasks, zone, today, past, full }: { tasks: ClassDetail["tasks"]; zone: string; today: string; past?: boolean; full?: boolean }) {
  return tasks.map((t, i) => {
    const due = t.due ? dayIn(zone, t.due) : null;
    const away = due ? daysApart(today, due) : null;
    return (
      <Row key={t.id ?? `${t.name}-${i}`} dim={past}>
        <div className="flex items-center gap-3">
          <span className={cn("min-w-0 flex-1 truncate type-label", past ? "text-text-2" : "text-text-1")}>{t.name}</span>
          <span className={cn("shrink-0 type-label-sm", !past && away != null && away <= 1 ? "text-warn-text" : "text-text-2")}>
            {due ? dayName(due, today) : "No date"}
          </span>
        </div>
        {full && t.due && !past && away != null && (
          <p className="neo-tabular mt-0.5 type-caption text-text-3">
            Due {clock(t.due, zone)}
            {away > 1 && ` · in ${away} days`}
          </p>
        )}
      </Row>
    );
  });
}

export function DueBlock({ tasks, zone, today, now, onMore }: { tasks: ClassDetail["tasks"]; zone: string; today: string; now: number; onMore?: () => void }) {
  const ahead = tasks.filter(t => !t.due || Date.parse(t.due) >= now);
  if (!ahead.length) return null;
  return (
    <Block icon={LearningTask} title="Due" onMore={onMore}>
      <TaskRows tasks={ahead} zone={zone} today={today} />
    </Block>
  );
}

// ---------- notices ----------

const SHOWN_NOTICES = 3;

export function NoticesBlock({ notices, zone, today }: { notices: ClassDetail["notices"]; zone: string; today: string }) {
  const [all, setAll] = useState(false);
  if (!notices.length) return null;
  const shown = all ? notices : notices.slice(0, SHOWN_NOTICES);
  // Canvas's say where they are from (and Connect's too, beside them).
  const mixed = notices.some(n => n.source === "canvas");
  return (
    <Block icon={Notice} title="Notices">
      {shown.map(n => (
        <OpenRow
          key={n.id}
          body={n.text && <Linked text={n.text} />}
          head={
            <div className="flex items-baseline gap-3">
              <span className="min-w-0 flex-1 type-label text-text-1">{n.title}</span>
              {n.at && <span className="shrink-0 type-label-sm text-text-2">{dayName(dayIn(zone, n.at), today)}</span>}
              {mixed && <SourceMark source={n.source} size={13} className="self-center" />}
            </div>
          }
        />
      ))}
      {notices.length > SHOWN_NOTICES && (
        <div className="border-t border-line-faint px-2 py-1.5">
          <Button variant="ghost" size="sm" onClick={() => setAll(a => !a)}>
            {all ? "Show fewer" : `Show ${notices.length - SHOWN_NOTICES} more`}
          </Button>
        </div>
      )}
    </Block>
  );
}

// ---------- lesson plans ----------

const URL_IN_TEXT = /(https?:\/\/[^\s<>"')\]]+)/g;

/** Text with its bare web addresses made links (a plan's, a notice's, an event's), as Compass's own view shows them. */
export function Linked({ text }: { text: string }) {
  const parts = text.split(URL_IN_TEXT);
  return parts.map((part, i) =>
    i % 2 ? (
      <a key={i} href={part} target="_blank" rel="noreferrer noopener" className="neo-link break-all">
        {part}
      </a>
    ) : (
      part
    ),
  );
}

/** A lesson plan as its teacher wrote it: paragraphs and lists, with bold, italics and links kept. */
export function PlanText({ blocks }: { blocks: PlanBlock[] }) {
  // Items next to each other make one list.
  const groups: Array<{ kind: "p" | "li"; blocks: PlanBlock[] }> = [];
  for (const b of blocks) {
    const last = groups[groups.length - 1];
    if (b.kind === "li" && last?.kind === "li") last.blocks.push(b);
    else groups.push({ kind: b.kind, blocks: [b] });
  }
  const runs = (b: PlanBlock) =>
    b.runs.map((r, i) => {
      const body = r.href ? (
        <a href={r.href} target="_blank" rel="noreferrer noopener" className="neo-link break-all">
          {r.t}
        </a>
      ) : (
        <Linked text={r.t} />
      );
      return (
        <span key={i} className={cn(r.b && "font-semibold text-text-1", r.i && "italic")}>
          {body}
        </span>
      );
    });
  return (
    <div className="neo-pre-line flex flex-col gap-2 type-body-sm text-text-2">
      {groups.map((g, i) =>
        g.kind === "li" ? (
          <ul key={i} className="flex list-disc flex-col gap-1 ps-5">
            {g.blocks.map((b, j) => (
              <li key={j}>{runs(b)}</li>
            ))}
          </ul>
        ) : (
          <p key={i}>{runs(g.blocks[0]!)}</p>
        ),
      )}
    </div>
  );
}

const PLAN_PREVIEW = 5;

/** The plan of the lesson the overview leads with. Long plans show their start, with a way to read the rest. */
export function PlanBlockCard({ plan }: { plan: LessonPlan }) {
  const [all, setAll] = useState(false);
  const long = plan.blocks.length > PLAN_PREVIEW + 1;
  return (
    <Block icon={Document} title="Lesson plan">
      <div className="px-4 py-3.5">
        <PlanText blocks={long && !all ? plan.blocks.slice(0, PLAN_PREVIEW) : plan.blocks} />
      </div>
      {long && (
        <div className="border-t border-line-faint px-2 py-1.5">
          <Button variant="ghost" size="sm" onClick={() => setAll(a => !a)}>
            {all ? "Show less" : "Show the whole plan"}
          </Button>
        </div>
      )}
    </Block>
  );
}

// ---------- lessons ----------

/** Lessons as rows: the day, the time, a relief's mark and the room. A lesson with a plan opens to show it. */
export function LessonRows({
  lessons,
  zone,
  today,
  past,
  plans,
}: {
  lessons: PanelLesson[];
  zone: string;
  today: string;
  past?: boolean;
  plans?: Record<string, LessonPlan | null | undefined>;
}) {
  return lessons.map(l => {
    const plan = plans?.[l.id];
    return (
      <OpenRow
        key={`${l.day}-${l.start}`}
        dim={past}
        body={plan ? <PlanText blocks={plan.blocks} /> : null}
        head={
          <div className="flex items-center gap-3">
            <span className={cn("w-28 shrink-0 truncate type-label", past ? "text-text-2" : "text-text-1")}>{dayName(l.day, today)}</span>
            <span className="neo-tabular min-w-0 flex-1 truncate type-label-sm text-text-2">
              {clock(l.start, zone)} – {clock(l.finish, zone)}
            </span>
            {plan && <Icon icon={Document} size={14} label="Has a lesson plan" className="neo-section-glyph shrink-0" />}
            {l.teacherWas && <Icon icon={Relief} size={14} label={`Relief for ${l.teacherWas.name}`} className="shrink-0 text-warn-text" />}
            {l.room && (
              <span className="neo-room" data-size="sm" title={l.roomWas ? `Moved from ${l.roomWas}` : undefined}>
                {l.roomWas && <Icon icon={RoomChange} size={12} label="Room changed" />}
                {l.room}
              </span>
            )}
          </div>
        }
      />
    );
  });
}

export function ComingUpBlock({
  lessons,
  zone,
  today,
  plans,
  onMore,
}: {
  lessons: PanelLesson[];
  zone: string;
  today: string;
  plans?: Record<string, LessonPlan | null | undefined>;
  onMore?: () => void;
}) {
  if (!lessons.length) return null;
  return (
    <Block icon={Calendar} title="Next lessons" onMore={onMore}>
      <LessonRows lessons={lessons} zone={zone} today={today} plans={plans} />
    </Block>
  );
}

// ---------- loading ----------

/** A block still on its way: its label and a card of rows the heights the real ones will have. */
export function SkeletonBlock({ rows }: { rows: number[] }) {
  return (
    <div aria-hidden>
      <div className="mb-2 flex min-h-(--control-sm) items-center gap-1.5 px-1">
        <span className="neo-skel size-4 rounded-pill" />
        <span className="neo-skel h-3.5 w-20" />
      </div>
      <div className="neo-stack neo-notice flex flex-col gap-3 p-4">
        {rows.map((h, i) => (
          // eslint-disable-next-line glaze/no-inline-style -- each bar is as tall as the row it stands in for
          <span key={i} className="neo-skel w-full" style={{ height: h, opacity: 1 - i * 0.15 }} />
        ))}
      </div>
    </div>
  );
}