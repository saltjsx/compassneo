import { useEffect, useRef } from "react";
import { Button } from "@/components/glaze/ui/button";

/**
 * A second press for something that cannot be taken back from here (removing Canvas, ending the calendar link), in
 * place of the row that asked, as a hand-in asks before it goes. Keyboard focus lands on Cancel, the safe way out.
 */
export function InlineConfirm({
  question,
  detail,
  confirm,
  pending,
  onCancel,
  onConfirm,
}: {
  question: string;
  detail: string;
  /** The confirming button's words: a verb and its object ("Remove Canvas"). */
  confirm: string;
  pending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => cancel.current?.focus(), []);
  return (
    <div role="group" aria-label={question} className="flex flex-col gap-2">
      <p className="type-caption text-text-2">
        <span className="type-label-sm text-text-1">{question}</span> {detail}
      </p>
      <div className="flex justify-end gap-2">
        <Button ref={cancel} size="sm" variant="secondary" disabled={pending} onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" variant="destructive" pending={pending} onClick={onConfirm}>
          {confirm}
        </Button>
      </div>
    </div>
  );
}
