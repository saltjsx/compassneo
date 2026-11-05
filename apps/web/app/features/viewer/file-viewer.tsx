import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { Button } from "@/components/glaze/ui/button";
import { Check, Close, DocumentBlank, Download, Failed, Icon, Pending } from "@/components/glaze/icon";
import { SourceMark } from "@/components/brand/source-mark";
import { useGlazeModal, useGlazePortal } from "@/lib/glaze/portal";
import { closeViewer, embedOf, fetchFile, saveBlob, useViewer, type Bundle, type ViewerItem } from "@/lib/neo/viewer";

/**
 * The viewer over the app (lib/neo/viewer.ts): a file from Compass or Connect, fetched with a spinner and shown in
 * place when the browser can show it, else offered to save; a YouTube or Loom video playing; or a zip of many files
 * being made, file by file. Escape, the close button or a press on the scrim closes it; nothing leaves the tab.
 */
export function FileViewer() {
  const state = useViewer();
  const container = useGlazePortal();
  const open = !!state;
  useGlazeModal(open);
  const back = useRef<HTMLElement | null>(null);
  const close = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    back.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    requestAnimationFrame(() => close.current?.focus({ preventScroll: true }));
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        closeViewer();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      back.current?.focus({ preventScroll: true });
    };
  }, [open]);

  if (!container) return null;
  return createPortal(
    <AnimatePresence>
      {state && (
        <motion.div
          key="viewer"
          className="neo-viewer-scrim"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16 }}
          onMouseDown={e => {
            if (e.target === e.currentTarget) closeViewer();
          }}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="neo-viewer-title"
            className="neo-viewer"
            data-kind={state.kind}
            initial={{ opacity: 0, scale: 0.98, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98, y: 8 }}
            transition={{ duration: 0.18, ease: [0.2, 0.8, 0.2, 1] }}
          >
            {state.kind === "item" ? <ItemView key={state.item.href} item={state.item} closeRef={close} /> : <BundleView bundle={state.bundle} closeRef={close} />}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    container,
  );
}

type Shown =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; url: string; blob: Blob; name: string; type: string };

const previewOf = (type: string, name: string) => {
  const t = type.toLowerCase();
  if (t.includes("pdf") || /\.pdf$/i.test(name)) return "pdf" as const;
  if (t.startsWith("image/")) return "image" as const;
  if (t.startsWith("video/")) return "video" as const;
  if (t.startsWith("audio/")) return "audio" as const;
  if (t.startsWith("text/plain")) return "text" as const;
  return null;
};

const sizeOf = (bytes: number) => (bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

function ItemView({ item, closeRef }: { item: ViewerItem; closeRef: React.RefObject<HTMLButtonElement | null> }) {
  const embed = embedOf(item.href);
  const [shown, setShown] = useState<Shown>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [text, setText] = useState<string | null>(null);

  useEffect(() => {
    if (embed) return;
    const abort = new AbortController();
    let url: string | null = null;
    setShown({ status: "loading" });
    fetchFile(item.href, abort.signal)
      .then(f => {
        const type = f.type || item.mime || "application/octet-stream";
        const blob = f.blob.type ? f.blob : new Blob([f.blob], { type });
        url = URL.createObjectURL(blob);
        setShown({ status: "ready", url, blob, name: f.name ?? item.name, type });
        if (previewOf(type, f.name ?? item.name) === "text") void blob.text().then(t => setText(t.slice(0, 200_000)));
      })
      .catch(e => {
        if (abort.signal.aborted) return;
        setShown({ status: "error", message: e instanceof Error && e.message ? e.message : "The file did not come." });
      });
    return () => {
      abort.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [item.href, item.mime, item.name, embed, attempt]);

  const name = shown.status === "ready" ? shown.name : item.name;
  const preview = shown.status === "ready" ? previewOf(shown.type, shown.name) : null;

  return (
    <>
      <Header
        title={name}
        source={item.source}
        closeRef={closeRef}
        action={
          shown.status === "ready" ? (
            <Button size="sm" variant="secondary" onClick={() => saveBlob(shown.blob, shown.name)}>
              <Icon icon={Download} size={16} />
              Save
            </Button>
          ) : null
        }
      />
      <div className="neo-viewer-body">
        {embed ? (
          <iframe
            src={embed}
            title={item.name}
            className="neo-viewer-frame"
            allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
            allowFullScreen
          />
        ) : shown.status === "loading" ? (
          <Centre>
            <Icon icon={Pending} size={32} className="animate-spin text-text-2 motion-reduce:animate-none" />
            <p className="type-label text-text-2">Getting it from {item.source === "connect" ? "Connect" : "Compass"}…</p>
          </Centre>
        ) : shown.status === "error" ? (
          <Centre>
            <Icon icon={Failed} size={32} className="text-text-3" />
            <p className="max-w-sm text-center type-label text-text-2">{shown.message}</p>
            <Button size="sm" variant="secondary" onClick={() => setAttempt(a => a + 1)}>
              Try again
            </Button>
          </Centre>
        ) : preview === "pdf" ? (
          <iframe src={shown.url} title={shown.name} className="neo-viewer-frame" />
        ) : preview === "image" ? (
          <div className="neo-viewer-media">
            <img src={shown.url} alt={shown.name} className="max-h-full max-w-full object-contain" />
          </div>
        ) : preview === "video" ? (
          <div className="neo-viewer-media">
            {/* eslint-disable-next-line jsx-a11y/media-has-caption -- a teacher's own video has no captions to give */}
            <video src={shown.url} controls autoPlay className="max-h-full max-w-full" />
          </div>
        ) : preview === "audio" ? (
          <Centre>
            {/* eslint-disable-next-line jsx-a11y/media-has-caption -- a teacher's own recording has no captions to give */}
            <audio src={shown.url} controls autoPlay />
          </Centre>
        ) : preview === "text" ? (
          <pre className="neo-viewer-text type-body-sm text-text-1">{text ?? ""}</pre>
        ) : (
          <Centre>
            <Icon icon={DocumentBlank} size={32} className="text-text-3" />
            <p className="max-w-sm truncate text-center type-label text-text-1">{shown.name}</p>
            <p className="type-caption text-text-3">{sizeOf(shown.blob.size)} · your browser can't show this one here</p>
            <Button size="sm" onClick={() => saveBlob(shown.blob, shown.name)}>
              <Icon icon={Download} size={16} />
              Save to your device
            </Button>
          </Centre>
        )}
      </div>
    </>
  );
}

function BundleView({ bundle, closeRef }: { bundle: Bundle; closeRef: React.RefObject<HTMLButtonElement | null> }) {
  const making = !bundle.blob && !bundle.error;
  const zipName = bundle.name.endsWith(".zip") ? bundle.name : `${bundle.name}.zip`;
  const share = bundle.total ? bundle.done / bundle.total : 0;
  return (
    <>
      <Header title={zipName} closeRef={closeRef} action={null} />
      <div className="neo-viewer-body">
        <Centre>
          {bundle.error ? (
            <>
              <Icon icon={Failed} size={32} className="text-text-3" />
              <p className="max-w-sm text-center type-label text-text-2">{bundle.error}</p>
            </>
          ) : making ? (
            <>
              <Icon icon={Pending} size={32} className="animate-spin text-text-2 motion-reduce:animate-none" />
              <p className="type-label text-text-1">
                {bundle.done < bundle.total ? `Getting ${bundle.done + 1} of ${bundle.total}` : "Zipping"}
              </p>
              <div
                className="neo-viewer-bar"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={bundle.total}
                aria-valuenow={bundle.done}
                // eslint-disable-next-line glaze/no-inline-style -- the share done is known only at runtime; the class reads it
                style={{ "--share": share } as React.CSSProperties}
              >
                <span />
              </div>
            </>
          ) : (
            <>
              <Icon icon={Check} size={32} className="text-ok-text" />
              <p className="type-label text-text-1">
                {bundle.total - bundle.failed.length} {bundle.total - bundle.failed.length === 1 ? "file" : "files"} saved as {zipName}
              </p>
              <Button size="sm" variant="secondary" onClick={() => bundle.blob && saveBlob(bundle.blob, zipName)}>
                <Icon icon={Download} size={16} />
                Save again
              </Button>
            </>
          )}
          {bundle.failed.length > 0 && (
            <div className="mt-2 w-full max-w-sm">
              <p className="type-caption text-text-3">Left out:</p>
              <ul className="mt-1 flex flex-col gap-0.5">
                {bundle.failed.slice(0, 6).map(f => (
                  <li key={f.name} className="truncate type-caption text-text-2" title={f.why}>
                    {f.name}
                  </li>
                ))}
                {bundle.failed.length > 6 && <li className="type-caption text-text-3">and {bundle.failed.length - 6} more</li>}
              </ul>
            </div>
          )}
        </Centre>
      </div>
    </>
  );
}

function Header({
  title,
  source,
  action,
  closeRef,
}: {
  title: string;
  source?: "compass" | "connect" | "canvas";
  action: React.ReactNode;
  closeRef: React.RefObject<HTMLButtonElement | null>;
}) {
  return (
    <header className="neo-viewer-head">
      {source && <SourceMark source={source} size={16} />}
      <h2 id="neo-viewer-title" className="min-w-0 flex-1 truncate type-label text-text-1">
        {title}
      </h2>
      {action}
      <Button ref={closeRef} variant="ghost" size="icon" aria-label="Close" onClick={closeViewer}>
        <Icon icon={Close} size={20} />
      </Button>
    </header>
  );
}

function Centre({ children }: { children: React.ReactNode }) {
  return <div className="flex h-full flex-col items-center justify-center gap-3 p-6">{children}</div>;
}
