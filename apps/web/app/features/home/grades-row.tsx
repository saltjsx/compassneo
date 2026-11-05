import { useOverviewGrades } from "@/lib/neo/overview";
import { mainSubject } from "@/lib/neo/subjects";
import { GradeRings } from "./grade-rings";

/**
 * Grades on home, above the to-do list: one row, always there and never folded, of the main subjects' grades (Maths,
 * English, Science, HASS, in that order; lib/neo/subjects.ts), each as its own ring (grade-rings.tsx), centred, and a
 * last ring saying how many more there are. Only those four ever show here; every subject is on the Grades page. Pressing it opens Grades in the side panel (features/student/grades.tsx), where every
 * grade is gone through and every subject has a page of its own. A school without Connect has no row, unless the
 * student has added Canvas (its grades come in the same shape: convex/lib/grades.ts).
 */
export function GradesRow({ token, day, open, onOpen }: { token: string; day: string; open: boolean; onOpen: () => void }) {
  const data = useOverviewGrades(token, day);
  if (data === null || data?.status === "none") return null;
  if (data?.status === "ready" && !data.subjects.length) return null;
  const ready = data?.status === "ready" ? data : null;
  const shown = (ready?.subjects ?? [])
    .map(s => ({ s, at: mainSubject(s.name, s.subject) }))
    .filter(x => x.at >= 0)
    .sort((a, b) => a.at - b.at)
    .map(x => x.s);
  const more = ready ? ready.subjects.length - shown.length : 0;
  const note =
    data?.status === "loading"
      ? `Getting your grades from ${data.source === "canvas" ? "Canvas" : "Connect"}`
      : data?.status === "unavailable"
        ? data.reason
        : null;

  return (
    <section aria-label="Grades" aria-busy={!data || undefined} className="mt-6">
      <div className="neo-stack neo-notice">
        {/* eslint-disable-next-line glaze/no-native-control -- a whole block that opens the grades: a Glaze Button would draw a pill inside the card */}
        <button
          type="button"
          aria-pressed={open}
          data-on={open || undefined}
          onClick={onOpen}
          className="neo-row-button flex w-full flex-col items-center px-2 py-2.5"
        >
          <span className="sr-only">Grades: </span>
          {ready ? (
            <GradeRings subjects={shown} more={more} />
          ) : note ? (
            <span className="px-2 py-2 text-center type-caption text-text-3">{note}</span>
          ) : (
            <span aria-hidden className="flex justify-center gap-x-2 py-1.5">
              {[0, 1, 2, 3, 4].map(i => (
                <span key={i} className="flex w-16 flex-col items-center gap-1">
                  <span className="neo-st-skel size-12 rounded-pill" />
                  <span className="neo-st-skel h-3 w-8" />
                </span>
              ))}
            </span>
          )}
        </button>
      </div>
    </section>
  );
}
