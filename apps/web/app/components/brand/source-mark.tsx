import { cn } from "@/lib/glaze/utils";
import compassMark from "./compass-mark.svg";
import connectMark from "./connect-mark.png";
import canvasMark from "./canvas-mark.svg";

/**
 * Where something came from, as the source's own mark: Compass's blue compass ring, Connect's three-colour knot,
 * Canvas's red ring of dots.
 * Small and quiet, in place of a text tag. Named for assistive tech ("From Compass"), and in a tooltip on hover.
 */
export type Source = "compass" | "connect" | "canvas";

const SRC: Record<Source, { src: string; label: string }> = {
  compass: { src: compassMark, label: "Compass" },
  connect: { src: connectMark, label: "Connect" },
  canvas: { src: canvasMark, label: "Canvas" },
};

export function SourceMark({ source, size = 14, className }: { source: Source; size?: number; className?: string }) {
  const s = SRC[source];
  return (
    <img
      src={s.src}
      alt={`From ${s.label}`}
      title={`From ${s.label}`}
      width={size}
      height={size}
      draggable={false}
      className={cn("inline-block shrink-0 object-contain select-none", className)}
    />
  );
}
