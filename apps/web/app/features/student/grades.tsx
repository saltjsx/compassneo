import { useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Button } from "@/components/glaze/ui/button";
import { Assessments as AssessmentsGlyph, ChevronLeft, ChevronRight, Grade, Icon, Time, Warning } from "@/components/glaze/icon";
import { cn } from "@/lib/glaze/utils";
import { dayIn, dayName, shortDate } from "@/lib/neo/days";
import { spring } from "@/lib/neo/motion";
import { pct, standing, type SemesterGrade } from "@/lib/neo/classes";
import { subjectIcon } from "@/lib/neo/subjects";
import { moved, type OverviewSubject, type ReadyGrades, type RecentMark, type UpcomingAssessment } from "@/lib/neo/overview";
import type { ClassTab } from "@/features/class/class-panel";
import { GradesPage as ClassGradesPage } from "@/features/class/pages";
import { Block, RankChip } from "@/features/class/sections";
import { toneText } from "@/features/class/grade-history";
import { TrendMark } from "@/features/home/grade-rings";
import { Section } from "./parts";

/** Opens a class in the panel on a section, in place of this page. */
type OpenClass = (code: string, el: HTMLElement, tab?: ClassTab) => void;

/**
 * Grades in the side panel (convex/overview.ts), opened from the Grades row on home. Two levels and nothing that drops
 * down: the overview (every subject's ring, the subjects, the marks as they came in, what is still to be marked) and a
 * page of its own for each subject, opened from any of those, with everything about its grade. Back returns to the
 * overview; the panel's scroll starts at the top of each.
 */
export function GradesPage({
  data,
  zone,
  today,
  now,
  onOpenClass,
}: {
  data: ReadyGrades;
  zone: string;
  today: string;
  now: number;
  onOpenClass?: OpenClass;
}) {
  const [pick, setPick] = useState<string | null>(null);
  const top = useRef<HTMLDivElement>(null);
  const go = (key: string | null) => {
    setPick(key);
    requestAnimationFrame(() => top.current?.closest(".neo-st-scroll")?.scrollTo({ top: 0 }));
  };
  const subject = pick ? [...data.subjects, ...data.other].find(s => s.key === pick) ?? null : null;

  return (
    <div ref={top} className="flex flex-col">
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={subject?.key ?? "all"}
          initial={{ opacity: 0, x: subject ? 24 : -24 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, transition: { duration: 0.08 } }}
          transition={spring.focus}
          className="flex flex-col gap-5"
        >
          {subject ? (
            <SubjectPage s={subject} data={data} zone={zone} today={today} now={now} onBack={() => go(null)} onOpenClass={onOpenClass} />
          ) : (
            <Overview data={data} zone={zone} today={today} now={now} onPick={key => go(key)} />
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

// ---------- the overview ----------

function Overview({ data, zone, today, now, onPick }: { data: ReadyGrades; zone: string; today: string; now: number; onPick: (key: string) => void }) {
  const a = data.aggregate;
  return (
    <>
      {data.subjects.length > 0 && (
        <div className="flex flex-col items-center gap-2">
          <p className="neo-tabular flex items-center gap-2 text-center type-caption text-text-3">
            Semester {data.semester} · {a.marked} of {a.total} marked
            {moved(a.trend) && <TrendMark trend={a.trend} now={now} />}
          </p>
          {data.error && (
            <p className="flex items-center gap-1.5 text-center type-caption text-text-2">
              <Icon icon={Warning} size={14} className="text-warn-text" />
              {data.error}
            </p>
          )}
        </div>
      )}

      {data.subjects.length > 0 && (
        <Section icon={AssessmentsGlyph} title={`Subjects · Semester ${data.semester}`} source={data.source}>
          {data.subjects.map(s => (
            <SubjectRow key={s.key} s={s} now={now} onPick={onPick} />
          ))}
        </Section>
      )}

      <Recent marks={data.recent} since={data.historySince} zone={zone} today={today} onPick={onPick} />
      {data.upcoming.length > 0 && <Upcoming items={data.upcoming} zone={zone} today={today} onPick={onPick} />}

      {data.other.length > 0 && (
        <Section icon={AssessmentsGlyph} title={`Semester ${data.other[0]!.semester}`} source={data.source}>
          {data.other.map(s => (
            <SubjectRow key={s.key} s={s} now={now} onPick={onPick} />
          ))}
        </Section>
      )}
    </>
  );
}

/** A subject in the list: its glyph, name and latest mark, how it moved, its figure; it opens its own page. */
function SubjectRow({ s, now, onPick }: { s: OverviewSubject; now: number; onPick: (key: string) => void }) {
  const latest = s.latest ? `${s.latest.name}${s.latest.percent != null ? ` · ${pct(s.latest.percent)}%` : ""}` : s.total ? "Nothing marked yet" : "No assessments yet";
  return (
    <div data-hue={s.hue ?? undefined} className="border-t border-line-faint first:border-t-0">
      {/* eslint-disable-next-line glaze/no-native-control -- a whole list row that opens its subject's page: a Glaze Button would draw a pill inside the card */}
      <button type="button" onClick={() => onPick(s.key)} className="neo-st-row flex w-full items-center gap-3 px-3.5 py-2.5 text-start">
        <Icon icon={subjectIcon(s.subject, s.name, s.code ?? "")} size={16} className="neo-glyph shrink-0" />
        <span className="min-w-0 flex-1">
          <span className={cn("block truncate type-label", s.percent == null ? "text-text-2" : "text-text-1")}>{s.name}</span>
          <span className="neo-tabular block truncate type-caption text-text-3">{latest}</span>
        </span>
        {moved(s.trend) && <TrendMark trend={s.trend} now={now} />}
        {s.percent != null && (
          <span className="neo-tabular neo-glyph shrink-0 type-label">
            {pct(s.percent)}%{s.letter && <span className="ms-1 text-text-3">{s.letter}</span>}
          </span>
        )}
        <Icon icon={ChevronRight} size={16} className="shrink-0 text-text-3" />
      </button>
    </div>
  );
}

/**
 * Every subject's marks by the day a sync first saw them, newest first: the day once for each day's marks, then the
 * subject's glyph, the assessment, where it sits in the class and the mark. Each opens its subject. Marks from before
 * history began have no day, so they are not here.
 */
function Recent({ marks, since, zone, today, onPick }: { marks: RecentMark[]; since: number | null; zone: string; today: string; onPick: (key: string) => void }) {
  const began = since ? shortDate(dayIn(zone, since)) : null;
  if (!marks.length)
    return (
      <Section icon={Time} title="Recent marks">
        <p className="px-4 py-3.5 type-body-sm text-text-2">
          {began
            ? `New marks show up here with the day they came in. Compass Neo has kept track since ${began}.`
            : "New marks show up here with the day they came in, from the next sync."}
        </p>
      </Section>
    );
  return (
    <Section icon={Time} title="Recent marks">
      {marks.map((m, i) => {
        const day = dayName(dayIn(zone, m.markedAt), today);
        const first = i === 0 || dayName(dayIn(zone, marks[i - 1]!.markedAt), today) !== day;
        return (
          <div key={m.key} data-hue={m.hue ?? undefined} className={cn(first && i > 0 && "border-t border-line-faint")}>
            {/* eslint-disable-next-line glaze/no-native-control -- a whole list row that opens its subject's page: a Glaze Button would draw a pill inside the card */}
            <button type="button" onClick={() => onPick(m.subject)} className="neo-st-row flex w-full items-center gap-3 px-3.5 py-2 text-start">
              <span className={cn("w-16 shrink-0 truncate type-label-sm", first ? "text-text-2" : "invisible")}>{day}</span>
              <Icon icon={subjectIcon(m.name, m.name, m.code ?? "")} size={14} className="neo-glyph shrink-0" />
              <span className="min-w-0 flex-1">
                <span className="block truncate type-label-sm text-text-1">{m.task}</span>
                <span className="neo-tabular block truncate type-caption text-text-3">
                  {[m.name, m.share != null && `${pct(m.share)}% of grade`, m.was != null && `was ${m.was}`].filter(Boolean).join(" · ")}
                </span>
              </span>
              {m.percent != null && m.spread && <RankChip mark={m.percent} spread={m.spread} plain />}
              <span className={cn("neo-tabular w-14 shrink-0 text-end type-label-sm", m.percent != null ? toneText(m.percent) : "text-text-2")}>
                {m.percent != null ? `${pct(m.percent)}%` : (m.mark ?? "–")}
              </span>
            </button>
          </div>
        );
      })}
    </Section>
  );
}

/**
 * What still counts towards this semester and has no mark: the work still to hand in first, soonest due first, then
 * work handed in and waiting for its mark. Each with its subject, its share of the grade and when it is due; each opens
 * its subject (onPick), or, on a subject's own page, is only a row.
 */
function Upcoming({ items, zone, today, onPick, title = "Still to be marked" }: { items: UpcomingAssessment[]; zone: string; today: string; onPick?: (key: string) => void; title?: string }) {
  return (
    <Section icon={AssessmentsGlyph} title={title}>
      {items.map(u => {
        const body = (
          <>
            <Icon icon={subjectIcon(u.name, u.name, u.code ?? "")} size={14} className="neo-glyph shrink-0" />
            <span className="min-w-0 flex-1">
              <span className="block truncate type-label-sm text-text-1">{u.task}</span>
              <span className="neo-tabular block truncate type-caption text-text-3">
                {[onPick && u.name, u.share != null && `${pct(u.share)}% of grade`].filter(Boolean).join(" · ")}
              </span>
            </span>
            {u.handedIn ? (
              <span className="neo-chip shrink-0" data-tone="ok">
                Handed in
              </span>
            ) : u.due ? (
              <span className="neo-tabular shrink-0 type-caption text-text-2">Due {dayName(dayIn(zone, u.due), today)}</span>
            ) : null}
          </>
        );
        return (
          <div key={u.key} data-hue={u.hue ?? undefined} className="border-t border-line-faint first:border-t-0">
            {onPick ? (
              // eslint-disable-next-line glaze/no-native-control -- a whole list row that opens its subject's page: a Glaze Button would draw a pill inside the card
              <button type="button" onClick={() => onPick(u.subject)} className="neo-st-row flex w-full items-center gap-3 px-3.5 py-2.5 text-start">
                {body}
              </button>
            ) : (
              <div className="flex items-center gap-3 px-3.5 py-2.5">{body}</div>
            )}
          </div>
        );
      })}
    </Section>
  );
}

// ---------- a subject's own page ----------

/**
 * Everything about one subject's grade, in its colour: what it is and the way into its class, what the student needs
 * on what is left to finish on each band, then the class panel's own grade sections (the grade and how it compares,
 * the grade as it built up, where it could finish, the semesters side by side, every assessment, what changed), then
 * what is still to come in it.
 */
function SubjectPage({
  s,
  data,
  zone,
  today,
  now,
  onBack,
  onOpenClass,
}: {
  s: OverviewSubject;
  data: ReadyGrades;
  zone: string;
  today: string;
  now: number;
  onBack: () => void;
  onOpenClass?: OpenClass;
}) {
  // The same subject in the other semester: the same class, else the same name.
  const pool = s.semester === data.semester ? data.other : data.subjects;
  const twin = pool.find(o => !!s.code && o.code === s.code) ?? pool.find(o => o.subject === s.subject) ?? null;
  const [current, other] = s.semester === data.semester ? [s, twin] : [twin ?? s, twin ? s : null];
  const [sem, setSem] = useState<number>(s.semester);
  const shown = [current, other].find(g => g?.semester === sem) ?? s;
  const coming = data.upcoming.filter(u => u.subject === shown.key);

  return (
    <div data-hue={s.hue ?? undefined} className="flex flex-col gap-5">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" className="-ms-2.5" onClick={onBack}>
          <Icon icon={ChevronLeft} size={16} />
          All grades
        </Button>
        {s.code && onOpenClass && (
          <Button variant="secondary" size="sm" className="ms-auto" onClick={e => onOpenClass(s.code!, e.currentTarget, "grades")}>
            Open {s.name}
          </Button>
        )}
      </div>
      <div className="flex items-center gap-2.5 ps-1">
        <Icon icon={subjectIcon(s.subject, s.name, s.code ?? "")} size={20} className="neo-glyph" />
        <h3 className="neo-st-title min-w-0 truncate text-text-1">{s.name}</h3>
        {moved(shown.trend) && <TrendMark trend={shown.trend} now={now} className="ms-auto" />}
      </div>

      <WhatYouNeed g={shown} />
      <ClassGradesPage current={current as SemesterGrade | null} other={other as SemesterGrade | null} sem={sem} onSem={setSem} since={data.historySince} zone={zone} today={today} now={now} />
      {coming.length > 0 && <Upcoming items={coming} zone={zone} today={today} title="Still to come" />}
    </div>
  );
}

/** The bands a finish is aimed at, as the grade rings colour them. */
const TARGETS = [80, 65, 50];

/**
 * What it takes from here: for each band, the average needed on everything not marked yet to finish on it (the
 * weighted marks so far and what is left, from the outline's weightings). Already there whatever happens, or out of
 * reach even with full marks, it says so. Shown while something is still to be marked and every weighting is known.
 */
function WhatYouNeed({ g }: { g: OverviewSubject }) {
  const st = standing(g);
  if (!st || st.left <= 0.5) return null;
  const rows = TARGETS.map(target => {
    const need = ((target / 100) * st.total - st.earned) / st.left;
    return { target, need: need * 100 };
  });
  return (
    <Block icon={Grade} title="What you need">
      {rows.map(({ target, need }) => (
        <div key={target} className="flex items-center gap-3 border-t border-line-faint px-3.5 py-2.5 first:border-t-0">
          <span className="min-w-0 flex-1 type-label text-text-2">
            To finish on <span className={cn("neo-tabular", toneText(target))}>{target}%</span>
          </span>
          {need <= 0 ? (
            <span className="neo-chip shrink-0" data-tone="ok">
              Locked in
            </span>
          ) : need > 100 ? (
            <span className="shrink-0 type-label-sm text-text-3">Out of reach</span>
          ) : (
            <span className="neo-tabular shrink-0 type-label text-text-1">
              <span className={toneText(need)}>{pct(need)}%</span> <span className="type-caption text-text-3">on the rest</span>
            </span>
          )}
        </div>
      ))}
      <p className="border-t border-line-faint px-3.5 py-2.5 type-caption text-text-3">
        <span className="neo-tabular">{pct((100 * st.left) / st.total)}%</span> of the grade is still to be marked.
      </p>
    </Block>
  );
}

