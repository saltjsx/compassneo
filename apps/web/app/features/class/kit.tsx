import { useLayoutEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Button } from "@/components/glaze/ui/button";
import {
  ArrowUpRight,
  ChevronDown,
  Document,
  DocumentBlank,
  Download,
  FileArchive,
  FileAudio,
  FileCode,
  FileDatabase,
  FileImage,
  FilePdf,
  FileSlides,
  FileTable,
  FileVideo,
  Icon,
  LearningTask,
  Link,
  Notice,
  Page,
  Pending,
  VideoLink,
  Warning,
  type GlazeIcon,
} from "@/components/glaze/icon";
import { cn } from "@/lib/glaze/utils";
import { spring } from "@/lib/neo/motion";
import { ago } from "@/lib/neo/time";
import { fetchFile, openItem, saveBlob } from "@/lib/neo/viewer";

/**
 * Small pieces the Work, Files and People sections share: what kind of file a thing is (a glyph and a colour per kind,
 * so a Word file and a PDF tell apart at a glance), a site's own icon for a link, a file's row, a section that folds, a
 * row that scrolls sideways with soft edges, and the line that says one side is still loading or could not be reached.
 * Where a thing came from (Compass, Connect or Canvas) is the source's own logo: components/brand/source-mark.tsx.
 */

export type Source = "compass" | "connect" | "canvas";
export const SOURCE: Record<Source, string> = { compass: "Compass", connect: "Connect", canvas: "Canvas" };

// ---------- kinds of file ----------

export type Kind = { icon: GlazeIcon; hue: number | null; label: string };

/** Each kind wears one of the class hues (brand.css data-hue), tuned per theme there; null is a neutral grey. */
const KINDS = {
  word: { icon: Document, hue: 8, label: "Word document" },
  pdf: { icon: FilePdf, hue: 0, label: "PDF" },
  slides: { icon: FileSlides, hue: 1, label: "Slides" },
  sheet: { icon: FileTable, hue: 4, label: "Spreadsheet" },
  data: { icon: FileDatabase, hue: 9, label: "Database" },
  image: { icon: FileImage, hue: 11, label: "Image" },
  video: { icon: FileVideo, hue: 10, label: "Video" },
  audio: { icon: FileAudio, hue: 5, label: "Audio" },
  archive: { icon: FileArchive, hue: null, label: "Zip" },
  code: { icon: FileCode, hue: 6, label: "Code" },
  text: { icon: Document, hue: null, label: "Text" },
  file: { icon: DocumentBlank, hue: null, label: "File" },
  link: { icon: Link, hue: 7, label: "Link" },
  videoLink: { icon: VideoLink, hue: 0, label: "Video" },
  page: { icon: Page, hue: 5, label: "Page" },
  task: { icon: LearningTask, hue: null, label: "Submission" },
  talk: { icon: Notice, hue: null, label: "Discussion" },
} satisfies Record<string, Kind>;

export const imageKind: Kind = KINDS.image;
export const pageKind: Kind = KINDS.page;
export const taskKind: Kind = KINDS.task;
export const talkKind: Kind = KINDS.talk;

const EXT = new Map<string, Kind>();
for (const [kind, exts] of [
  ["word", "doc docx docm dot dotx odt rtf pages"],
  ["pdf", "pdf"],
  ["slides", "ppt pptx pptm pps ppsx odp key"],
  ["sheet", "xls xlsx xlsm csv ods numbers"],
  ["data", "accdb mdb db sqlite"],
  ["image", "png jpg jpeg gif webp heic bmp svg tif tiff"],
  ["video", "mp4 mov avi mkv webm m4v wmv"],
  ["audio", "mp3 wav m4a aac ogg flac"],
  ["archive", "zip rar 7z tar gz"],
  ["code", "html htm css js ts py java c cpp cs json xml ipynb sb3 gd php sql"],
  ["text", "txt md"],
] as const) {
  for (const ext of exts.split(" ")) EXT.set(ext, KINDS[kind]);
}

export const extOf = (name: string | null | undefined) => /\.([a-z0-9]{1,5})$/i.exec(name ?? "")?.[1]?.toLowerCase() ?? null;

/** What a file is, from its name, or its mime type when the name says nothing. */
export function fileKind(name: string | null | undefined, mime?: string | null): Kind {
  const byExt = EXT.get(extOf(name) ?? "");
  if (byExt) return byExt;
  if (mime?.startsWith("image/")) return KINDS.image;
  if (mime?.startsWith("video/")) return KINDS.video;
  if (mime?.startsWith("audio/")) return KINDS.audio;
  if (mime === "application/pdf") return KINDS.pdf;
  if (mime?.startsWith("text/")) return KINDS.text;
  return KINDS.file;
}

/** A name without its extension, when the extension only says what the cover already does ("Probability.docx"). */
export function bareName(name: string) {
  const ext = extOf(name);
  return ext && EXT.has(ext) && name.length > ext.length + 1 ? name.slice(0, -(ext.length + 1)) : name;
}

export function hostOf(url: string | null | undefined) {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

const VIDEO_HOSTS = /(^|\.)(youtube\.com|youtu\.be|loom\.com|vimeo\.com|clickview\.com\.au|clickview\.net|edpuzzle\.com)$/i;

/** A link: a video (YouTube, Loom ...) or anything else. */
export function linkKind(url: string | null | undefined): Kind {
  const host = hostOf(url);
  return host && VIDEO_HOSTS.test(host) ? KINDS.videoLink : KINDS.link;
}

/** A link's name when a teacher pasted the address as its name: the address without its scheme. */
export function linkName(name: string) {
  return /^https?:\/\//i.test(name) ? name.replace(/^https?:\/\/(www\.)?/i, "").replace(/\/$/, "") : name;
}

/** A kind's glyph in its colour. */
export function KindGlyph({ kind, size = 20 }: { kind: Kind; size?: 16 | 20 | 24 }) {
  return (
    <span data-hue={kind.hue ?? undefined} className={cn("inline-grid shrink-0 place-items-center", kind.hue != null ? "neo-glyph" : "text-text-2")}>
      <Icon icon={kind.icon} size={size} />
    </span>
  );
}

/** A site's own icon (from its address), on a small white plate so dark icons show on the dark theme too. */
export function faviconUrl(host: string) {
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`;
}

export function Favicon({ url, size = 20 }: { url: string | null | undefined; size?: 20 | 32 }) {
  const host = hostOf(url);
  const [failed, setFailed] = useState(false);
  if (!host || failed) return <KindGlyph kind={linkKind(url)} size={size === 32 ? 24 : 20} />;
  return (
    <span className="neo-favicon" data-size={size}>
      <img src={faviconUrl(host)} alt="" width={size} height={size} loading="lazy" draggable={false} onError={() => setFailed(true)} />
    </span>
  );
}

/** "72 KB", "1.1 MB". */
export function sizeText(bytes: number | null | undefined) {
  if (bytes == null || !Number.isFinite(bytes)) return null;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  const mb = bytes / (1024 * 1024);
  return `${mb < 10 ? Math.round(mb * 10) / 10 : Math.round(mb)} MB`;
}

/**
 * A link's click opens it over the app (lib/neo/viewer.ts): a file or a video in the viewer, any other page in a new
 * tab. A click with a modifier (a new tab on purpose) or another button is left to the browser.
 */
export function opens(item: { href: string; name: string; source?: Source; mime?: string | null }) {
  return (e: React.MouseEvent) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    openItem(item);
  };
}

/** Saves a file where it is, the button turning while it comes; if it will not come, the viewer says why. */
export function SaveButton({ href, name, source }: { href: string; name: string; source?: Source }) {
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      const got = await fetchFile(href);
      saveBlob(got.blob, got.name ?? name);
    } catch {
      openItem({ href, name, source });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Button variant="ghost" size="icon-sm" pending={busy} onClick={() => void save()} aria-label={`Download ${name}`}>
      <Icon icon={Download} />
    </Button>
  );
}

/**
 * A file or a link as a row: its glyph (a link's site icon), its name (the whole row opens it: a file or a video in the
 * viewer, a page in a new tab), a line about it, and a download button for a file or a small arrow for a link. Rows
 * never wrap. Padding is the caller's.
 */
export function FileRow({
  name,
  href,
  external,
  kind,
  meta,
  lead,
  aside,
  file,
  source,
  mime,
  className,
}: {
  name: string;
  href: string | null;
  external: boolean;
  kind: Kind;
  meta: string | null;
  /** The file's own name (with its extension), for the viewer and a save; name when not given. */
  file?: string | null;
  source?: Source;
  mime?: string | null;
  /** In place of the glyph (a video's thumbnail). */
  lead?: React.ReactNode;
  /** Before the button (where it came from). */
  aside?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("neo-file relative flex min-w-0 items-center gap-3", className)}>
      {lead ?? (external ? <Favicon url={href} /> : <KindGlyph kind={kind} />)}
      <div className="min-w-0 flex-1">
        {href ? (
          <a
            href={href}
            target="_blank"
            rel="noreferrer noopener"
            onClick={opens({ href, name: file ?? name, source, mime })}
            className="neo-file-link block truncate type-label text-text-1"
          >
            {name}
          </a>
        ) : (
          <p className="truncate type-label text-text-2">{name}</p>
        )}
        <p className="truncate type-caption text-text-3">{meta ?? kind.label}</p>
      </div>
      {aside}
      {href && !external && <SaveButton href={href} name={file ?? name} source={source} />}
      {href && external && <Icon icon={ArrowUpRight} size={14} className="text-text-3" />}
    </div>
  );
}

// ---------- a section's label, without a card ----------

/** The label over a section whose content is not one card (a row of cards): the same look as Block's. */
export function SectionHead({ id, icon, title, aside }: { id: string; icon: GlazeIcon; title: string; aside?: React.ReactNode }) {
  return (
    <div className="mb-2 flex min-h-(--control-sm) items-center gap-1.5 ps-1">
      <Icon icon={icon} size={16} className="neo-section-glyph" />
      <h3 id={id} className="type-label text-text-1">
        {title}
      </h3>
      {aside && <div className="ms-auto flex items-center">{aside}</div>}
    </div>
  );
}

// ---------- rows that scroll sideways ----------

/**
 * Marks a sideways scroller's ends while there is more past them (data-fade-start, data-fade-end), so CSS can soften
 * those edges (neo-fade-x). Re-read when the scroller scrolls or resizes, and when deps change (what is in it).
 */
export function useEdgeFade<T extends HTMLElement>(deps: unknown[] = []) {
  const ref = useRef<T>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const mark = () => {
      const max = el.scrollWidth - el.clientWidth;
      el.toggleAttribute("data-fade-start", el.scrollLeft > 1);
      el.toggleAttribute("data-fade-end", el.scrollLeft < max - 1);
    };
    mark();
    el.addEventListener("scroll", mark, { passive: true });
    const ro = new ResizeObserver(mark);
    ro.observe(el);
    for (const child of el.children) ro.observe(child);
    return () => {
      el.removeEventListener("scroll", mark);
      ro.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return ref;
}

// ---------- folding ----------

/** A chevron that turns when what it belongs to opens. */
export function Chevron({ open }: { open: boolean }) {
  return (
    <motion.span animate={{ rotate: open ? 180 : 0 }} transition={spring.fold} className="inline-grid shrink-0 text-text-3">
      <Icon icon={ChevronDown} size={16} />
    </motion.span>
  );
}

/** What a folder or a folded section holds, opening and shutting quickly. */
export function Fold({ open, children }: { open: boolean; children: React.ReactNode }) {
  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={spring.fold}
          className="overflow-hidden"
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/**
 * A secondary section tucked away: one card whose first row names it (with a count) and opens it. For lists that are
 * worth keeping but should never lead (work already handed in, lesson plans).
 */
export function FoldBlock({
  icon,
  title,
  count,
  open,
  onToggle,
  children,
}: {
  icon: GlazeIcon;
  title: string;
  count?: number;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <section className="neo-stack neo-notice">
      <h3>
        {/* eslint-disable-next-line glaze/no-native-control -- the section's own heading row opens it: a Glaze Button would draw a pill inside the card */}
        <button type="button" aria-expanded={open} onClick={onToggle} className="neo-row-button flex w-full items-center gap-2 px-3.5 py-3 text-start">
          <Icon icon={icon} size={16} className="neo-section-glyph" />
          <span className="min-w-0 flex-1 truncate type-label text-text-1">{title}</span>
          {count != null && <span className="neo-tabular shrink-0 type-label-sm text-text-3">{count}</span>}
          <Chevron open={open} />
        </button>
      </h3>
      <Fold open={open}>
        <div className="border-t border-line-faint">{children}</div>
      </Fold>
    </section>
  );
}

// ---------- the state of each side ----------

/** A side (Compass or Connect) as the server keeps it, without its data. */
export type SideState =
  | { status: "none" }
  | { status: "missing" }
  | { status: "unavailable"; reason: string }
  | { status: "ready"; fetchedAt: number; error: string | null };

/**
 * One quiet line per side that is not plainly there: still on its way, refused, or kept from an earlier fetch because
 * the last one failed. Nothing at all when both sides are fine.
 */
export function SideNotes({ sides, what, now }: { sides: Array<[Source, SideState]>; what: Record<Source, string>; now: number }) {
  const lines = sides.flatMap(([source, side]) => {
    if (side.status === "missing")
      return [
        <p key={source} role="status" className="flex items-center gap-2 type-caption text-text-2">
          <Icon icon={Pending} size={14} className="animate-spin text-neo-text motion-reduce:animate-none" />
          Getting {what[source]} from {SOURCE[source]}
        </p>,
      ];
    if (side.status === "unavailable")
      return [
        <p key={source} className="flex items-start gap-2 type-caption text-text-2">
          <Icon icon={Warning} size={14} className="mt-px text-warn-text" />
          <span className="min-w-0">
            {SOURCE[source]}: {side.reason}
          </span>
        </p>,
      ];
    if (side.status === "ready" && side.error)
      return [
        <p key={source} className="flex items-start gap-2 type-caption text-text-2">
          <Icon icon={Warning} size={14} className="mt-px text-warn-text" />
          <span className="min-w-0">
            {SOURCE[source]} did not answer just now, so this is from {ago(side.fetchedAt, now)}.
          </span>
        </p>,
      ];
    return [];
  });
  if (!lines.length) return null;
  return <div className="flex flex-col gap-1.5 px-1">{lines}</div>;
}
