import Svg, { Circle } from "react-native-svg";

/** Petals round the ring, as the web's mark (apps/web/app/components/brand/canvas-mark.svg) places them. */
const DOTS: [number, number][] = [
  [21.4, 12],
  [18.65, 18.65],
  [12, 21.4],
  [5.35, 18.65],
  [2.6, 12],
  [5.35, 5.35],
  [12, 2.6],
  [18.65, 5.35],
];

/**
 * Canvas's red ring of dots, the web's SourceMark for Canvas: drawn heavier than Canvas's own so it holds together
 * small, and in a deeper red so it never reads as the fail coral.
 */
export function CanvasMark({ size = 16 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessibilityLabel="Canvas">
      <Circle cx={12} cy={12} r={3.9} fill="none" stroke="#CF2A2F" strokeWidth={3.2} />
      {DOTS.map(([cx, cy]) => (
        <Circle key={`${cx},${cy}`} cx={cx} cy={cy} r={2.45} fill="#CF2A2F" />
      ))}
    </Svg>
  );
}
