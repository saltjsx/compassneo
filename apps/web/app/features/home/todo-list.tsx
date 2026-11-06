import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Button } from "@/components/glaze/ui/button";
import { ChevronDown, Icon, LearningTask, Success } from "@/components/glaze/icon";
import { SourceMark } from "@/components/brand/source-mark";
import { cn } from "@/lib/glaze/utils";
import { persisted } from "@/lib/neo/store";
import { dayIn, dayName, daysApart, lastLessonText } from "@/lib/neo/days";
import { subjectIcon } from "@/lib/neo/subjects";
import { useTodo, type TodoItem } from "@/lib/neo/overview";
import { time } from "@/features/student/format";
import type { ClassTab } from "@/features/class/class-panel";

/** Whether the list is open, kept on this device. */
// Folded until opened: the header already says how much there is and how much is overdue.
const openStore = persisted<boolean>("cneo.todo.open.v2", false);

/** Rows of work still to come shown before "Show more". Overdue work is always shown, all of it. */
const SHOWN = 5;
/** Work with no hand-in online stays on the list this long after its date (as convex/overview.ts keeps it). */
const OFFLINE_OVERDUE = 7 * 86400 * 1000;

/**
 * Work not handed in yet, from Compass and Connect, above the classes on home, folding like them (folded at first):
 * every overdue piece first, then what is coming up by when it is due. Each row is its class's glyph in its colour, the work and its class, when it is due (overdue
 * in amber) and where it is from; pressing it opens the class on its Work. With nothing to do it says so in one quiet
 * row, so the section never comes and goes between syncs; before Compass's tasks are first synced it is not shown.
 */
export function TodoList({
  token,
  today,
  zone,
  now,
  selected,
  onOpenClass,
}: {
  token: string;
  today: string;
  zone: string;
  now: number;
  /** The class open in the panel, by code. */
  selected: string | null;
  /** Opens a class in the panel, on a section (its work). */
  onOpenClass: (code: string, el: HTMLElement, tab?: ClassTab) => void;
}) {
  const todo = useTodo(token);
  const open = openStore.use();
  const [all, setAll] = useState(false);
  if (todo === null || (todo && !todo.synced)) return null;

  // The server worked overdue out when it last answered; a date passed since is overdue too, and a task with no
  // hand-in online leaves the list a week after its date.
  const items = (todo?.items ?? [])
    .filter(i => !(i.offline && i.due && Date.parse(i.due) < now - OFFLINE_OVERDUE))
    .map(i => (!i.overdue && i.due && Date.parse(i.due) < now ? { ...i, overdue: true } : i))
    .sort(byUrgency);
  const overdue = items.filter(i => i.overdue).length;
  // Every overdue piece, then the first few to come; the rest of those wait behind "Show more".
  const hidden = all ? 0 : Math.max(0, items.length - overdue - SHOWN);
  const shown = hidden ? items.slice(0, items.length - hidden) : items;

  return (
    <section aria-labelledby="todo-title" aria-busy={!todo || undefined} className="mt-6">
      <h2 id="todo-title" className="mb-2">
        {/* eslint-disable-next-line glaze/no-native-control -- the section's own heading folds it: a Glaze Button would draw a pill around a heading */}
        <button
          type="button"
          aria-expanded={open}
          aria-controls="todo-list"
          onClick={() => openStore.set(!open)}
          className="neo-fold-head flex w-full items-center gap-1.5 rounded-tag px-1 py-0.5 text-start type-label-sm text-text-2"
        >
          <Icon icon={LearningTask} size={14} />
          To do
          {items.length > 0 && <span className="neo-tabular text-text-3">{items.length}</span>}
          {overdue > 0 && <span className="neo-tabular text-warn-text">{overdue} overdue</span>}
          <Icon icon={ChevronDown} size={14} className={cn("ms-auto transition-transform duration-150", !open && "-rotate-90")} />
        </button>
      </h2>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            id="todo-list"
            key="todo"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18, ease: [0.2, 0.8, 0.2, 1] }}
            className="overflow-hidden"
          >
            {!todo ? (
              <TodoSkeleton />
            ) : !items.length ? (
              <div className="neo-stack neo-notice flex items-center gap-3 px-3.5 py-3">
                <Icon icon={Success} size={16} className="text-ok-text" />
                <span className="type-label-sm text-text-2">All caught up</span>
                <span className="ms-auto truncate type-caption text-text-3">Nothing to hand in</span>
              </div>
            ) : (
              <ul className="neo-stack neo-notice flex flex-col">
                {shown.map((item, i) => (
                  <li key={item.key} data-top={i > 0 || undefined} className="neo-cell">
                    <TodoRow item={item} zone={zone} today={today} on={!!item.code && selected === item.code} onOpenClass={onOpenClass} />
                  </li>
                ))}
                {items.length - overdue > SHOWN && (
                  <li data-top className="neo-cell px-2 py-1.5">
                    <Button variant="ghost" size="sm" aria-expanded={all} aria-controls="todo-list" onClick={() => setAll(a => !a)}>
                      {all ? "Show fewer" : `Show ${hidden} more`}
                    </Button>
                  </li>
                )}
              </ul>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}

/** Overdue first (the most recently missed first, as the class panel lists them), then soonest due, undated last. */
function byUrgency(a: TodoItem, b: TodoItem) {
  const at = (d: string | null, none: number) => (d ? Date.parse(d) : none);
  if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
  return a.overdue ? at(b.due, 0) - at(a.due, 0) : at(a.due, Infinity) - at(b.due, Infinity) || 0;
}

/** "Due tomorrow 9:00 am", "Due Friday", "Due Mon 10 Nov", "Overdue 2 days", and whether it is pressing. */
function dueOf(item: TodoItem, zone: string, today: string): { text: string; tone: "warn" | "soon" | "plain" } {
  if (!item.due) return { text: "No due date", tone: "plain" };
  const day = dayIn(zone, item.due);
  const away = daysApart(today, day);
  if (item.overdue) {
    if (away >= 0) return { text: `Was due ${time(item.due, zone)}`, tone: "warn" };
    return { text: `Overdue ${-away} ${away === -1 ? "day" : "days"}`, tone: "warn" };
  }
  if (away === 0) return { text: `Due today ${time(item.due, zone)}`, tone: "soon" };
  if (away === 1) return { text: `Due tomorrow ${time(item.due, zone)}`, tone: "soon" };
  return { text: `Due ${dayName(day, today)}`, tone: "plain" };
}

function TodoRow({
  item,
  zone,
  today,
  on,
  onOpenClass,
}: {
  item: TodoItem;
  zone: string;
  today: string;
  on: boolean;
  onOpenClass: (code: string, el: HTMLElement, tab?: ClassTab) => void;
}) {
  const due = dueOf(item, zone, today);
  const notes = [item.className, item.important && "Important", item.offline && "Not handed in online"].filter(Boolean).join(" · ");
  // On a line of its own: joined to the notes it was cut off at phone width.
  const last = !item.overdue && lastLessonText(item.lastLesson, today, zone);
  const body = (
    <>
      <Icon icon={subjectIcon(item.className, item.className, item.code ?? "")} size={16} className={item.hue != null ? "neo-glyph" : "text-text-3"} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate type-label text-text-1">{item.name}</span>
        <span className="truncate type-caption text-text-3">{notes}</span>
        {last && <span className="truncate type-caption text-text-3">{last}</span>}
      </span>
      <span
        className={cn(
          "neo-tabular shrink-0 text-end type-caption",
          due.tone === "warn" ? "text-warn-text" : due.tone === "soon" ? "text-text-1" : "text-text-2",
        )}
      >
        {due.text}
      </span>
      <SourceMark source={item.source} size={13} />
    </>
  );
  const row = "flex min-h-13 w-full min-w-0 items-center gap-3 px-3.5 py-2 text-start";
  // Work for a class not on the timetable now has no class to open: it is listed, and presses nothing.
  if (!item.code) return <div className={row}>{body}</div>;
  const code = item.code;
  return (
    // eslint-disable-next-line glaze/no-native-control -- a whole row that opens its class's work: a Glaze Button would draw a pill inside the block
    <button
      type="button"
      data-hue={item.hue ?? undefined}
      aria-pressed={on}
      onClick={e => onOpenClass(code, e.currentTarget, "work")}
      className={cn("neo-class-row", row, on && "neo-class-row-on")}
    >
      {body}
    </button>
  );
}

/** The list on its way: two rows the height they will have. */
function TodoSkeleton() {
  return (
    <div aria-hidden className="neo-stack neo-notice">
      {[0, 1].map(i => (
        <div key={i} className={cn("flex h-13 items-center gap-3 px-3.5", i > 0 && "border-t border-line")}>
          <span className="neo-st-skel size-4 rounded-pill" />
          <span className="flex flex-1 flex-col gap-1.5">
            <span className="neo-st-skel h-3.5 w-36" />
            <span className="neo-st-skel h-3 w-20" />
          </span>
          <span className="neo-st-skel h-3 w-16" />
        </div>
      ))}
    </div>
  );
}
