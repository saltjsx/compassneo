import { useState } from "react";
import { Alert, AlertDescription } from "@/components/glaze/ui/alert";
import { Button } from "@/components/glaze/ui/button";
import { Field, FieldDescription, FieldError, FieldLabel, Form } from "@/components/glaze/ui/field";
import { Input } from "@/components/glaze/ui/input";
import { Icon, Warning } from "@/components/glaze/icon";
import { SourceMark } from "@/components/brand/source-mark";
import { useCanvasControls, useCanvasStatus } from "@/lib/neo/canvas";
import { signOutNotice } from "@/lib/neo/session";

const requireValue = (message: string) => (v: unknown) => (String(v ?? "").trim() ? null : message);

/**
 * Canvas, in the profile card. Not added: a way to add it, which opens a short form (the school's Canvas address and
 * an access token, with where to make one). Added: where and as whom, and a way to remove it. Canvas no longer taking
 * the token: says so, with the form to paste a new one.
 */
export function CanvasLink({ token }: { token: string }) {
  const status = useCanvasStatus(token);
  const { add, remove } = useCanvasControls();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [removing, setRemoving] = useState(false);
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
    <div className="mt-3 flex flex-col gap-2 border-t border-line-faint pt-3">
      <div className="flex items-start gap-2.5">
        <SourceMark source="canvas" size={16} className="mt-0.5" />
        <div className="min-w-0 flex-1">
          <p className="type-label-sm text-text-1">Canvas</p>
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
          Add Canvas
        </Button>
      ) : (
        <div className="flex gap-2">
          {status.refused && (
            <Button size="sm" variant="secondary" className="flex-1" onClick={() => setOpen(true)}>
              Add a new token
            </Button>
          )}
          <Button
            size="sm"
            variant={status.refused ? "ghost" : "secondary"}
            className={status.refused ? undefined : "flex-1"}
            pending={removing}
            onClick={() => {
              setRemoving(true);
              void remove({ token })
                .catch(() => {})
                .finally(() => setRemoving(false));
            }}
          >
            Remove Canvas
          </Button>
        </div>
      )}
    </div>
  );
}
