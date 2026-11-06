import { useState } from "react";
import { Button } from "@/components/glaze/ui/button";
import { CopyButton } from "@/components/glaze/ui/copy-button";
import { Bot, Icon } from "@/components/glaze/icon";
import { useAiControls, useAiLink } from "@/lib/neo/mcp";
import { signOutNotice } from "@/lib/neo/session";
import { InlineConfirm } from "./inline-confirm";

/**
 * AI access, on the settings page: off, a way to turn it on; on, the link to paste into an AI app (an MCP server's
 * address, convex/mcp.ts), where to paste it, and a way to turn it off (which ends the link, so it asks first; turning
 * it on again makes a new one).
 */
export function AiAccess({ token }: { token: string }) {
  const link = useAiLink(token);
  const { enable, disable } = useAiControls();
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!link) return null;

  const turnOn = () => {
    setBusy(true);
    setError(null);
    void enable({ token })
      .then(r => {
        if (r.ok) return;
        if (r.code === "signed-out" || r.code === "password-changed") signOutNotice.set(r.message);
        else setError(r.message);
      })
      .catch(() => setError("That did not work. Try again."))
      .finally(() => setBusy(false));
  };
  const turnOff = () => {
    setBusy(true);
    void disable({ token })
      .catch(() => {})
      .finally(() => {
        setBusy(false);
        setConfirming(false);
      });
  };

  return (
    <section aria-labelledby="ai-title" className="neo-stack neo-notice flex flex-col gap-3 p-4">
      <div className="flex items-start gap-2.5">
        <Icon icon={Bot} className="mt-0.5 text-text-2" />
        <div className="min-w-0 flex-1">
          <h2 id="ai-title" className="type-label text-text-1">
            AI access
          </h2>
          <p className="type-caption text-text-2">
            {link.url
              ? "In Claude, open Settings, then Connectors, choose Add custom connector and paste this link. Any app that takes an MCP server works."
              : "Let Claude or another AI app read your timetable, classes, work, grades, attendance and notices. It can look, but it cannot hand anything in or change anything."}
          </p>
          {error && <p className="mt-1 type-caption text-warn-text">{error}</p>}
        </div>
      </div>
      {link.url ? (
        <>
          <CopyButton value={link.url} label="AI link" showLabel copyText="Copy link" variant="secondary" size="sm" />
          {confirming ? (
            <InlineConfirm
              question="Turn off AI access?"
              detail="Apps using the link can no longer read anything, and turning it on again makes a new link."
              confirm="Turn off AI access"
              pending={busy}
              onCancel={() => setConfirming(false)}
              onConfirm={turnOff}
            />
          ) : (
            <div className="flex items-center gap-2">
              <p className="min-w-0 flex-1 type-caption text-text-3">Anyone with the link can read your school data.</p>
              <Button size="sm" variant="ghost" onClick={() => setConfirming(true)} className="-me-2 shrink-0">
                Turn off
              </Button>
            </div>
          )}
        </>
      ) : (
        <Button size="sm" variant="secondary" pending={busy} pendingLabel="Making a link" onClick={turnOn}>
          <Icon icon={Bot} />
          Get an AI link
        </Button>
      )}
    </section>
  );
}
