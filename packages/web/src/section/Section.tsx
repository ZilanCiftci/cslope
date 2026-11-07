/**
 * The section drawing: the template's section in SVG, drawn by hand (not
 * the app's canvas): the layers in earth tones by kind, the road's fill,
 * the water level, the traffic load, and after a run the critical surface
 * (red, the thickest line) with its slices (the thinnest). Axes in meters.
 * It is drawn at the width it has, so that its text stays readable on a
 * phone.
 */
import { useEffect, useId, useRef, useState } from "react";
import type { SliceData } from "@cslope/engine";
import type { ExcavationParams, LayerKind } from "@/templates/excavation";
import { lineAt, sectionShapes, sliceSides, surfaceLine, ticks, viewOf, type Point } from "./section-geometry";

const FILL: Record<LayerKind, string> = {
  undrained: "fill-earth/30",
  "undrained-increasing": "fill-earth/45",
  drained: "fill-earth/15",
  impenetrable: "fill-muted-foreground/35",
};

const MARGIN = { left: 40, right: 10, top: 34, bottom: 24 };

function useWidth<T extends HTMLElement>(fallback: number) {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(240, Math.round(entry.contentRect.width))));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

const fmt = (v: number) => String(Math.round(v * 10) / 10);

export interface SectionProps {
  /** A parameter set whose geometry is valid. */
  params: ExcavationParams;
  /** The critical surface's slices, after a run of these parameters. */
  slices: SliceData[] | null;
  /** A short sentence for screen readers: what the drawing shows. */
  label: string;
}

export function Section({ params, slices, label }: SectionProps) {
  const [ref, width] = useWidth<HTMLDivElement>(720);
  const s = sectionShapes(params);
  const { g } = s;
  const surface = slices?.length ? surfaceLine(slices) : null;
  const view = viewOf(g, params.excavationDepth, surface);
  const top = view.y1;
  const scale = (width - MARGIN.left - MARGIN.right) / (view.x1 - view.x0);
  const height = Math.round((top - view.y0) * scale + MARGIN.top + MARGIN.bottom);
  const X = (x: number) => MARGIN.left + (x - view.x0) * scale;
  const Y = (y: number) => MARGIN.top + (top - y) * scale;
  const clip = useId();
  const path = (pts: Point[], close = true) => pts.map(([x, y], i) => `${i ? "L" : "M"}${X(x).toFixed(1)},${Y(y).toFixed(1)}`).join("") + (close ? "Z" : "");
  const xTicks = ticks(view.x0, view.x1, Math.max(3, Math.floor(width / 90)));
  const yTicks = ticks(view.y0, top, Math.max(3, Math.floor(height / 50)));
  const labelX = view.x0 + 8 / scale;

  return (
    <div ref={ref} className="w-full">
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label} className="block max-w-full">
        <defs>
          <clipPath id={clip}>
            <rect x={X(view.x0)} y={0} width={X(view.x1) - X(view.x0)} height={Y(view.y0)} />
          </clipPath>
        </defs>
        <g clipPath={`url(#${clip})`}>
        {s.layers.map((poly, i) => (
          <path key={i} d={path(poly)} className={FILL[params.layers[i].material.kind]} />
        ))}
        {s.road && <path d={path(s.road)} className="fill-muted-foreground/20" />}
        {/* The layer boundaries and the outline, in the theme's ink. */}
        {g.levels.map((level, i) => {
          const faceX = level > g.bottom ? params.slope * (g.ground - level) : g.right;
          return <line key={i} x1={X(g.left)} x2={X(faceX)} y1={Y(level)} y2={Y(level)} className="stroke-foreground/50" strokeWidth={0.75} />;
        })}
        {s.road && <line x1={X(s.road[0][0])} x2={X(s.road[3][0])} y1={Y(g.ground)} y2={Y(g.ground)} className="stroke-foreground/50" strokeWidth={0.75} />}
        <path d={path(s.exterior)} className="fill-none stroke-foreground" strokeWidth={1.25} strokeLinejoin="round" />
        {s.layers.map((poly, i) => {
          const ys = poly.map((p) => Math.min(top, Math.max(view.y0, p[1])));
          const mid = (Math.max(...ys) + Math.min(...ys)) / 2;
          if (!poly.length || (Math.max(...ys) - Math.min(...ys)) * scale < 13) return null;
          const name = params.layers[i].name?.trim() || `Layer ${i + 1}`;
          return (
            <text key={i} x={X(labelX)} y={Y(mid)} dominantBaseline="middle" className="fill-foreground text-[11px]">
              {name}
            </text>
          );
        })}
        {s.water.length > 0 && <path d={path(s.water, false)} className="fill-none stroke-foreground" strokeWidth={1} strokeDasharray="5 3" />}
        {s.water.length > 0 &&
          (() => {
            const x = Math.max(view.x0, s.g.left) + 60 / scale;
            const y = lineAt(s.water, x) ?? params.waterLevel!;
            return <path d={`M${X(x)},${Y(y) - 8}h10l-5,7z`} className="fill-none stroke-foreground" strokeWidth={1} aria-hidden="true" />;
          })()}
        {s.load && (
          <g className="stroke-foreground fill-foreground" strokeWidth={1}>
            <line x1={X(s.load.x1)} x2={X(s.load.x2)} y1={Y(s.load.y) - 18} y2={Y(s.load.y) - 18} />
            {ticks(s.load.x1, s.load.x2, Math.max(2, Math.round(((s.load.x2 - s.load.x1) * scale) / 14))).map((x) => (
              <path key={x} d={`M${X(x)},${Y(s.load!.y) - 18}V${Y(s.load!.y) - 2}M${X(x) - 2.5},${Y(s.load!.y) - 6}L${X(x)},${Y(s.load!.y) - 2}L${X(x) + 2.5},${Y(s.load!.y) - 6}`} fill="none" />
            ))}
            <text x={X(s.load.x1)} y={Y(s.load.y) - 21} className="stroke-none text-[11px]">
              q {fmt(params.road!.trafficLoad!)} kPa
            </text>
          </g>
        )}
        {slices &&
          sliceSides(slices, s.exterior).map(([a, b], i) => (
            <line key={i} x1={X(a[0])} x2={X(b[0])} y1={Y(a[1])} y2={Y(b[1])} className="stroke-foreground/45" strokeWidth={0.5} />
          ))}
        {surface && <path d={path(surface, false)} className="fill-none stroke-signal" strokeWidth={2} strokeLinejoin="round" />}
        </g>
        {/* Axes: elevations at the left, distances from the crest below. */}
        <g className="fill-muted-foreground text-[10px] tabular">
          {yTicks.map((y) => (
            <g key={y}>
              <line x1={MARGIN.left - 4} x2={MARGIN.left} y1={Y(y)} y2={Y(y)} className="stroke-muted-foreground" />
              <text x={MARGIN.left - 6} y={Y(y)} textAnchor="end" dominantBaseline="middle">
                {fmt(y)}
              </text>
            </g>
          ))}
          {xTicks.map((x) => (
            <g key={x}>
              <line x1={X(x)} x2={X(x)} y1={Y(view.y0)} y2={Y(view.y0) + 4} className="stroke-muted-foreground" />
              <text x={X(x)} y={Y(view.y0) + 15} textAnchor="middle">
                {fmt(x)}
              </text>
            </g>
          ))}
          <text x={MARGIN.left - 6} y={10} textAnchor="end">
            m
          </text>
        </g>
      </svg>
    </div>
  );
}
