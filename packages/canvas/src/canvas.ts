/**
 * Canvas LMS, where many schools put their courses' work, files and announcements beside Compass's timetable.
 *
 * Signing in: every school puts its own sign-on in front of Canvas (Microsoft, Google, an identity service of its own,
 * often with a second step), so there is no one sign-in to make without a browser. What every Canvas has is the
 * student's own access token (Account > Settings > New access token), which Canvas documents for exactly this: an app
 * reading the API as the student. A token is sent as a Bearer header; nothing else is kept.
 *
 * Read-only by construction: the client only ever sends GET, and only to the paths on the allow-list. Every list is
 * paginated by Canvas's Link header, followed to a cap.
 */

export class CanvasError extends Error {
  constructor(
    message: string,
    /**
     * bad-token: Canvas does not accept the token (wrong, expired, or deleted); forbidden: Canvas will not show this to
     * the student (a course's files tab turned off); not-canvas: the address is not a Canvas; unreachable: nothing
     * answered at the address at all.
     */
    readonly code: "bad-token" | "forbidden" | "not-found" | "not-canvas" | "unreachable" | "upstream" | "read-only",
    readonly status?: number,
  ) {
    super(message);
    this.name = "CanvasError";
  }
}

const UA = "CompassNeo/1.0 (+https://compassneo.app)";

// ---------- addresses ----------

/**
 * A Canvas address from whatever a person pastes: "school.instructure.com", "canvas.example.edu.au/courses/12",
 * "https://canvas.example.edu.au/". Always https, just the origin. Null when it is not an address.
 */
export function canvasOrigin(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;
  let u: URL;
  try {
    u = new URL(/^[a-z]+:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  if (!publicHost(u.hostname) || u.username || u.password || (u.port && u.port !== "443")) return null;
  return `https://${u.hostname.toLowerCase()}`;
}

/**
 * Whether a host is a public name the server may fetch from. The Canvas address is whatever a student types, and
 * everything a server at it says (its download links among it) is just as untrusted, so the server never follows either
 * to an IP address or a name that only means something on a private network.
 */
const PRIVATE = /(^|\.)(localhost|local|localdomain|internal|intranet|lan|home|corp|private|arpa|test|invalid|example)$/i;
export const publicHost = (host: string) => /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(host) && !PRIVATE.test(host);

/** A token as pasted: Canvas tokens are "<digits>~<letters and digits>". Spaces and a "Bearer " are dropped. */
export const cleanToken = (t: string) => t.trim().replace(/^bearer\s+/i, "").replace(/\s+/g, "");
export const looksLikeToken = (t: string) => /^\d+~[A-Za-z0-9]{20,}$/.test(cleanToken(t));

// ---------- read-only guard ----------

const ALLOW = [
  /^\/api\/v1\/users\/self(\/profile)?$/,
  /^\/api\/v1\/courses$/,
  /^\/api\/v1\/courses\/\d+\/(assignments|assignment_groups|files|folders|modules)$/,
  /^\/api\/v1\/courses\/\d+\/modules\/\d+\/items$/,
  /^\/api\/v1\/folders\/\d+\/(files|folders)$/,
  /^\/api\/v1\/announcements$/,
  /^\/api\/v1\/files\/\d+$/,
];

function assertReadOnly(path: string) {
  if (!ALLOW.some(r => r.test(path))) throw new CanvasError(`Refusing a Canvas call that is not on the list: ${path.slice(0, 80)}`, "read-only");
}

// ---------- shapes ----------

/**
 * Ids are kept as strings: Canvas's global ids (a shard's prefix and the local id) pass 2^53, which a number would
 * round. Canvas sends them as strings when asked (application/json+canvas-string-ids).
 */
export type CanvasMe = { id: string; name: string };

export type CanvasCourse = {
  id: string;
  name: string;
  /** The school's code for it ("8SCI", "9MATH-2"), often the timetable's own. */
  code: string | null;
  term: string | null;
  /** The teachers' names as Canvas shows them ("Jane Marlow"). */
  teachers: string[];
  /** The student's current score out of 100 and letter, when the course shows them. */
  score: number | null;
  grade: string | null;
  /** Assignment groups count by their weights (else by points). */
  weighted: boolean;
  url: string;
};

export type CanvasSubmission = {
  /** Canvas's own: unsubmitted, submitted, pending_review, graded. */
  state: string;
  submittedAt: string | null;
  late: boolean;
  missing: boolean;
  excused: boolean;
  score: number | null;
  grade: string | null;
  /** When the mark was released to the student (Canvas posts marks; an unposted mark is hidden). */
  postedAt: string | null;
};

export type CanvasAssignment = {
  id: string;
  courseId: string;
  name: string;
  /** The teacher's instructions, an HTML fragment. */
  description: string | null;
  due: string | null;
  unlockAt: string | null;
  lockAt: string | null;
  points: number | null;
  /** How it is handed in: online_upload, online_text_entry, online_url, external_tool, on_paper, none, ... */
  types: string[];
  groupId: string | null;
  /** Left out of the course's grade. */
  omitted: boolean;
  url: string;
  submission: CanvasSubmission | null;
};

export type CanvasGroup = { id: string; name: string; weight: number };

/**
 * A course's modules, which is where most teachers put a course's content (and where it is, when a school hides the
 * course's Files from students): each module's items in the teacher's order, with their indents.
 */
export type CanvasModule = { id: string; name: string; items: CanvasModuleItem[] };
export type CanvasModuleItem = {
  id: string;
  title: string;
  /** File, Page, ExternalUrl, Assignment, Quiz, Discussion, ExternalTool, SubHeader. */
  type: string;
  indent: number;
  /** The file's id, for a File. */
  fileId: string | null;
  /** Where it opens: the outside link for an ExternalUrl, else its page on Canvas. */
  url: string | null;
};

export type CanvasAnnouncement = {
  id: string;
  courseId: string;
  title: string;
  /** Plain text, capped. */
  text: string | null;
  author: string | null;
  at: string | null;
  url: string;
};

// ---------- helpers ----------

const num = (x: unknown): number | null => (typeof x === "number" && Number.isFinite(x) ? x : null);
const str = (x: unknown) => (typeof x === "string" && x.trim() ? x.trim() : null);

/** HTML as plain text, capped: enough to show, not a copy of the whole post. */
export function plainText(html: unknown, max = 2000) {
  const t = str(html)
    ?.replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>|<\/p>|<\/div>|<li>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return t ? t.slice(0, max) : null;
}

/** The next page from a Link header, if any. */
function nextOf(link: string | null) {
  for (const part of (link ?? "").split(",")) {
    const m = /<([^>]+)>\s*;\s*rel="?next"?/i.exec(part);
    if (m) return m[1]!;
  }
  return null;
}

// ---------- the session ----------

export class CanvasSession {
  constructor(
    readonly origin: string,
    private readonly token: string,
  ) {}

  /** One GET, as JSON. Throws CanvasError for every answer that is not one. */
  private async getOnce(url: string): Promise<{ json: unknown; next: string | null }> {
    const u = new URL(url);
    if (`${u.protocol}//${u.host}` !== this.origin) throw new CanvasError("Canvas sent a page from somewhere else.", "upstream");
    assertReadOnly(u.pathname);
    let res: Response;
    try {
      res = await fetch(url, {
        method: "GET",
        headers: { Authorization: `Bearer ${this.token}`, Accept: "application/json+canvas-string-ids, application/json", "User-Agent": UA },
        redirect: "manual",
      });
    } catch (e) {
      throw new CanvasError(e instanceof Error && e.message ? `Canvas did not answer: ${e.message}` : "Canvas did not answer.", "unreachable");
    }
    const type = res.headers.get("content-type") ?? "";
    if (res.status === 401) {
      await res.body?.cancel();
      throw new CanvasError("Canvas does not accept this access token any more.", "bad-token", 401);
    }
    if (res.status === 403) {
      await res.body?.cancel();
      throw new CanvasError("Canvas does not show this to students.", "forbidden", 403);
    }
    if (res.status === 404) {
      await res.body?.cancel();
      throw new CanvasError("Canvas did not find that.", "not-found", 404);
    }
    if ((res.status >= 300 && res.status < 400) || !/json/i.test(type)) {
      await res.body?.cancel();
      throw new CanvasError("That address did not answer as Canvas does.", "not-canvas", res.status);
    }
    if (!res.ok) {
      await res.body?.cancel();
      throw new CanvasError(`Canvas answered ${res.status}.`, "upstream", res.status);
    }
    // Canvas prefixes JSON with "while(1);" for browsers; the API with a token does not, but it costs nothing to allow.
    try {
      const text = (await res.text()).replace(/^while\(1\);/, "");
      return { json: JSON.parse(text), next: nextOf(res.headers.get("link")) };
    } catch {
      throw new CanvasError("Canvas sent an answer that was cut short.", "upstream");
    }
  }

  /** A GET of one object. */
  async get<T = any>(path: string, query: Record<string, string | string[]> = {}): Promise<T> {
    return (await this.getOnce(this.url(path, query))).json as T;
  }

  /** A GET of a list, page after page, up to max items. */
  async list<T = any>(path: string, query: Record<string, string | string[]> = {}, max = 500): Promise<T[]> {
    const out: T[] = [];
    let url: string | null = this.url(path, { per_page: "100", ...query });
    for (let page = 0; url && page < 20 && out.length < max; page++) {
      const r: { json: unknown; next: string | null } = await this.getOnce(url);
      if (!Array.isArray(r.json)) throw new CanvasError("Canvas sent something other than a list.", "upstream");
      out.push(...(r.json as T[]));
      url = r.next;
    }
    return out.slice(0, max);
  }

  private url(path: string, query: Record<string, string | string[]>) {
    const u = new URL(path, this.origin);
    for (const [k, v] of Object.entries(query)) for (const x of Array.isArray(v) ? v : [v]) u.searchParams.append(k, x);
    return u.toString();
  }

  async whoami(): Promise<CanvasMe> {
    const u = await this.get("/api/v1/users/self");
    const id = u?.id != null ? String(u.id) : "";
    if (!/^\d+$/.test(id)) throw new CanvasError("That address did not answer as Canvas does.", "not-canvas");
    return { id, name: str(u.short_name) ?? str(u.name) ?? "Student" };
  }

  /** The student's current courses, with teachers and the student's own score where the course shows one. */
  async getCourses(): Promise<CanvasCourse[]> {
    const all = await this.list("/api/v1/courses", {
      enrollment_state: "active",
      "include[]": ["teachers", "total_scores", "term"],
    });
    return all
      .filter(c => c && c.id != null && !c.access_restricted_by_date)
      .map(c => {
        const mine = ((c.enrollments ?? []) as any[]).find(e => /student/i.test(String(e.type ?? e.role ?? ""))) ?? null;
        return {
          id: String(c.id),
          name: str(c.name) ?? str(c.course_code) ?? "Course",
          code: str(c.course_code),
          term: str(c.term?.name),
          teachers: ((c.teachers ?? []) as any[]).map(t => str(t.display_name)).filter((x): x is string => !!x),
          score: c.hide_final_grades ? null : num(mine?.computed_current_score),
          grade: c.hide_final_grades ? null : str(mine?.computed_current_grade),
          weighted: !!c.apply_assignment_group_weights,
          url: `${this.origin}/courses/${c.id}`,
        };
      });
  }

  /** A course's assignments, each with the student's own submission. */
  async getAssignments(courseId: string): Promise<CanvasAssignment[]> {
    const all = await this.list(`/api/v1/courses/${courseId}/assignments`, { "include[]": ["submission"], order_by: "due_at" });
    return all
      .filter(a => a && a.id != null && a.workflow_state !== "unpublished")
      .map(a => {
        const s = a.submission ?? null;
        return {
          id: String(a.id),
          courseId,
          name: str(a.name) ?? "Assignment",
          description: str(a.description),
          due: str(a.due_at),
          unlockAt: str(a.unlock_at),
          lockAt: str(a.lock_at),
          points: num(a.points_possible),
          types: Array.isArray(a.submission_types) ? a.submission_types.map(String) : [],
          groupId: a.assignment_group_id != null ? String(a.assignment_group_id) : null,
          omitted: !!a.omit_from_final_grade,
          url: str(a.html_url) ?? `${this.origin}/courses/${courseId}/assignments/${a.id}`,
          submission: s
            ? {
                state: str(s.workflow_state) ?? "unsubmitted",
                submittedAt: str(s.submitted_at),
                late: !!s.late,
                missing: !!s.missing,
                excused: !!s.excused,
                score: num(s.score),
                grade: str(s.grade),
                postedAt: str(s.posted_at),
              }
            : null,
        };
      });
  }

  /**
   * A course's modules with their items. Canvas leaves a module's items out of the list when a course has too many;
   * those modules' items are then asked for one module at a time.
   */
  async getModules(courseId: string): Promise<CanvasModule[]> {
    const all = await this.list(`/api/v1/courses/${courseId}/modules`, { "include[]": ["items"] }, 200);
    const item = (i: any): CanvasModuleItem => ({
      id: String(i.id),
      title: str(i.title) ?? "Item",
      type: str(i.type) ?? "Item",
      indent: num(i.indent) ?? 0,
      fileId: i.type === "File" && i.content_id != null ? String(i.content_id) : null,
      url: i.type === "ExternalUrl" ? str(i.external_url) : str(i.html_url),
    });
    const out: CanvasModule[] = [];
    for (const m of all.filter(m => m && m.id != null && m.state !== "locked")) {
      const raw: any[] = Array.isArray(m.items) ? m.items : (num(m.items_count) ?? 0) > 0 ? await this.list(`/api/v1/courses/${courseId}/modules/${m.id}/items`, {}, 300) : [];
      out.push({ id: String(m.id), name: str(m.name) ?? "Module", items: raw.filter(i => i && i.id != null && i.published !== false).map(item) });
    }
    return out;
  }

  /**
   * A file's bytes, its type and name. Canvas answers the file's details with a short-lived download link (signed for
   * the student), which is fetched without the token: it may lead off Canvas's own host, to its file store. A file over
   * max is not fetched: its size says why, and its bytes are empty.
   */
  async file(fileId: string, max = Infinity): Promise<{ bytes: ArrayBuffer; type: string; name: string | null; size: number | null } | null> {
    const f = await this.get(`/api/v1/files/${fileId}`).catch((e: unknown) => {
      if (e instanceof CanvasError && (e.code === "not-found" || e.code === "forbidden")) return null;
      throw e;
    });
    const url = str(f?.url);
    if (!f || !url || f.locked_for_user) return null;
    const meta = { type: str(f["content-type"]) ?? "application/octet-stream", name: str(f.display_name) ?? str(f.filename), size: num(f.size) };
    if (meta.size != null && meta.size > max) return { bytes: new ArrayBuffer(0), ...meta };
    // Followed by hand, so every hop (Canvas's own host, then its file store) is checked to be a public https address.
    let next: string | null = url;
    for (let hop = 0; next && hop < 6; hop++) {
      const u = new URL(next);
      if (u.protocol !== "https:" || !publicHost(u.hostname) || (u.port && u.port !== "443")) {
        throw new CanvasError("Canvas pointed the file somewhere Compass Neo will not fetch from.", "upstream");
      }
      let res: Response;
      try {
        res = await fetch(next, { headers: { "User-Agent": UA, Accept: "*/*" }, redirect: "manual" });
      } catch {
        throw new CanvasError("Canvas's file store did not answer.", "unreachable");
      }
      const location = res.headers.get("location");
      if (res.status >= 300 && res.status < 400 && location) {
        await res.body?.cancel();
        next = new URL(location, next).toString();
        continue;
      }
      if (!res.ok) {
        await res.body?.cancel();
        return null;
      }
      return { bytes: await res.arrayBuffer(), ...meta };
    }
    throw new CanvasError("Canvas's file links went round in circles.", "upstream");
  }

  async getGroups(courseId: string): Promise<CanvasGroup[]> {
    const all = await this.list(`/api/v1/courses/${courseId}/assignment_groups`);
    return all.map(g => ({ id: String(g.id), name: str(g.name) ?? "Group", weight: num(g.group_weight) ?? 0 }));
  }

  /** The latest announcements in the courses given, newest first. */
  async getAnnouncements(courseIds: string[], since: string, max = 40): Promise<CanvasAnnouncement[]> {
    if (!courseIds.length) return [];
    const all = await this.list(
      "/api/v1/announcements",
      { "context_codes[]": courseIds.map(id => `course_${id}`), start_date: since, active_only: "true" },
      max,
    );
    return all
      .map(a => ({
        id: String(a.id),
        courseId: /^course_(\d+)$/.exec(String(a.context_code ?? ""))?.[1] ?? "",
        title: str(a.title) ?? "Announcement",
        text: plainText(a.message),
        author: str(a.author?.display_name) ?? str(a.user_name),
        at: str(a.posted_at) ?? str(a.created_at),
        url: str(a.html_url) ?? `${this.origin}/courses`,
      }))
      .sort((a, b) => (b.at ?? "").localeCompare(a.at ?? ""));
  }
}
