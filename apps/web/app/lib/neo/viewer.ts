import { useSyncExternalStore } from "react";
import { zip, type Zippable } from "fflate";

/**
 * The file viewer (features/viewer): anything a class or a page links to opens over the app instead of taking the tab
 * away. A file from Compass or Connect (a Compass Neo /file link) is fetched with a spinner, then shown in place when
 * the browser can show it (PDF, image, video, audio, text) or offered to save; a YouTube or Loom link plays in it.
 * Any other web link still opens in a new tab: it is a page, not a file.
 *
 * Many files at once (a folder, a selection) download as one zip, fetched one after another with the progress in the
 * same viewer (downloadAll).
 */

export type ViewerItem = {
  /** A Compass Neo file link (convex/http.ts /file/...), or a web link. */
  href: string;
  name: string;
  /** Where it came from, for the little logo in the header. */
  source?: "compass" | "connect" | "canvas";
  /** The file's type when the caller knows it (Connect does); else it comes with the file. */
  mime?: string | null;
};

export type Bundle = {
  name: string;
  total: number;
  done: number;
  /** Files Compass or Connect would not give (with why), left out of the zip. */
  failed: Array<{ name: string; why: string }>;
  /** The zip, once made. */
  blob: Blob | null;
  error: string | null;
};

export type ViewerState = { kind: "item"; item: ViewerItem } | { kind: "bundle"; bundle: Bundle } | null;

let current: ViewerState = null;
const listeners = new Set<() => void>();
const set = (v: ViewerState) => {
  current = v;
  listeners.forEach(l => l());
};
let bundleRun = 0;

export const closeViewer = () => {
  bundleRun++;
  set(null);
};
export const useViewer = () =>
  useSyncExternalStore(
    l => (listeners.add(l), () => listeners.delete(l)),
    () => current,
    () => null,
  );

/** A Compass Neo file link (as opposed to a web page). */
export const isFileLink = (href: string) => /\/file\/[^/]+\.[^/]+\//.test(href);

/** The embed for a video site the viewer plays in place, if href is one. */
export function embedOf(href: string): string | null {
  try {
    const u = new URL(href);
    const host = u.hostname.replace(/^www\.|^m\./, "");
    if (host === "youtube.com" || host === "youtu.be") {
      const id = host === "youtu.be" ? u.pathname.slice(1) : u.pathname.startsWith("/shorts/") ? u.pathname.split("/")[2] : u.searchParams.get("v");
      if (id && /^[\w-]{6,20}$/.test(id)) return `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0`;
      const list = u.searchParams.get("list");
      if (list) return `https://www.youtube-nocookie.com/embed/videoseries?list=${encodeURIComponent(list)}`;
    }
    if (host === "loom.com") {
      const id = /\/(share|embed)\/([0-9a-f]{20,40})/.exec(u.pathname)?.[2];
      if (id) return `https://www.loom.com/embed/${id}`;
    }
  } catch {
    // Not a URL: nothing to embed.
  }
  return null;
}

/**
 * Opens something a class or page links to. A file or a video opens in the viewer; any other web link opens in a new
 * tab. Call it from a click handler (and preventDefault on the link), so the new tab is allowed.
 */
export function openItem(item: ViewerItem) {
  if (isFileLink(item.href) || embedOf(item.href)) return set({ kind: "item", item });
  window.open(item.href, "_blank", "noopener,noreferrer");
}

/** A file's bytes through Compass Neo's file route, with the name and type it came with. Throws the route's reason. */
export async function fetchFile(href: string, signal?: AbortSignal) {
  const res = await fetch(href, { signal });
  if (!res.ok) throw new Error((await res.text().catch(() => "")).trim() || `The file did not come (${res.status}).`);
  const blob = await res.blob();
  const cd = res.headers.get("content-disposition") ?? "";
  const star = /filename\*=UTF-8''([^;]+)/i.exec(cd)?.[1];
  const plain = /filename="([^"]+)"/i.exec(cd)?.[1];
  const name = star ? decodeURIComponent(star) : (plain ?? null);
  return { blob, name, type: res.headers.get("content-type") ?? blob.type };
}

/** Saves a blob as a file, without leaving the page. */
export function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** A name a zip (or a disk) takes: no slashes or reserved characters, and unique within the zip. */
const safeName = (n: string) => n.replace(/[\\/:*?"<>|]+/g, "-").trim() || "file";

/**
 * Downloads many files as one zip named zipName ("Maths - Worksheet.zip"). Each item's path inside the zip is its
 * folder path plus its name (path, optional). Web links are left out (a link is not a file). Progress shows in the
 * viewer; the zip is saved when it is made, and the viewer stays open with a summary.
 */
export async function downloadAll(items: Array<ViewerItem & { path?: string[] }>, zipName: string) {
  const files = items.filter(i => isFileLink(i.href));
  const run = ++bundleRun;
  const bundle: Bundle = { name: zipName, total: files.length, done: 0, failed: [], blob: null, error: null };
  const update = (patch: Partial<Bundle>) => {
    if (run !== bundleRun) return false;
    Object.assign(bundle, patch);
    set({ kind: "bundle", bundle: { ...bundle } });
    return true;
  };
  update({});
  if (!files.length) return void update({ error: "Nothing here to download: these are links, not files." });

  const entries: Zippable = {};
  const used = new Set<string>();
  for (const f of files) {
    if (run !== bundleRun) return;
    try {
      const got = await fetchFile(f.href);
      let name = safeName(got.name ?? f.name);
      const dir = (f.path ?? []).map(safeName).join("/");
      let full = dir ? `${dir}/${name}` : name;
      for (let n = 2; used.has(full.toLowerCase()); n++) {
        name = safeName((got.name ?? f.name).replace(/(\.[^.]+)?$/, ` (${n})$1`));
        full = dir ? `${dir}/${name}` : name;
      }
      used.add(full.toLowerCase());
      // Already-compressed kinds are stored as they are; the rest are deflated.
      const level = /\.(zip|png|jpe?g|gif|webp|mp4|mov|mp3|m4a|docx|xlsx|pptx|pdf)$/i.test(name) ? 0 : 6;
      entries[full] = [new Uint8Array(await got.blob.arrayBuffer()), { level }];
    } catch (e) {
      bundle.failed.push({ name: f.name, why: e instanceof Error ? e.message : "It did not come." });
    }
    if (!update({ done: bundle.done + 1 })) return;
  }
  if (!Object.keys(entries).length) return void update({ error: "None of these files would download." });
  const blob = await new Promise<Blob>((resolve, reject) =>
    zip(entries, (err, data) => (err ? reject(err) : resolve(new Blob([data as BlobPart], { type: "application/zip" })))),
  ).catch(() => null);
  if (!blob) return void update({ error: "The zip could not be made." });
  if (!update({ blob })) return;
  saveBlob(blob, zipName.endsWith(".zip") ? zipName : `${zipName}.zip`);
}
