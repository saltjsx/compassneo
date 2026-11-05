import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { Alert, AlertDescription, AlertTitle } from "@/components/glaze/ui/alert";
import { Button } from "@/components/glaze/ui/button";
import { Input } from "@/components/glaze/ui/input";
import {
  Attachment,
  ChevronLeft,
  ChevronRight,
  Document,
  External,
  Failed,
  Grade,
  Icon,
  Information,
  LearningTask,
  Locked,
  Pending,
  Success,
  Time,
  Upload,
  Waiting,
  Warning,
  type GlazeIcon,
} from "@/components/glaze/icon";
import { cn } from "@/lib/glaze/utils";
import { dayIn, dayName, daysApart, lastLessonLong, longDay } from "@/lib/neo/days";
import { spring } from "@/lib/neo/motion";
import { MAX_UPLOAD, useHandIn, type ClassWork, type WorkFile, type WorkItem, type WorkSlot } from "@/lib/neo/work";
import { Block, ClassRank, PlanText, RankChip, SkeletonBlock } from "./sections";
import { toneText } from "./grade-history";
import { assessmentFor, pct, type Assessment } from "@/lib/neo/classes";
import { SourceMark } from "@/components/brand/source-mark";
import { FileRow, FoldBlock, KindGlyph, SOURCE, SideNotes, fileKind, hostOf, linkKind, sizeText } from "./kit";

/**
 * Work: Compass's learning tasks and Connect's submissions as one list, grouped by what they need (to do, overdue,
 * handed in, earlier), each opening to its whole: the teacher's instructions and attachments, what was handed in, and a
 * place to hand work in. Handing in writes to the school's system, so it always asks first, naming the file and where
 * it goes, then shows it going and lands on a plain "Handed in".
 */

type WorkState = WorkItem["state"];

/** The state to show: a task still to do whose due date has passed is overdue, whatever the last fetch said. */
export const stateOf = (w: WorkItem, now: number): WorkState => (w.state === "todo" && w.due && Date.parse(w.due) < now ? "overdue" : w.state);

const CHIP: Record<WorkState | "sending", { label: string; icon: GlazeIcon; tone: string }> = {
  todo: { label: "To do", icon: Waiting, tone: "todo" },
  overdue: { label: "Overdue", icon: Failed, tone: "fail" },
  submitted: { label: "Handed in", icon: Success, tone: "ok" },
  late: { label: "Handed in late", icon: Success, tone: "warn" },
  closed: { label: "Closed", icon: Locked, tone: "muted" },
  none: { label: "No hand-in", icon: Information, tone: "muted" },
  sending: { label: "Handing in", icon: Pending, tone: "todo" },
};

/** Where a piece of work stands, as a glyph and a word on its colour. Plain, the glyph and the word in its colour alone
 * (a maximised page's list and detail). */
export function StateChip({ state, title, plain }: { state: WorkState | "sending"; title?: string | null; plain?: boolean }) {
  const c = CHIP[state];
  return (
    <span className="neo-chip" data-tone={c.tone} data-plain={plain || undefined} title={title ?? undefined}>
      <Icon icon={c.icon} size={12} className={state === "sending" ? "animate-spin motion-reduce:animate-none" : undefined} />
      {c.label}
    </span>
  );
}

// ---------- when ----------

const timeFormat = new Map<string, Intl.DateTimeFormat>();
/** "11:30 pm". */
function timeOf(iso: string, zone: string) {
  let f = timeFormat.get(zone);
  if (!f) timeFormat.set(zone, (f = new Intl.DateTimeFormat("en-AU", { timeZone: zone, hour: "numeric", minute: "2-digit", hour12: true })));
  return f.format(new Date(iso)).toLowerCase();
}

/** "Due Friday", "Was due Mon 10 Nov", "No due date". */
function dueShort(due: string | null, zone: string, today: string, now: number) {
  if (!due) return "No due date";
  const day = dayIn(zone, due);
  return `${Date.parse(due) < now ? "Was due" : "Due"} ${dayName(day, today)}${day === today ? `, ${timeOf(due, zone)}` : ""}`;
}

/** "Due Friday 18 September at 11:30 pm, in 3 days". */
function dueLong(due: string | null, zone: string, today: string, now: number) {
  if (!due) return "No due date";
  const day = dayIn(zone, due);
  const away = daysApart(today, day);
  const when = away === 0 ? "today" : away === 1 ? "tomorrow" : away === -1 ? "yesterday" : longDay(day);
  const rel = away > 1 && away < 15 ? `, in ${away} days` : away < -1 && away > -15 ? `, ${-away} days ago` : "";
  return `${Date.parse(due) < now ? "Was due" : "Due"} ${when} at ${timeOf(due, zone)}${rel}`;
}

const latest = (files: WorkFile[]) =>
  files.reduce<string | null>((a, f) => (f.at && (!a || Date.parse(f.at) > Date.parse(a)) ? f.at : a), null);

// ---------- handing in ----------

export type HandInPick = { kind: "file"; file: File } | { kind: "link"; url: string };
type Flow = { slotId: number; pick: HandInPick } & ({ phase: "confirm" } | { phase: "sending" } | { phase: "done" } | { phase: "failed"; message: string });

/**
 * Each piece of work's hand-in, kept above the list and the detail (class-panel.tsx holds it), so going back to the list
 * or to another section while a file is on its way never loses where it got to.
 */
export function useWorkFlows(token: string, code: string) {
  const { handIn } = useHandIn(token, code);
  const [flows, setFlows] = useState<Record<string, Flow>>({});
  const set = useCallback(
    (key: string, flow: Flow | null) =>
      setFlows(m => {
        const next = { ...m };
        if (flow) next[key] = flow;
        else delete next[key];
        return next;
      }),
    [],
  );
  const send = useCallback(
    async (item: WorkItem, slotId: number, pick: HandInPick) => {
      set(item.key, { phase: "sending", slotId, pick });
      const r = await handIn(item, slotId, pick.kind === "file" ? { file: pick.file } : { url: pick.url.trim() });
      set(item.key, r.ok ? { phase: "done", slotId, pick } : { phase: "failed", slotId, pick, message: r.message });
    },
    [handIn, set],
  );
  const sending = Object.values(flows).some(f => f.phase === "sending");
  return { flows, set, send, sending };
}
export type WorkFlows = ReturnType<typeof useWorkFlows>;

// ---------- the list ----------

const readyItems = (side: ClassWork["compass"]) => (side.status === "ready" ? side.data : []);

/** Every piece of work from every side, and whether more than one has some (so each says where it is from). */
export function workItems(work: ClassWork | null | undefined) {
  if (!work) return { items: [] as WorkItem[], both: false };
  const sides = [readyItems(work.compass), readyItems(work.connect), readyItems(work.canvas)];
  return { items: sides.flat(), both: sides.filter(s => s.length > 0).length > 1 };
}

export function groupWork(items: WorkItem[], now: number) {
  const todo: WorkItem[] = [];
  const overdue: WorkItem[] = [];
  const done: WorkItem[] = [];
  const earlier: WorkItem[] = [];
  for (const w of items) {
    const s = stateOf(w, now);
    if (s === "overdue") overdue.push(w);
    else if (s === "submitted" || s === "late") done.push(w);
    else if (s === "todo" || (s === "none" && w.due && Date.parse(w.due) >= now)) todo.push(w);
    else earlier.push(w);
  }
  const at = (d: string | null, none: number) => (d ? Date.parse(d) : none);
  todo.sort((a, b) => at(a.due, Infinity) - at(b.due, Infinity));
  overdue.sort((a, b) => at(b.due, 0) - at(a.due, 0));
  done.sort((a, b) => at(latest(b.handedIn) ?? b.due, 0) - at(latest(a.handedIn) ?? a.due, 0));
  earlier.sort((a, b) => at(b.due, 0) - at(a.due, 0));
  return { todo, overdue, done, earlier };
}

function WorkRow({
  item,
  both,
  flow,
  zone,
  today,
  now,
  onOpen,
  assessments,
  selected,
  plain,
}: {
  item: WorkItem;
  both: boolean;
  flow: Flow | undefined;
  zone: string;
  today: string;
  now: number;
  onOpen: () => void;
  assessments: Assessment[];
  /** The one open beside the list (a maximised page): pressed in. */
  selected?: boolean;
  /** States as a glyph and a word, without their tint (a maximised page). */
  plain?: boolean;
}) {
  const graded = assessmentFor(item.name, assessments);
  const s = stateOf(item, now);
  const handed = (s === "submitted" || s === "late") && item.handedIn.length > 0;
  const at = handed ? latest(item.handedIn) : null;
  const meta = [
    handed ? (at ? `Handed in ${dayName(dayIn(zone, at), today)}` : `${item.handedIn.length} handed in`) : dueShort(item.due, zone, today, now),
    item.result && `Result ${item.result}`,
    item.feedback && "Feedback",
  ]
    .filter(Boolean)
    .join(" · ");
  const soon = s === "todo" && item.due != null && daysApart(today, dayIn(zone, item.due)) <= 1;
  return (
    <div className="border-t border-line-faint first:border-t-0">
      {/* eslint-disable-next-line glaze/no-native-control -- a whole list row that opens the work: a Glaze Button would draw a pill inside the card */}
      <button
        type="button"
        onClick={onOpen}
        aria-current={selected || undefined}
        data-on={selected || undefined}
        className="neo-row-button flex w-full min-w-0 items-center gap-3 px-3.5 py-2.5 text-start"
      >
        <div className="min-w-0 flex-1">
          <p className="truncate type-label text-text-1">{item.name}</p>
          <p className={cn("flex min-w-0 items-center gap-1.5 type-caption", soon ? "text-warn-text" : "text-text-3")}>
            <span className="min-w-0 truncate">{meta}</span>
            {both && <SourceMark source={item.source} size={13} />}
          </p>
          {graded && (
            <p className="neo-tabular mt-1 flex items-center gap-2 type-caption text-text-3">
              <span className={toneText(graded.percent)}>{pct(graded.percent)}%</span>
              <RankChip mark={graded.percent} spread={graded.spread} plain={plain} />
            </p>
          )}
        </div>
        <StateChip state={flow?.phase === "sending" ? "sending" : s} title={item.stateText} plain={plain} />
        {!plain && <Icon icon={ChevronRight} size={16} className="text-text-3" />}
      </button>
    </div>
  );
}

export function WorkPage({
  work,
  flows,
  zone,
  today,
  now,
  onOpen,
  assessments = [],
  selected,
  wide,
}: {
  work: ClassWork | null | undefined;
  flows: WorkFlows;
  zone: string;
  today: string;
  now: number;
  onOpen: (key: string) => void;
  /** The class's assessments from Connect, both semesters: a marked one shows its mark and rank on its work. */
  assessments?: Assessment[];
  /** Maximised, the list sits beside the one open (selected), whose row is pressed in. */
  selected?: string | null;
  wide?: boolean;
}) {
  const [doneOpen, setDoneOpen] = useState<boolean | null>(null);
  const [earlierOpen, setEarlierOpen] = useState(false);
  if (work === undefined) return <SkeletonBlock rows={[40, 40, 40, 40]} />;
  if (!work) return null;
  const { items, both } = workItems(work);
  const g = groupWork(items, now);
  const rows = (list: WorkItem[]) =>
    list.map(w => (
      <WorkRow
        key={w.key}
        item={w}
        both={both}
        flow={flows.flows[w.key]}
        zone={zone}
        today={today}
        now={now}
        onOpen={() => onOpen(w.key)}
        assessments={assessments}
        selected={wide && w.key === selected}
        plain={wide}
      />
    ));
  // A side still on its way may have work in it: no "nothing set" until every side is in.
  const waiting = work.compass.status === "missing" || work.connect.status === "missing" || work.canvas.status === "missing";
  const clear = !g.todo.length && !g.overdue.length;

  if (!items.length && waiting) return <SkeletonBlock rows={[40, 40, 40, 40]} />;
  return (
    <>
      {g.todo.length > 0 && (
        <Block icon={LearningTask} title="To do">
          {rows(g.todo)}
        </Block>
      )}
      {g.overdue.length > 0 && (
        <Block icon={Warning} title="Overdue">
          {rows(g.overdue)}
        </Block>
      )}
      {clear && items.length > 0 && (
        <div className="neo-stack neo-notice flex items-center gap-3 px-4 py-3.5">
          <Icon icon={Success} size={20} className="text-ok-text" />
          <p className="type-label text-text-1">{g.done.length ? "Nothing to do. Everything is handed in." : "Nothing to do right now."}</p>
        </div>
      )}
      {g.done.length > 0 && (
        <FoldBlock icon={Success} title="Handed in" count={g.done.length} open={doneOpen ?? clear} onToggle={() => setDoneOpen(!(doneOpen ?? clear))}>
          {rows(g.done)}
        </FoldBlock>
      )}
      {g.earlier.length > 0 && (
        <FoldBlock icon={Time} title="Earlier" count={g.earlier.length} open={earlierOpen} onToggle={() => setEarlierOpen(o => !o)}>
          {rows(g.earlier)}
        </FoldBlock>
      )}
      {!items.length && !waiting && (
        <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
          <Icon icon={LearningTask} size={32} className="text-text-3" />
          <p className="type-label text-text-2">Nothing set for this class</p>
        </div>
      )}
      <SideNotes
        sides={[
          ["compass", work.compass],
          ["connect", work.connect],
          ["canvas", work.canvas],
        ]}
        what={{ compass: "learning tasks", connect: "submissions", canvas: "assignments" }}
        now={now}
      />
    </>
  );
}

// ---------- one piece of work ----------

function fileRowKind(f: WorkFile) {
  return f.external ? linkKind(f.href) : fileKind(f.name);
}

export function WorkDetail({
  item,
  flows,
  zone,
  today,
  now,
  onBack,
  assessments = [],
  wide,
}: {
  item: WorkItem;
  flows: WorkFlows;
  zone: string;
  today: string;
  now: number;
  /** Back to the list; none when the list is beside it (wide). */
  onBack?: () => void;
  assessments?: Assessment[];
  /** Maximised, beside the list: what the teacher set on the left, the mark and handing in on the right. */
  wide?: boolean;
}) {
  const flow = flows.flows[item.key];
  const graded = assessmentFor(item.name, assessments);
  const s = flow?.phase === "sending" ? "sending" : stateOf(item, now);
  const last = (s === "todo" || s === "none") && lastLessonLong(item.lastLesson, today, zone);

  const head = (
    <div className="flex min-w-0 flex-col gap-2.5">
      {onBack && (
        <div>
          <Button variant="ghost" size="sm" onClick={onBack} className="-ms-2">
            <Icon icon={ChevronLeft} />
            All work
          </Button>
        </div>
      )}
      <h3 className="neo-work-title px-1 text-text-1">{item.name}</h3>
      <div className="flex min-w-0 items-center gap-2 px-1">
        <StateChip state={s} title={item.stateText} plain={wide} />
        <SourceMark source={item.source} size={16} />
        <span className="min-w-0 truncate type-label-sm text-text-2">{dueLong(item.due, zone, today, now)}</span>
      </div>
      {last && (
        <p className="flex min-w-0 items-center gap-2 px-1 type-caption text-text-3">
          <Icon icon={Time} size={14} className="shrink-0" />
          <span className="min-w-0 truncate">{last}</span>
        </p>
      )}
    </div>
  );

  const marked = graded && (
    <Block key="marked" icon={Grade} title="Marked">
      <div className="flex items-center gap-3.5 px-4 py-3.5">
        <div className="min-w-0 flex-1">
          <p className={cn("neo-grade-big", toneText(graded.percent))}>{pct(graded.percent)}%</p>
          <p className="neo-tabular mt-0.5 type-label-sm text-text-2">
            {graded.mark}/{graded.max}
            {graded.share != null && ` · ${pct(Math.round(graded.share * 10) / 10)}% of grade`}
          </p>
        </div>
      </div>
      <ClassRank mark={graded.percent} spread={graded.spread} />
    </Block>
  );

  const teacher = (item.result || item.feedback) && (
    <Block key="teacher" icon={Grade} title="From your teacher">
      {item.result && (
        <div className="flex items-center gap-3 border-t border-line-faint px-3.5 py-3 first:border-t-0">
          <span className="min-w-0 flex-1 type-label-sm text-text-2">Result</span>
          <span className="neo-tabular shrink-0 type-label text-text-1">{item.result}</span>
        </div>
      )}
      {item.feedback && (
        <p className="border-t border-line-faint px-3.5 py-3 type-body-sm text-text-2 first:border-t-0">
          Your teacher left feedback on this. It is on {SOURCE[item.source]}.
        </p>
      )}
    </Block>
  );

  const instructions = item.instructions.length > 0 && (
    <Block key="instructions" icon={Document} title="Instructions" className="px-4 py-3.5">
      <PlanText blocks={item.instructions} />
    </Block>
  );

  const attachments = item.attachments.length > 0 && (
    <Block key="attachments" icon={Attachment} title="Attachments">
      {item.attachments.map((f, i) => {
        const kind = fileRowKind(f);
        return (
          <FileRow
            key={`${f.name}-${i}`}
            name={f.name}
            href={f.href}
            external={f.external}
            source={item.source}
            kind={kind}
            meta={f.external ? (hostOf(f.href) ?? kind.label) : kind.label}
            className="border-t border-line-faint px-3.5 py-2.5 first:border-t-0"
          />
        );
      })}
    </Block>
  );

  const handedIn = item.handedIn.length > 0 && (
    <Block key="handed" icon={Success} title="What you handed in">
      {item.handedIn.map((f, i) => {
        const kind = fileRowKind(f);
        return (
          <FileRow
            key={`${f.name}-${i}`}
            name={f.name}
            href={f.href}
            external={f.external}
            source={item.source}
            kind={kind}
            meta={[f.external ? hostOf(f.href) : kind.label, f.at && `Handed in ${dayName(dayIn(zone, f.at), today)}`].filter(Boolean).join(" · ")}
            className="border-t border-line-faint px-3.5 py-2.5 first:border-t-0"
          />
        );
      })}
    </Block>
  );

  const handIn = <HandIn key="handin" item={item} flows={flows} />;

  return (
    <>
      {head}
      {marked}
      {teacher}
      {instructions}
      {attachments}
      {handedIn}
      {handIn}
    </>
  );
}

function HandIn({ item, flows }: { item: WorkItem; flows: WorkFlows }) {
  const flow = flows.flows[item.key];
  // Handed in on its own site (Canvas): a way there, never a hand-in here.
  if (item.url && !item.canSubmit)
    return (
      <Block icon={Upload} title="Hand in" className="flex flex-col items-start gap-3 px-4 py-3.5">
        <p className="flex items-start gap-2.5 type-body-sm text-text-2">
          <Icon icon={Information} size={16} className="mt-0.5 text-text-3" />
          {item.state === "none" ? (item.why ?? "This is not handed in online.") : `This is handed in on ${SOURCE[item.source]}.`}
        </p>
        <Button size="sm" variant="secondary" render={<a href={item.url} target="_blank" rel="noreferrer" />} nativeButton={false}>
          <SourceMark source={item.source} size={14} />
          Open in {SOURCE[item.source]}
          <Icon icon={External} size={14} />
        </Button>
      </Block>
    );
  if (!item.canSubmit && flow?.phase !== "done")
    return (
      <Block icon={Upload} title="Hand in" className="px-4 py-3.5">
        <p className="flex items-start gap-2.5 type-body-sm text-text-2">
          <Icon icon={Locked} size={16} className="mt-0.5 text-text-3" />
          {item.why ?? `${SOURCE[item.source]} does not take work for this here.`}
        </p>
      </Block>
    );
  const many = item.slots.length > 1;
  return (
    <Block icon={Upload} title={item.handedIn.length ? "Hand in again" : "Hand in"}>
      {item.slots.map(slot => (
        <div key={slot.id} className="border-t border-line-faint first:border-t-0">
          {many && <p className="px-3.5 pt-3 type-label-sm text-text-2">{slot.name}</p>}
          <Slot item={item} slot={slot} flow={flow?.slotId === slot.id ? flow : undefined} flows={flows} />
        </div>
      ))}
    </Block>
  );
}

function Slot({ item, slot, flow, flows }: { item: WorkItem; slot: WorkSlot; flow: Flow | undefined; flows: WorkFlows }) {
  const dest = SOURCE[item.source];
  if (slot.takes === "turnitin")
    return (
      <p className="flex items-start gap-2.5 px-3.5 py-3 type-body-sm text-text-2">
        <Icon icon={Locked} size={16} className="mt-0.5 text-text-3" />
        This one goes through Turnitin, which needs Compass itself.
      </p>
    );
  if (!flow) return <Picker item={item} slot={slot} onPick={pick => flows.set(item.key, { phase: "confirm", slotId: slot.id, pick })} />;

  const name = flow.pick.kind === "file" ? flow.pick.file.name : (hostOf(flow.pick.url) ?? flow.pick.url);
  if (flow.phase === "done") return <Done dest={dest} name={name} again={item.canSubmit} onAgain={() => flows.set(item.key, null)} />;

  const sending = flow.phase === "sending";
  // Another hand-in is still on its way: one at a time.
  const elsewhere = !sending && flows.sending;
  return (
    <div className="flex flex-col gap-3 p-3">
      <PickedCard pick={flow.pick} />
      {sending ? (
        <div role="status" className="flex flex-col gap-2 px-0.5 pb-0.5">
          <div className="neo-sweep" aria-hidden>
            <span />
          </div>
          <p className="type-label-sm text-text-2">Handing in to {dest}…</p>
        </div>
      ) : (
        <>
          {flow.phase === "failed" && (
            <Alert status="fail">
              <AlertTitle>It did not go in</AlertTitle>
              <AlertDescription>{flow.message}</AlertDescription>
            </Alert>
          )}
          <p className="px-0.5 type-body text-text-1 [overflow-wrap:anywhere]">
            {flow.pick.kind === "file" ? (
              <>
                Hand in <span className="font-semibold">{flow.pick.file.name}</span> to {dest}?
              </>
            ) : (
              <>Hand in this link to {dest}?</>
            )}
          </p>
          <div className="flex items-center justify-end gap-2">
            {elsewhere && <span className="me-auto type-caption text-text-3">Another hand-in is still going</span>}
            <Button variant="secondary" size="sm" onClick={() => flows.set(item.key, null)}>
              Cancel
            </Button>
            <Button variant="confirm" size="sm" disabled={elsewhere} onClick={() => void flows.send(item, slot.id, flow.pick)}>
              <Icon icon={Upload} />
              {flow.phase === "failed" ? "Try again" : "Hand in"}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

/** The file or link about to go in. */
function PickedCard({ pick }: { pick: HandInPick }) {
  const kind = pick.kind === "file" ? fileKind(pick.file.name, pick.file.type) : linkKind(pick.url);
  return (
    <div className="neo-picked flex min-w-0 items-center gap-3 px-3 py-2.5">
      <KindGlyph kind={kind} />
      <div className="min-w-0 flex-1">
        <p className="truncate type-label text-text-1">{pick.kind === "file" ? pick.file.name : pick.url}</p>
        <p className="truncate type-caption text-text-3">
          {pick.kind === "file" ? [kind.label, sizeText(pick.file.size)].filter(Boolean).join(" · ") : (hostOf(pick.url) ?? "Link")}
        </p>
      </div>
    </div>
  );
}

/** Handed in: the check lands with a ring going out from it. */
function Done({ dest, name, again, onAgain }: { dest: string; name: string; again: boolean; onAgain: () => void }) {
  return (
    <div role="status" className="flex min-w-0 items-center gap-3.5 px-3.5 py-4">
      <span className="relative grid size-10 shrink-0 place-items-center">
        <motion.span
          aria-hidden
          className="neo-done-ring absolute inset-0"
          initial={{ scale: 0.6, opacity: 0.9 }}
          animate={{ scale: 1.7, opacity: 0 }}
          transition={{ duration: 0.7, ease: [0.2, 0.8, 0.2, 1] }}
        />
        <motion.span initial={{ scale: 0.3, rotate: -45, opacity: 0 }} animate={{ scale: 1, rotate: 0, opacity: 1 }} transition={spring.snap} className="inline-grid text-ok-text">
          <Icon icon={Success} size={32} />
        </motion.span>
      </span>
      <div className="min-w-0 flex-1">
        <p className="type-label-lg text-text-1">Handed in to {dest}</p>
        <p className="truncate type-caption text-text-2">{name}</p>
      </div>
      {again && (
        <Button variant="ghost" size="sm" onClick={onAgain}>
          Hand in another
        </Button>
      )}
    </div>
  );
}

const LINK = /^https?:\/\/[^\s/.]+\.[^\s]+$/i;

/** Where a file is dropped or chosen, and on a Compass slot that takes one, a link pasted. */
function Picker({ item, slot, onPick }: { item: WorkItem; slot: WorkSlot; onPick: (pick: HandInPick) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [url, setUrl] = useState("");
  const dest = SOURCE[item.source];

  // A file let go just outside the drop area would make the browser leave the app to open it; while there is a place
  // to drop work, a miss does nothing instead.
  useEffect(() => {
    const miss = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes("Files")) e.preventDefault();
    };
    window.addEventListener("dragover", miss);
    window.addEventListener("drop", miss);
    return () => {
      window.removeEventListener("dragover", miss);
      window.removeEventListener("drop", miss);
    };
  }, []);

  const take = (file: File | undefined | null) => {
    if (!file) return;
    if (file.size > MAX_UPLOAD) return setError(`${file.name} is over 40 MB. Hand it in on ${dest} itself.`);
    if (file.size === 0) return setError(`${file.name} is empty.`);
    setError(null);
    onPick({ kind: "file", file });
  };
  const link = url.trim();

  return (
    <div className="flex flex-col gap-3 p-3">
      <div
        data-over={over || undefined}
        onDragEnter={e => {
          e.preventDefault();
          setOver(true);
        }}
        onDragOver={e => {
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
        }}
        onDragLeave={e => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false);
        }}
        onDrop={e => {
          e.preventDefault();
          setOver(false);
          take(e.dataTransfer.files[0]);
        }}
        className="neo-drop flex flex-col items-center gap-1.5 px-4 py-5 text-center"
      >
        <Icon icon={Upload} size={24} className="neo-section-glyph" />
        <p className="type-label text-text-1">{over ? "Drop it to hand it in" : "Drop your work here"}</p>
        <p className="type-caption text-text-3">One file, up to 40 MB</p>
        <Button variant="secondary" size="sm" onClick={() => input.current?.click()} className="mt-1.5">
          Choose a file
        </Button>
        {/* eslint-disable-next-line glaze/no-native-control -- the system file picker behind "Choose a file"; it is never shown */}
        <input
          ref={input}
          type="file"
          hidden
          onChange={e => {
            take(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
      </div>
      {slot.takes === "file-or-link" && (
        <form
          noValidate
          onSubmit={e => {
            e.preventDefault();
            if (LINK.test(link)) onPick({ kind: "link", url: link });
            else setError("That link should start with https://.");
          }}
          className="flex min-w-0 items-center gap-2"
        >
          <Input type="url" aria-label="A link to hand in" placeholder="Or paste a link" value={url} onValueChange={setUrl} className="min-w-0 flex-1" />
          <Button type="submit" variant="secondary" disabled={!link}>
            Use link
          </Button>
        </form>
      )}
      {error && (
        <Alert status="fail">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}
