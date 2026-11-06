import { percentOf, scoreOf, type SubjectGrade } from "@compassneo/connect";

/**
 * Grade history. Connect only ever shows a subject as it stands now, with no dates on its marks, so every time a sync
 * fetches grades the change is written down here: a point for the subject's score whenever it moves, and the moment
 * each task's mark first appeared (or changed). Kept per account beside the grades (connectCache, kind "history").
 *
 * The first time a subject is seen, the marks it already has came in on days nobody saw: they are kept as the baseline
 * (baseline: true), so the app says "before" rather than inventing a date for them.
 */

export type HistoryPoint = {
  at: number;
  /** The score worked out from the marked tasks (scoreOf), out of 100. */
  percent: number | null;
  marked: number;
  letter: string | null;
  baseline?: true;
};

export type MarkSeen = {
  at: number;
  mark: number;
  max: number | null;
  /** The mark it had before, when a teacher changed it. */
  was?: number | null;
  baseline?: true;
};

export type SubjectHistory = { points: HistoryPoint[]; marks: Record<string, MarkSeen> };

export type History = {
  /** When this account's history began. */
  since: number;
  /** By semester and subject (historyKey). */
  subjects: Record<string, SubjectHistory>;
  /**
   * How grades were read when this history was last written. 2: nested outline parts, unassessed tasks left out,
   * Connect's own overall mark (packages/connect getGrades, percentOf). History written before is moved over once.
   */
  reading?: number;
  /**
   * How Canvas's grades were worked out when this history began (canvas.ts keepGrades, CANVAS_READING). Points from
   * another way of working them out are not comparable, so a Canvas history from before starts again.
   */
  canvasReading?: number;
};

const READING = 2;


/** Points kept per subject: years of syncs, as a point is only written when the score moves. */
const MAX_POINTS = 150;

export const historyKey = (semester: 1 | 2, subject: string) => `${semester}:${subject}`;

const finite = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);

/**
 * The history after a grades fetch. Pure: the caller reads the last history and writes this one back.
 *
 * The first fetch after grades began to be read the second way (READING) moves the history over instead of reading the
 * difference as news: marks that only became visible (tasks in an outline's nested parts) join as baseline rather than
 * "marked today", the latest point takes the new score in place rather than adding a jump, and a learning area that
 * held two outlines under one name (and so mixed them) starts again under each outline's own name.
 */
export function recordGrades(prev: History | null, subjects: SubjectGrade[], now: number): History {
  const moving = !!prev && prev.reading !== READING;
  const out: History = prev ? { since: prev.since, subjects: { ...prev.subjects }, reading: READING } : { since: now, subjects: {}, reading: READING };
  if (moving) for (const s of subjects) if (s.area && s.area !== s.subject) delete out.subjects[historyKey(s.semester, s.area)];

  for (const s of subjects) {
    const key = historyKey(s.semester, s.subject);
    const before = out.subjects[key];
    const baseline = !before || moving;
    const h: SubjectHistory = { points: [...(before?.points ?? [])], marks: { ...(before?.marks ?? {}) } };

    for (const t of s.tasks) {
      const id = String(t.taskId);
      const seen = h.marks[id];
      if (!finite(t.mark)) {
        // A mark taken back: forget it, so it is dated afresh when it comes back.
        if (seen) delete h.marks[id];
        continue;
      }
      if (!seen) h.marks[id] = { at: now, mark: t.mark, max: t.maximumMark, ...(baseline ? { baseline: true as const } : {}) };
      else if (seen.mark !== t.mark || seen.max !== t.maximumMark) h.marks[id] = { at: now, mark: t.mark, max: t.maximumMark, was: seen.mark };
    }

    const score = scoreOf(s.tasks);
    const percent = percentOf(s);
    const last = h.points[h.points.length - 1];
    if (moving && before && last) {
      h.points[h.points.length - 1] = { ...last, percent, marked: score.marked, letter: s.grade };
    } else if (!last || last.percent !== percent || last.marked !== score.marked || last.letter !== s.grade) {
      h.points.push({ at: now, percent, marked: score.marked, letter: s.grade, ...(!before ? { baseline: true as const } : {}) });
      if (h.points.length > MAX_POINTS) h.points.splice(0, h.points.length - MAX_POINTS);
    }
    out.subjects[key] = h;
  }
  return out;
}

