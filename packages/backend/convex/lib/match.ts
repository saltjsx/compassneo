/**
 * Joining Compass's timetable to the rest: who a teacher code is, which Connect subject a class's grades are under,
 * what to call a class, and which colour it wears.
 *
 * Compass names teachers by import code ("jsmith", "mvanberg": first initial and surname) and classes by code
 * ("10MA1", "Year 10 Mathematics"). Connect names subjects by learning area ("Mathematics", "Technologies") with the
 * teachers' full names. A class is matched to the subject whose teachers it shares, with the subject's name as the
 * tiebreak (and the only clue when a school's codes are not initials and surnames).
 */

export type Person = { code: string; name: string; full: string | null; photoUrl?: string | null };

const words = (s: string) =>
  s
    .replace(/[^\p{L}\s'-]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);

const squash = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");

/** "Mary Anne Van Berg" could be mannevanberg, mvanberg or mberg; each with the surname it implies. */
export function codesFor(full: string): Array<{ code: string; surname: string }> {
  const w = words(full);
  if (w.length < 2) return [];
  const initial = squash(w[0]!)[0];
  if (!initial) return [];
  return w.slice(1).map((_, i) => ({ code: initial + squash(w.slice(i + 1).join("")), surname: w.slice(i + 1).join(" ") }));
}

/** Teacher codes to names, from every full name Connect has shown (subject teachers, notice authors). */
export function teacherDirectory(fullNames: Iterable<string>) {
  const byCode = new Map<string, Person>();
  for (const full of fullNames) {
    const first = words(full)[0] ?? "";
    for (const { code, surname } of codesFor(full)) {
      if (!byCode.has(code)) byCode.set(code, { code, name: `${first[0]?.toUpperCase() ?? ""}. ${surname}`, full });
    }
  }
  return (code: string | null): Person | null => {
    if (!code) return null;
    const key = code.toLowerCase().replace(/\d+$/, "");
    const known = byCode.get(key);
    if (known) return { ...known, code };
    // Not on Connect: "crebello" reads as C. Rebello. Short codes ("ABC") are initials already.
    if (/^[a-z]{5,}$/.test(key)) return { code, name: `${key[0]!.toUpperCase()}. ${key[1]!.toUpperCase()}${key.slice(2)}`, full: null };
    return { code, name: code.toUpperCase(), full: null };
  };
}

// ---------- class names ----------

const SHORT: Record<string, string> = {
  mathematics: "Maths",
  "mathematics methods": "Maths Methods",
  "mathematics applications": "Maths Applications",
  "mathematics specialist": "Maths Specialist",
  "mathematics essential": "Maths Essential",
  "humanities and social sciences": "HASS",
  "humanities & social sciences": "HASS",
  "physical education": "Phys Ed",
  "physical education general": "Phys Ed",
  "health education": "Health",
  "english as an additional language or dialect": "EAL/D",
};

/** "Year 10 Mathematics" is "Mathematics" to the student in it. */
export function subjectName(subject: string | null, code: string) {
  const s = (subject ?? code).replace(/^year\s*\d+\s*/i, "").trim();
  return s || code;
}

/** What a card calls a class: "Maths", "HASS", "Homeroom". */
export function shortName(subject: string | null, code: string) {
  const s = subjectName(subject, code);
  if (/^(hr|homeroom|home room|form)\b/i.test(s)) return "Homeroom";
  return SHORT[s.toLowerCase()] ?? s;
}

// ---------- colours ----------

/** How many class colours the app has (brand.css, --class-hue-*). */
export const HUES = 12;

const hash = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
};

/** A colour for each class, different for every class while there are no more classes than colours. */
export function huesFor(codes: string[]) {
  const out = new Map<string, number>();
  const taken = new Set<number>();
  for (const code of [...new Set(codes)].sort()) {
    let h = hash(code) % HUES;
    for (let i = 0; i < HUES && taken.has(h); i++) h = (h + 5) % HUES; // 5 is coprime with 12: every slot is tried
    taken.add(h);
    out.set(code, h);
  }
  return out;
}

// ---------- grades ----------

const STOP = new Set(["and", "the", "of", "general", "atar", "year", "yr", "unit", "units"]);
const stem = (w: string) => (w.length > 4 && w.endsWith("s") ? w.slice(0, -1) : w);
const subjectWords = (s: string) =>
  new Set(
    words(s.replace(/&/g, " and "))
      .map(w => stem(w.toLowerCase().replace(/['-]/g, "")))
      .filter(w => w && !STOP.has(w)),
  );

export type ClassInfo = { code: string; subject: string | null; teachers: string[] };
export type SubjectInfo = { subject: string; teachers: string[] };

/**
 * The subject a class's grades are under, or null. Shared teachers count double (a class taught by jsmith is the
 * subject Salem Ahmed teaches), then shared words in the name ("Humanities & Social Sciences" and "Humanities and
 * Social Sciences"). Teachers are compared as sets, so a class with two teachers finds the subject with both.
 */
export function matchSubject<S extends SubjectInfo>(klass: ClassInfo, subjects: S[]): S | null {
  const mine = new Set(klass.teachers.map(t => t.toLowerCase().replace(/\d+$/, "")));
  const name = subjectWords(subjectName(klass.subject, klass.code));
  let best: S | null = null;
  let bestScore = 0;
  for (const s of subjects) {
    // The subject's teachers who teach this class too.
    const shared = s.teachers.filter(t => codesFor(t).some(c => mine.has(c.code))).length;
    const union = mine.size + s.teachers.length - shared;
    const teacherScore = union > 0 ? shared / union : 0;
    const want = subjectWords(s.subject);
    let common = 0;
    for (const w of want) if (name.has(w)) common++;
    const nameScore = want.size ? common / want.size : 0;
    const score = 2 * teacherScore + nameScore;
    if (score > bestScore) {
      best = s;
      bestScore = score;
    }
  }
  return bestScore >= 0.5 ? best : null;
}

// ---------- Canvas courses ----------

/** "Mrs Jane Marlow" is Jane Marlow: a title would read as a first initial. */
const untitled = (name: string) => name.replace(/^\s*(mr|mrs|ms|miss|mx|dr|prof|sir)\.?\s+/i, "").trim();

/** A class's code without its year and class number: "9DT" is dt, "8SCI2" is sci, "12MAA-2" is maa. */
const codeCore = (code: string) => code.toLowerCase().replace(/^\d+/, "").replace(/[^a-z]+\d*$/, "").replace(/\d+$/, "").replace(/[^a-z]/g, "");

export type CourseInfo = { name: string; code: string | null; teachers: string[] };

/**
 * Word overlap between two names, each shared word counting by how rare it is among all the names it could have
 * matched (df: in how many it appears), out of the shorter name's words. "Digital Technology" and "Food
 * Technology" share only a word every technology course has, so they do not match; "Mathematics" and "9 Mathematics
 * Core" do.
 */
function overlap(a: Set<string>, b: Set<string>, df: Map<string, number>) {
  if (!a.size || !b.size) return 0;
  let score = 0;
  for (const w of a) if (b.has(w)) score += 1 / (df.get(w) ?? 1);
  return score / Math.min(a.size, b.size);
}

const docFreq = (names: Array<Set<string>>) => {
  const df = new Map<string, number>();
  for (const n of names) for (const w of n) df.set(w, (df.get(w) ?? 0) + 1);
  return df;
};

/**
 * Which Canvas course each timetable class is, by class code. A course whose code is the class's (or the class's
 * without its class number: "8SCI" for "8SCI2") is it; else the course sharing its teachers and the rarer words of
 * its name, as for Connect's subjects (matchSubject). Each course goes to one class at most, the best match first.
 * Homeroom is never a course.
 */
export function matchCourses<C extends CourseInfo>(classes: ClassInfo[], courses: C[]): Map<string, C> {
  const courseWords = courses.map(c => subjectWords(subjectName(c.name, c.name)));
  const df = docFreq(courseWords);
  const pairs: Array<{ code: string; c: C; score: number }> = [];
  for (const k of classes) {
    if (shortName(k.subject, k.code) === "Homeroom") continue;
    const mine = new Set(k.teachers.map(t => t.toLowerCase().replace(/\d+$/, "")));
    const name = subjectWords(subjectName(k.subject, k.code));
    courses.forEach((c, i) => {
      const cc = c.code ? c.code.toLowerCase().replace(/[^a-z0-9]/g, "") : "";
      const kc = k.code.toLowerCase().replace(/[^a-z0-9]/g, "");
      const byCode = !!cc && (cc === kc || (cc.length >= 4 && kc.startsWith(cc)));
      const teachers = c.teachers.map(untitled);
      const shared = teachers.filter(t => codesFor(t).some(x => mine.has(x.code))).length;
      const words = overlap(name, courseWords[i]!, df);
      const score = (byCode ? 3 : 0) + (shared ? 1 : 0) + words;
      // A name match alone has to be a real one; a shared teacher alone is not enough (one teacher, many classes).
      if (byCode || words >= 0.5) pairs.push({ code: k.code, c, score });
    });
  }
  pairs.sort((a, b) => b.score - a.score);
  const out = new Map<string, C>();
  const taken = new Set<C>();
  for (const p of pairs) {
    if (out.has(p.code) || taken.has(p.c)) continue;
    out.set(p.code, p.c);
    taken.add(p.c);
  }
  return out;
}

/**
 * The class a piece of work in a course no class claims is for, by its name: some schools keep formal assessments in
 * a course of their own ("Year 9 Assessments"), named for the subject ("Digital Technology Task 2", "Science
 * half-yearly exam") or its code ("DT Task 2"). A class may come more than once, under other names for it (its Canvas
 * course's name). Null when no class's name or code is in it, or two classes are equally.
 */
export function classForName(name: string, classes: ClassInfo[]): string | null {
  const said = subjectWords(name);
  const raw = new Set(words(name).map(w => w.toLowerCase()));
  const candidates = classes.filter(k => shortName(k.subject, k.code) !== "Homeroom");
  const names = candidates.map(k => subjectWords(subjectName(k.subject, k.code)));
  // How rare a word is, counted over classes: one class under two names counts once.
  const perClass = new Map<string, Set<string>>();
  candidates.forEach((k, i) => perClass.set(k.code, new Set([...(perClass.get(k.code) ?? []), ...names[i]!])));
  const df = docFreq([...perClass.values()]);
  let best: string | null = null;
  let bestScore = 0;
  let tie = false;
  candidates.forEach((k, i) => {
    const mine = names[i]!;
    let common = 0;
    for (const w of mine) if (said.has(w)) common += 1 / (df.get(w) ?? 1);
    let score = mine.size ? common / mine.size : 0;
    const core = codeCore(k.code);
    const short = shortName(k.subject, k.code).toLowerCase();
    if ((core.length >= 2 && raw.has(core)) || (short.length >= 3 && !short.includes(" ") && raw.has(short))) score = Math.max(score, 1);
    if (score > bestScore) {
      best = k.code;
      bestScore = score;
      tie = false;
    } else if (score === bestScore && score > 0 && best !== k.code) tie = true;
  });
  return bestScore >= 0.75 && !tie ? best : null;
}
