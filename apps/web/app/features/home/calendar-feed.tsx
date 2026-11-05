import { useState } from "react";
import { Button } from "@/components/glaze/ui/button";
import { CopyButton } from "@/components/glaze/ui/copy-button";
import { Calendar, Icon } from "@/components/glaze/icon";
import { useCalendarControls, useCalendarLink, webcalOf } from "@/lib/neo/calendar";
import { signOutNotice } from "@/lib/neo/session";

/**
 * The calendar feed, in the profile card: off, a way to turn it on; on, a way to add it to the device's calendar
 * (webcal://, which a phone's calendar subscribes to), the link to paste elsewhere, and a way to turn it off (which ends
 * the link; turning it on again makes a new one).
 */
export function CalendarFeed({ token }: { token: string }) {
  const link = useCalendarLink(token);
  const { enable, disable } = useCalendarControls();
  const [busy, setBusy] = useState(false);
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
      .finally(() => setBusy(false));
  };

  return (
    <div className="mt-3 flex flex-col gap-2 border-t border-line-faint pt-3">
      <div className="flex items-start gap-2.5">
        <Icon icon={Calendar} className="mt-0.5 text-text-2" />
        <div className="min-w-0 flex-1">
          <p className="type-label-sm text-text-1">Calendar</p>
          <p className="type-caption text-text-2">
            {link.url
              ? "Your timetable, assemblies and due dates, kept up to date in your own calendar."
              : "Put your timetable, assemblies and due dates in your phone's calendar."}
          </p>
          {error && <p className="mt-1 type-caption text-warn-text">{error}</p>}
        </div>
      </div>
      {link.url ? (
        <>
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" className="flex-1" onClick={() => (window.location.href = webcalOf(link.url!))}>
              Add to calendar
            </Button>
            <CopyButton value={link.url} label="Calendar link" showLabel variant="secondary" size="sm" className="flex-1" />
          </div>
          <div className="flex items-center gap-2">
            <p className="min-w-0 flex-1 type-caption text-text-3">Anyone with the link can see your timetable.</p>
            <Button size="sm" variant="ghost" pending={busy} onClick={turnOff} className="-me-2 shrink-0">
              Turn off
            </Button>
          </div>
        </>
      ) : (
        <Button size="sm" variant="secondary" pending={busy} pendingLabel="Making a link" onClick={turnOn}>
          <Icon icon={Calendar} />
          Get a calendar link
        </Button>
      )}
    </div>
  );
}
