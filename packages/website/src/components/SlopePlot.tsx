import type { SlopePlot as Plot } from "@/content/verification-types";
import { cn } from "@/lib/utils";

/** Fill opacity of the soil by material (order of definition). */
const SOIL = [0.28, 0.5, 0.16, 0.4, 0.22];

const path = (pts: [number, number][], toY: (y: number) => number, close = false) =>
  pts.map(([x, y], i) => `${i ? "L" : "M"}${x} ${toY(y)}`).join("") + (close ? "Z" : "");

/**
 * A small drawing of a slope and its critical slip surface, from the
 * engine's result (generated/home-plots.json). Model coordinates with y
 * up; strokes keep their width whatever the scale.
 */
export function SlopePlot({ plot, label, className }: { plot: Plot; label: string; className?: string }) {
  const [x0, y0, x1, y1] = plot.bounds;
  const pad = 0.04 * Math.max(x1 - x0, y1 - y0);
  const toY = (y: number) => y1 - y + y0;
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`${x0 - pad} ${y0 - pad} ${x1 - x0 + 2 * pad} ${y1 - y0 + 2 * pad}`}
      preserveAspectRatio="xMidYMid meet"
      className={cn("block", className)}
    >
      {plot.regions.map((r, i) => (
        <path
          key={i}
          d={path(r.points, toY, true)}
          className="fill-earth stroke-earth"
          fillOpacity={SOIL[r.material % SOIL.length]}
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
        />
      ))}
      {plot.water && (
        <path
          d={path(plot.water, toY)}
          className="fill-none stroke-primary"
          strokeWidth={1}
          strokeDasharray="3 2"
          vectorEffect="non-scaling-stroke"
        />
      )}
      <path d={path(plot.mass, toY, true)} className="fill-signal" fillOpacity={0.18} />
      <path
        d={path(plot.surface, toY)}
        className="fill-none stroke-signal"
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
