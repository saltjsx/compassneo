import { useState } from "react";
import { Alert, AlertDescription } from "@/components/glaze/ui/alert";
import { Button } from "@/components/glaze/ui/button";
import { Field, FieldDescription, FieldError, FieldLabel, Form } from "@/components/glaze/ui/field";
import { Input } from "@/components/glaze/ui/input";
import { Add, Icon, Warning } from "@/components/glaze/icon";
import { SourceMark } from "@/components/brand/source-mark";
import { useCanvasControls, useCanvasStatus } from "@/lib/neo/canvas";
import { signOutNotice } from "@/lib/neo/session";
import { InlineConfirm } from "./inline-confirm";

const requireValue = (message: string) => (v: unknown) => (String(v ?? "").trim() ? null : message);

/**
 * Canvas, on the settings page. Not added: a way to add it, which opens a short form (the school's Canvas address and
 * an access token, with where to make one). Added: where and as whom, and a way to remove it, which asks first (adding
 * it back takes a new token). Canvas no longer taking the token: says so, with the form to paste a new one.
 */
export function CanvasLink({ token }: { token: string }) {
  const status = useCanvasStatus(token);
  const { add, remove } = useCanvasControls();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!status) return null;

  const submit = (values: Record<string, unknown>) => {
    setPending(true);
    setError(null);
    void add({ token, address: String(values.address ?? ""), accessToken: String(values.accessToken ?? "") })
      .then(r => {
        if (r.ok) return setOpen(false);
        if (r.code === "signed-out" || r.code === "password-changed") signOutNotice.set(r.message);
        else setError(r.message);
      })
      .catch(() => setError("Compass Neo could not reach its server. Try again."))
      .finally(() => setPending(false));
  };

  const form = (
    <Form pending={pending} onFormSubmit={submit} className="gap-3">
      <Field name="address" validate={requireValue("Enter your school's Canvas address.")}>
        <FieldLabel>Canvas address</FieldLabel>
        <Input
          name="address"
          size="sm"
          autoCapitalize="none"
          spellCheck={false}
          inputMode="url"
          placeholder="school.instructure.com"
          defaultValue={status.added ? status.host : undefined}
        />
        <FieldError />
      </Field>
      <Field name="accessToken" validate={requireValue("Paste the access token you made in Canvas.")}>
        <FieldLabel>Access token</FieldLabel>
        <Input mode="password" name="accessToken" size="sm" autoComplete="off" />
        <FieldDescription>
          In Canvas, open Account, then Settings, and choose New access token. Name it Compass Neo, leave the date empty,
          and paste the token here.
        </FieldDescription>
        <FieldError />
      </Field>
      {error && (
        <Alert status="fail">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <div className="flex gap-2">
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" size="sm" className="flex-1" pending={pending} pendingLabel="Checking with Canvas">
          {status.added ? "Use this token" : "Add Canvas"}
        </Button>
      </div>
    </Form>
  );

  return (
    <section aria-labelledby="canvas-title" className="neo-stack neo-notice flex flex-col gap-3 p-4">
      <div className="flex items-start gap-2.5">
        <SourceMark source="canvas" size={14} className="mt-0.5" />
        <div className="min-w-0 flex-1">
          <h2 id="canvas-title" className="type-label text-text-1">Canvas</h2>
          {!status.added ? (
            <p className="type-caption text-text-2">If your school uses Canvas too, add it to see its work beside Compass's.</p>
          ) : status.refused ? (
            <p className="flex items-start gap-1.5 type-caption text-warn-text">
              <Icon icon={Warning} size={14} className="mt-px shrink-0" />
              {status.refused}
            </p>
          ) : (
            <p className="truncate type-caption text-text-2">
              {[status.name, status.host, status.courses != null && `${status.courses} ${status.courses === 1 ? "course" : "courses"}`]
                .filter(Boolean)
                .join(" · ")}
            </p>
          )}
        </div>
      </div>
      {open ? (
        form
      ) : !status.added ? (
        <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
          <Icon icon={Add} />
          Add Canvas
        </Button>
      ) : confirming ? (
        <InlineConfirm
          question="Remove Canvas?"
          detail="Its work, files and notices leave Compass Neo, and adding it back takes a new access token."
          confirm="Remove Canvas"
          pending={removing}
          onCancel={() => setConfirming(false)}
          onConfirm={() => {
            setRemoving(true);
            void remove({ token })
              .catch(() => {})
              .finally(() => {
                setRemoving(false);
                setConfirming(false);
              });
          }}
        />
      ) : (
        <>
          {status.refused && (
            <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
              Add a new token
            </Button>
          )}
          <div className="flex items-center gap-2">
            <p className="min-w-0 flex-1 type-caption text-text-3">Read only. Nothing is ever sent to Canvas.</p>
            <Button size="sm" variant="ghost" onClick={() => setConfirming(true)} className="-me-2 shrink-0">
              Remove Canvas
            </Button>
          </div>
        </>
      )}
    </section>
  );
}
