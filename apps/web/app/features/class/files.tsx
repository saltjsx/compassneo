import { useCallback, useMemo, useRef, useState } from "react";
import { SourceMark } from "@/components/brand/source-mark";
import { Button } from "@/components/glaze/ui/button";
import { Input } from "@/components/glaze/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/glaze/ui/tooltip";
import { Check, Download, Folder, FolderOpen, Icon, Library, NoResults, Page, Pending, Play, Sparkle, Sync } from "@/components/glaze/icon";
import { cn } from "@/lib/glaze/utils";
import { dayName } from "@/lib/neo/days";
import { ago } from "@/lib/neo/time";
import { useClassResources, useResourcePage, type ClassResources, type ResourceNode, type ResourceSide } from "@/lib/neo/resources";
import { downloadAll } from "@/lib/neo/viewer";
import type { PlanBlock } from "@/lib/neo/plans";
import { Block, PlanText, SkeletonBlock } from "./sections";
import {
  Chevron,
  Favicon,
  FileRow,
  Fold,
  FoldBlock,
  KindGlyph,
  SideNotes,
  bareName,
  fileKind,
  hostOf,
  linkKind,
  linkName,
  pageKind,
  sizeText,
  talkKind,
  taskKind,
  type Kind,
  type Source,
} from "./kit";

/**
 * Files: the class's library, in the panel's own language: rows in grouped blocks. Compass's Resources and Connect's
 * Learning Content are one collection. What is new leads (a few rows; Connect dates its content, Compass does not, so
 * those are Connect's for now). Then the class's folders, rows in one block that open in place to what they hold, a
 * row each, with the folders inside as small headings; expanded on a wide screen, those rows sit two to a line.
 * Compass's folder of lesson plans (every class has one, mostly empty pages) waits at the bottom, shut. A search finds
 * anything by its name or its folder's.
 *
 * Each thing shows what it is: a YouTube video its own thumbnail, another link its site's icon, a file its kind's glyph
 * in the kind's colour. Where a thing came from is the source's small logo, and only where both sides are shown
 * together: on each folder's row, and on the rows of a search or of New when they mix.
 *
 * Nothing takes the tab away: a file or a video opens in the viewer over the app, a file's download saves in place, and
 * many files come as one zip (lib/neo/viewer.ts): a folder's "Download all", or the files picked in Select.
 */

type Node = ResourceNode;
type Leaf = { node: Node; trail: Node[] };
type Plan = { node: Node; label: string };

type Lib = {
  /** Folders in order (loose files sit in a folder of their own), without the lesson plans and empty folders. */
  roots: Node[];
  /** Every page in the lesson plans folder, newest first, named by its lesson. */
  plans: Plan[];
  leaves: Leaf[];
  /** Each folder by its key: everything in it, at any depth. */
  index: Map<string, Leaf[]>;
  /** Both sides have something. */
  both: boolean;
  /** The newest things with a date, newest first. */
  fresh: Leaf[];
};

/** The files picked in Select, by key, each with the folders it is in (the zip keeps them). */
type Picking = { picked: Map<string, Leaf>; toggle: (l: Leaf) => void } | null;

type Ctx = { token: string; today: string; both: boolean; picking: Picking };

const MONTH = 30 * 86400000;
const FRESH_MAX = 6;
const PLANS_SHOWN = 15;

const isFolder = (n: Node) => n.kind === "folder";

const folderOf = (key: string, name: string, source: Node["source"], children: Node[]): Node => ({
  key,
  name,
  kind: "folder",
  source,
  href: null,
  external: false,
  fileName: null,
  mime: null,
  size: null,
  by: null,
  at: null,
  page: null,
  children,
});

/** A YouTube video's id, from a watch, shorts, embed or youtu.be link; null for a playlist or anything else. */
function youtubeId(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^(www|m|music)\./, "");
    const ok = (id: string | null | undefined) => (id && /^[\w-]{11}$/.test(id) ? id : null);
    if (host === "youtu.be") return ok(u.pathname.slice(1).split("/")[0]);
    if (host === "youtube.com" || host === "youtube-nocookie.com") {
      if (u.pathname === "/watch") return ok(u.searchParams.get("v"));
      return ok(/^\/(?:shorts|embed|live|v)\/([\w-]{11})/.exec(u.pathname)?.[1]);
    }
  } catch {
    return null;
  }
  return null;
}

function kindOfNode(n: Node): Kind {
  if (n.kind === "link") return linkKind(n.href);
  if (n.kind === "page") return pageKind;
  if (n.kind === "submission") return taskKind;
  if (n.kind === "discussion") return talkKind;
  return fileKind(n.fileName ?? n.name, n.mime);
}

/** A thing's name as a row shows it: a file without its extension, a pasted address without its scheme. */
const titleOf = (n: Node) => (n.kind === "file" ? bareName(n.name) : n.kind === "link" ? linkName(n.name) : n.name);

/** "LP: 11/02/2026 - 08:50 AM", as Compass names a lesson plan: its day and time, if the name has them. */
const LP_NAME = /(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\D+(\d{1,2}):(\d{2})\s*([AP]M)?)?/i;

function planOf(node: Node, today: string): Plan & { sort: string } {
  const m = LP_NAME.exec(node.name);
  if (!m) return { node, label: node.name, sort: "" };
  const day = `${m[3]}-${m[2]!.padStart(2, "0")}-${m[1]!.padStart(2, "0")}`;
  if (!m[4]) return { node, label: dayName(day, today), sort: day };
  let h = Number(m[4]);
  const half = m[6]?.toLowerCase();
  if (half === "pm" && h < 12) h += 12;
  if (half === "am" && h === 12) h = 0;
  const time = `${Number(m[4])}:${m[5]}${half ? ` ${half}` : ""}`;
  return { node, label: `${dayName(day, today)} · ${time}`, sort: `${day}T${String(h).padStart(2, "0")}:${m[5]}` };
}

function build(res: ClassResources | null | undefined, today: string): Lib {
  const plans: Node[] = [];
  const takePages = (n: Node) => {
    if (n.kind === "page") plans.push(n);
    n.children.forEach(takePages);
  };
  // Lesson plans go to their own list; folders with nothing in them go.
  const strip = (nodes: Node[]): Node[] =>
    nodes.flatMap(n => {
      if (n.lessonPlans) {
        takePages(n);
        return [];
      }
      if (!isFolder(n)) return [n];
      const children = strip(n.children);
      return children.length ? [{ ...n, children }] : [];
    });
  const sideOf = (side: ResourceSide | undefined, source: Node["source"]): Node[] => {
    if (side?.status !== "ready") return [];
    const nodes = strip(side.data);
    const loose = nodes.filter(n => !isFolder(n));
    const folders = nodes.filter(isFolder);
    return loose.length ? [folderOf(`${source}:loose`, "Loose files", source, loose), ...folders] : folders;
  };
  const compass = sideOf(res?.compass, "compass");
  const connect = sideOf(res?.connect, "connect");
  const canvas = sideOf(res?.canvas, "canvas");

  const index: Lib["index"] = new Map();
  const leaves: Leaf[] = [];
  const walk = (n: Node, trail: Node[]): Leaf[] => {
    if (!isFolder(n)) {
      const leaf = { node: n, trail };
      leaves.push(leaf);
      return [leaf];
    }
    const mine = n.children.flatMap(c => walk(c, [...trail, n]));
    index.set(n.key, mine);
    return mine;
  };
  const sum = (nodes: Node[]) => nodes.reduce((a, n) => a + walk(n, []).length, 0);
  // The bigger library leads; each keeps its teacher's order.
  const libraries = [compass, connect, canvas].map(nodes => ({ nodes, count: sum(nodes) })).sort((a, b) => b.count - a.count);
  const roots = libraries.flatMap(l => l.nodes);

  const now = Date.now();
  const fresh = leaves
    .filter(l => l.node.at && l.node.kind !== "page" && now - Date.parse(l.node.at) < MONTH)
    .sort((a, b) => Date.parse(b.node.at!) - Date.parse(a.node.at!))
    .slice(0, FRESH_MAX);

  return {
    roots,
    plans: plans
      .map(p => planOf(p, today))
      .sort((a, b) => b.sort.localeCompare(a.sort))
      .map(({ node, label }) => ({ node, label })),
    leaves,
    index,
    both: libraries.filter(l => l.count > 0).length > 1,
    fresh,
  };
}

/** Every word of the search in the thing's name, its file's name or its folders' names. */
function search(lib: Lib, q: string): Leaf[] {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const hit = (text: string) => {
    const t = text.toLowerCase();
    return words.every(w => t.includes(w));
  };
  const leaves = lib.leaves.filter(l => hit([l.node.name, l.node.fileName ?? "", ...l.trail.map(f => f.name)].join(" ")));
  const plans = lib.plans.filter(p => hit(`${p.label} ${p.node.name} lesson plans`));
  return [...leaves, ...plans.map(p => ({ node: { ...p.node, name: p.label }, trail: [folderOf("@plans", "Lesson plans", "compass", [])] }))];
}

/** Canvas's own things, which open on Canvas: what they are, in place of the school's Canvas address. */
const ON_CANVAS: Partial<Record<Node["kind"], string>> = { page: "Canvas page", submission: "Canvas assignment", discussion: "Canvas discussion" };

/** A row's quiet line: a link's site; else where it is (in New and a search) or what it is (in its folder). */
function lineOf(l: Leaf, how: "where" | "what") {
  const n = l.node;
  if (n.kind === "link") return hostOf(n.href) ?? "Link";
  const canvas = n.source === "canvas" ? ON_CANVAS[n.kind] : undefined;
  if (canvas) return how === "where" && l.trail.length ? `${canvas} · ${l.trail[l.trail.length - 1]!.name}` : canvas;
  const folder = l.trail[l.trail.length - 1];
  if (how === "where" && folder) return folder.name;
  return [kindOfNode(n).label, sizeText(n.size)].filter(Boolean).join(" · ");
}

/** Things shown together come from both sides, so each shows where it came from. */
const mixed = (leaves: Leaf[]) => new Set(leaves.map(l => l.node.source)).size > 1;

/** A folder's things in groups: its own first, then each folder inside it (at any depth) under its path. */
function groupsOf(node: Node) {
  const out: Array<{ key: string; path: string[]; leaves: Leaf[] }> = [];
  const walk = (n: Node, trail: Node[]) => {
    const leaves = n.children.filter(c => !isFolder(c));
    if (leaves.length) out.push({ key: n.key, path: trail.slice(1).map(f => f.name), leaves: leaves.map(c => ({ node: c, trail })) });
    for (const f of n.children.filter(isFolder)) walk(f, [...trail, f]);
  };
  walk(node, [node]);
  return out;
}

/** A thing that can go in a zip: a file Compass Neo can fetch. */
const isFile = (n: Node) => n.kind === "file" && !!n.href;

/** Files for downloadAll: each with its own name and the folders it sits in, from `from` down (the zip's folders). */
const zipItems = (leaves: Leaf[], from = 0) =>
  leaves.filter(l => isFile(l.node)).map(l => ({ href: l.node.href!, name: l.node.fileName ?? l.node.name, source: l.node.source, path: l.trail.slice(from).map(f => f.name) }));

// ---------- the page ----------

export function FilesPage({
  token,
  code,
  title,
  today,
  now,
  wide,
}: {
  token: string;
  code: string;
  title: string;
  today: string;
  now: number;
  /** Maximised: the library and its search on the left, what is new and the lesson plans down the side. */
  wide?: boolean;
}) {
  const { data, refresh, refreshing } = useClassResources(token, code);
  const lib = useMemo(() => build(data, today), [data, today]);
  const [q, setQ] = useState("");
  const [opened, setOpened] = useState<Set<string> | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<Map<string, Leaf>>(() => new Map());

  if (data === null) return null;
  const sides: Array<[Source, ResourceSide]> = data
    ? [
        ["compass", data.compass],
        ["connect", data.connect],
        ["canvas", data.canvas],
      ]
    : [];
  const ready = sides.filter(([, s]) => s.status === "ready");
  const waiting = !data || (!ready.length && sides.some(([, s]) => s.status === "missing"));
  const toggleLeaf = (l: Leaf) =>
    setPicked(m => {
      const next = new Map(m);
      if (next.has(l.node.key)) next.delete(l.node.key);
      else next.set(l.node.key, l);
      return next;
    });
  const ctx: Ctx = { token, today, both: lib.both, picking: selecting ? { picked, toggle: toggleLeaf } : null };
  const total = lib.leaves.length;
  const files = lib.leaves.filter(l => isFile(l.node)).length;

  // A class with a single folder has it open; more start shut.
  const open = opened ?? new Set(lib.roots.length === 1 ? [lib.roots[0]!.key] : []);
  const toggle = (key: string) =>
    setOpened(() => {
      const s = new Set(open);
      if (s.has(key)) s.delete(key);
      else s.add(key);
      return s;
    });
  const updated = ready.length ? Math.max(...ready.map(([, s]) => (s.status === "ready" ? s.fetchedAt : 0))) : null;

  const toolbar = (
    <div className="flex items-center gap-2">
      <Input
        mode="search"
        aria-label="Search files"
        placeholder={total ? `Search ${total} ${total === 1 ? "item" : "items"}` : "Search files"}
        value={q}
        onValueChange={setQ}
        disabled={!total && !lib.plans.length}
        className="min-w-0 flex-1"
      />
      {files > 1 && (
        <Button variant="ghost" onClick={() => setSelecting(s => !s)} aria-pressed={selecting}>
          {selecting ? "Done" : "Select"}
        </Button>
      )}
      <Tooltip>
        <TooltipTrigger
          render={<Button variant="ghost" size="icon" pending={refreshing} onClick={() => void refresh().catch(() => {})} aria-label="Refresh files" />}
        >
          <Icon icon={Sync} />
        </TooltipTrigger>
        <TooltipContent side="bottom">{updated ? `Updated ${ago(updated, now)}. Refresh` : "Refresh"}</TooltipContent>
      </Tooltip>
    </div>
  );
  const notes = <SideNotes sides={sides} what={{ compass: "resources", connect: "learning content", canvas: "files" }} now={now} />;
  const selectBar = selecting && (
    <div role="status" className="flex min-h-(--control) items-center gap-2 ps-1">
      <span className="min-w-0 flex-1 truncate type-label-sm text-text-2">{picked.size ? `${picked.size} picked` : "Pick files to download together"}</span>
      {picked.size > 0 && (
        <Button variant="ghost" size="sm" onClick={() => setPicked(new Map())}>
          Clear
        </Button>
      )}
      <Button variant="secondary" size="sm" disabled={!picked.size} onClick={() => void downloadAll(zipItems([...picked.values()]), `${title} - Files`)}>
        <Icon icon={Download} />
        Download {picked.size || ""}
      </Button>
    </div>
  );

  if (waiting)
    return (
      <>
        {toolbar}
        <SkeletonBlock rows={[40, 40, 40, 40, 40]} />
      </>
    );

  if (!total && !lib.plans.length)
    return (
      <>
        {toolbar}
        {notes}
        {sides.every(([, s]) => s.status === "ready" || s.status === "none") && (
          <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
            <Icon icon={Library} size={32} className="text-text-3" />
            <p className="type-label text-text-2">No resources for this class yet</p>
          </div>
        )}
      </>
    );

  const results = q.trim() ? search(lib, q) : null;
  return (
    <>
      {toolbar}
      {selectBar}
      {notes}
      {results ? (
        <Results hits={results} q={q} ctx={ctx} />
      ) : (
        <>
          {lib.fresh.length > 0 && (
            <Block icon={Sparkle} title="New" className="p-1.5">
              <Rows leaves={lib.fresh} ctx={ctx} how="where" />
            </Block>
          )}
          {lib.roots.length > 0 && (
            <Block icon={Folder} title="Folders">
              {lib.roots.map(f => (
                <FolderRow key={f.key} node={f} lib={lib} ctx={ctx} title={title} open={open.has(f.key)} onToggle={() => toggle(f.key)} />
              ))}
            </Block>
          )}
          {lib.plans.length > 0 && <PlansBlock lib={lib} ctx={ctx} />}
        </>
      )}
    </>
  );
}

// ---------- rows ----------

/** A video's own thumbnail, small, with a play mark; its site's icon if it does not load. */
function Thumb({ id, url }: { id: string; url: string | null }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <Favicon url={url} />;
  return (
    <span className="neo-thumb">
      <img src={`https://i.ytimg.com/vi/${id}/mqdefault.jpg`} alt="" loading="lazy" draggable={false} onError={() => setFailed(true)} />
      <span aria-hidden>
        <Icon icon={Play} size={12} />
      </span>
    </span>
  );
}

/**
 * Things as rows: one column in the narrow panel, two expanded. A list with a video in it gives every row the
 * thumbnail's room, so the names line up.
 */
function Rows({ leaves, ctx, how }: { leaves: Leaf[]; ctx: Ctx; how: "where" | "what" }) {
  const marks = ctx.both && mixed(leaves);
  const thumbs = leaves.some(l => l.node.kind === "link" && youtubeId(l.node.href));
  return (
    <div className="neo-rows">
      {leaves.map(l => {
        const n = l.node;
        const mark = marks ? <SourceMark source={n.source} size={14} /> : undefined;
        // A Compass page opens in place; a Canvas page (nothing to read here) is a row that opens on Canvas.
        if (n.kind === "page" && n.source !== "canvas") return <PageItem key={n.key} node={n} title={n.name} meta={lineOf(l, how)} ctx={ctx} aside={mark} wide={thumbs} />;
        const yt = n.kind === "link" ? youtubeId(n.href) : null;
        const glyph = yt ? <Thumb id={yt} url={n.href} /> : n.kind === "link" ? <Favicon url={n.href} /> : <KindGlyph kind={kindOfNode(n)} />;
        const lead = thumbs ? <span className="neo-lead">{glyph}</span> : glyph;
        if (ctx.picking && isFile(n)) return <PickRow key={n.key} leaf={l} lead={lead} meta={lineOf(l, how)} picking={ctx.picking} />;
        return (
          <FileRow
            key={n.key}
            name={titleOf(n)}
            href={n.href}
            external={n.external}
            kind={kindOfNode(n)}
            meta={lineOf(l, how)}
            lead={lead}
            aside={mark}
            file={n.fileName ?? n.name}
            source={n.source}
            mime={n.mime}
            wrap
            className="rounded-tag px-2.5 py-2"
          />
        );
      })}
    </div>
  );
}

/** A file in Select: the whole row picks it (or puts it back), with a box that says which. */
function PickRow({ leaf, lead, meta, picking }: { leaf: Leaf; lead: React.ReactNode; meta: string; picking: NonNullable<Picking> }) {
  const on = picking.picked.has(leaf.node.key);
  return (
    // eslint-disable-next-line glaze/no-native-control -- a whole list row that picks its file: a Glaze Checkbox is not installed here, and the row is the target
    <button
      type="button"
      role="checkbox"
      aria-checked={on}
      onClick={() => picking.toggle(leaf)}
      className="neo-row-button flex w-full min-w-0 items-center gap-3 rounded-tag px-2.5 py-2 text-start"
    >
      <span className="neo-check" data-on={on || undefined} aria-hidden>
        {on && <Icon icon={Check} size={12} />}
      </span>
      {lead}
      <span className="min-w-0 flex-1">
        <span className="line-clamp-2 type-label text-text-1 [overflow-wrap:anywhere]">{titleOf(leaf.node)}</span>
        <span className="block truncate type-caption text-text-3">{meta}</span>
      </span>
    </button>
  );
}

function FolderRow({ node, lib, ctx, title, open, onToggle }: { node: Node; lib: Lib; ctx: Ctx; title: string; open: boolean; onToggle: () => void }) {
  const inside = lib.index.get(node.key) ?? [];
  const count = inside.length;
  const files = inside.filter(l => isFile(l.node)).length;
  return (
    <div className="border-t border-line-faint first:border-t-0">
      {/* The folder's row opens it; "download all" sits at its end as a button of its own (a button can't hold
          another), so opening a folder never pushes its files down. */}
      <div className="neo-row-button relative flex min-w-0 items-center">
        {/* eslint-disable-next-line glaze/no-native-control -- a folder's whole row opens it: a Glaze Button would draw a pill inside the card */}
        <button type="button" aria-expanded={open} onClick={onToggle} className="flex min-w-0 flex-1 items-center gap-3 py-3 ps-3.5 pe-2 text-start focus-visible:focus-ring">
          <span className="neo-section-glyph inline-grid shrink-0">
            <Icon icon={open ? FolderOpen : Folder} size={20} />
          </span>
          <span className="min-w-0 flex-1 truncate type-label text-text-1">{node.name}</span>
          {ctx.both && <SourceMark source={node.source} size={14} />}
          <span className="neo-tabular w-6 shrink-0 text-end type-label-sm text-text-3">{count}</span>
        </button>
        {files > 1 && !ctx.picking ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="shrink-0"
                  aria-label={`Download all ${files} files in ${node.name}`}
                  onClick={() => void downloadAll(zipItems(inside, 1), `${title} - ${node.name}`)}
                />
              }
            >
              <Icon icon={Download} />
            </TooltipTrigger>
            <TooltipContent side="bottom">Download all {files}</TooltipContent>
          </Tooltip>
        ) : (
          <span aria-hidden className="size-(--control-sm) shrink-0" />
        )}
        {/* eslint-disable-next-line glaze/no-native-control -- the chevron is part of the row's toggle, kept clickable on its own */}
        <button type="button" tabIndex={-1} aria-hidden onClick={onToggle} className="grid shrink-0 place-items-center py-3 ps-1 pe-3.5">
          <Chevron open={open} />
        </button>
      </div>
      <Fold open={open}>
        <div className="flex flex-col gap-1 ps-9 pe-1.5 pb-2.5">
          {groupsOf(node).map(g => (
            <div key={g.key}>
              {g.path.length > 0 && (
                <p className="flex min-w-0 items-center gap-1.5 px-2.5 pt-2 pb-1 type-label-sm text-text-2">
                  <Icon icon={Folder} size={14} className="text-text-3" />
                  <span className="min-w-0 truncate">{g.path.join(" › ")}</span>
                </p>
              )}
              <Rows leaves={g.leaves} ctx={ctx} how="what" />
            </div>
          ))}
        </div>
      </Fold>
    </div>
  );
}

function Results({ hits, q, ctx }: { hits: Leaf[]; q: string; ctx: Ctx }) {
  if (!hits.length)
    return (
      <div className="flex flex-col items-center gap-2 px-6 py-8 text-center">
        <Icon icon={NoResults} size={24} className="text-text-3" />
        <p className="type-label text-text-2">Nothing called “{q.trim()}”</p>
      </div>
    );
  return (
    <section aria-label="Search results">
      <p role="status" className="mb-2 px-1 type-label-sm text-text-2">
        {hits.length} {hits.length === 1 ? "result" : "results"}
      </p>
      <div className="neo-stack neo-notice p-1.5">
        <Rows leaves={hits} ctx={ctx} how="where" />
      </div>
    </section>
  );
}

// ---------- Compass pages ----------

/** Pages fetched this session, by asset, so opening one again shows it at once. */
const pageText = new Map<string, PlanBlock[]>();

/** A Compass page's text: fetched when first asked for, kept for the session. */
function usePageText(node: Node, token: string) {
  const load = useResourcePage();
  const id = node.page?.fileAssetId ?? node.key;
  const [blocks, setBlocks] = useState<PlanBlock[] | "failed" | null>(() => pageText.get(id) ?? null);
  const asking = useRef(false);
  const ask = useCallback(() => {
    const p = node.page;
    if (!p || asking.current || pageText.has(id)) return;
    asking.current = true;
    setBlocks(null);
    load({ token, fileAssetId: p.fileAssetId, nodeId: p.nodeId })
      .then(
        r => {
          if (r.ok) {
            pageText.set(id, r.blocks);
            setBlocks(r.blocks);
          } else setBlocks("failed");
        },
        () => setBlocks("failed"),
      )
      .finally(() => (asking.current = false));
  }, [node.page, id, token, load]);
  return { blocks, ask };
}

/** A Compass page (a lesson plan, a page a teacher wrote) as a row that opens to its text, the width of its list. */
function PageItem({
  node,
  title,
  meta,
  ctx,
  aside,
  wide,
  className = "rounded-tag px-2.5 py-2",
}: {
  node: Node;
  title: string;
  meta: string;
  ctx: Ctx;
  aside?: React.ReactNode;
  /** The list gives its rows a thumbnail's room. */
  wide?: boolean;
  className?: string;
}) {
  const { blocks, ask } = usePageText(node, ctx.token);
  const [open, setOpen] = useState(false);
  const toggle = () => {
    if (!open && (blocks == null || blocks === "failed")) ask();
    setOpen(o => !o);
  };
  const glyph = <KindGlyph kind={pageKind} />;
  return (
    <div className={cn("min-w-0", open && "neo-span-all")}>
      {/* eslint-disable-next-line glaze/no-native-control -- a whole row that opens the page: a Glaze Button would draw a pill inside the list */}
      <button type="button" aria-expanded={open} onClick={toggle} className={cn("neo-row-button flex w-full min-w-0 items-center gap-3 text-start", className)}>
        {wide ? <span className="neo-lead">{glyph}</span> : glyph}
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 type-label text-text-1 [overflow-wrap:anywhere]">{title}</p>
          <p className="truncate type-caption text-text-3">{meta}</p>
        </div>
        {aside}
        <Chevron open={open} />
      </button>
      <Fold open={open}>
        <div className="ps-11 pe-4 pt-1 pb-3.5">
          {blocks === null ? (
            <p role="status" className="flex items-center gap-2 type-body-sm text-text-2">
              <Icon icon={Pending} size={14} className="animate-spin text-neo-text motion-reduce:animate-none" />
              Opening the page
            </p>
          ) : blocks === "failed" ? (
            <p className="type-body-sm text-text-2">Compass did not send this page. Close it and open it again to retry.</p>
          ) : blocks.length ? (
            <PlanText blocks={blocks} />
          ) : (
            <p className="type-body-sm text-text-3">Nothing written on this page.</p>
          )}
        </div>
      </Fold>
    </div>
  );
}

function PlansBlock({ lib, ctx }: { lib: Lib; ctx: Ctx }) {
  const [open, setOpen] = useState(false);
  const [shown, setShown] = useState(PLANS_SHOWN);
  const more = Math.min(30, lib.plans.length - shown);
  return (
    <FoldBlock icon={Page} title="Lesson plans" count={lib.plans.length} open={open} onToggle={() => setOpen(o => !o)}>
      {lib.plans.slice(0, shown).map(p => (
        <div key={p.node.key} className="border-t border-line-faint first:border-t-0">
          <PageItem node={p.node} title={p.label} meta={p.node.by ?? "Lesson plan"} ctx={ctx} className="px-3.5 py-2.5" />
        </div>
      ))}
      {more > 0 && (
        <div className="border-t border-line-faint px-2 py-1.5">
          <Button variant="ghost" size="sm" onClick={() => setShown(s => s + 30)}>
            Show {more} more
          </Button>
        </div>
      )}
    </FoldBlock>
  );
}
