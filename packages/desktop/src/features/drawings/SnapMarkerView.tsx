/**
 * The snap marker over the canvas, as in CAD: a square on an end point,
 * an X on an intersection, a short line along the line snapped to.
 */
import type { SnapMarker } from "./canvas-snap";

const COLOR = "var(--color-canvas-pick)";
/** A dark halo under the marker keeps it visible on any drawing. */
const HALO = "var(--color-canvas-pick-halo)";

export function SnapMarkerView({ marker }: { marker: SnapMarker | null }) {
  if (!marker) return null;
  const r = 6;
  const deg = ((marker.angle ?? 0) * 180) / Math.PI;
  return (
    <svg
      className="absolute pointer-events-none z-40"
      style={{ left: marker.x - 12, top: marker.y - 12, overflow: "visible" }}
      width={24}
      height={24}
      aria-hidden
      data-testid={`snap-marker-${marker.kind}`}
    >
      <g transform="translate(12 12)" fill="none" strokeLinecap="round">
        {marker.kind === "endpoint" && (
          <>
            <rect x={-r} y={-r} width={2 * r} height={2 * r} stroke={HALO} strokeWidth={4} />
            <rect x={-r} y={-r} width={2 * r} height={2 * r} stroke={COLOR} strokeWidth={2} />
          </>
        )}
        {marker.kind === "intersection" && (
          <>
            <path d={`M${-r} ${-r}L${r} ${r}M${-r} ${r}L${r} ${-r}`} stroke={HALO} strokeWidth={4} />
            <path d={`M${-r} ${-r}L${r} ${r}M${-r} ${r}L${r} ${-r}`} stroke={COLOR} strokeWidth={2} />
          </>
        )}
        {marker.kind === "line" && (
          <g transform={`rotate(${deg})`}>
            <path d={`M${-9} 0L9 0M0 -5L0 5`} stroke={HALO} strokeWidth={4} />
            <path d={`M${-9} 0L9 0M0 -5L0 5`} stroke={COLOR} strokeWidth={2} />
          </g>
        )}
      </g>
    </svg>
  );
}
