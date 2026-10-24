import type { Annotation, ResultViewSettings, ViewLock } from "../../store/types";
import { PLOT_MARGINS } from "../../store/defaults";
import { getPlotAspectRatio } from "./paper";
import { boundsOf, paperContentBounds, type Bounds, type PaperContent } from "./extents";

type Pt = [number, number];

/** True when every model point lies inside the locked view. */
export function viewLockContains(lock: ViewLock, coords: Pt[]): boolean {
  const tol = 1e-9;
  return coords.every(
    ([x, y]) =>
      x >= lock.bottomLeft[0] - tol &&
      x <= lock.topRight[0] + tol &&
      y >= lock.bottomLeft[1] - tol &&
      y <= lock.topRight[1] + tol,
  );
}

export interface FitViewLockOptions {
  /** Margin on every side, in world units. */
  margin: number;
  /**
   * Where content lower than the plot goes: "bottom" puts its base (less
   * the margin) on the bottom of the plot, "centre" centres it vertically.
   */
  placement: "bottom" | "centre";
  /**
   * Share of the plot height at the top kept free (for a title block); the
   * content is placed in the rest. 0 by default.
   */
  topBand?: number;
}

/**
 * Locked view of the plot's aspect ratio (width / height) around `content`
 * at true scale. The width spans the content and margins; when the content
 * (with the top band) is taller than that, the view widens around the
 * content's centre instead of cutting off the top.
 */
export function fitViewLock(content: Bounds, aspect: number, opts: FitViewLockOptions): ViewLock {
  const band = Math.min(0.8, Math.max(0, opts.topBand ?? 0));
  const m = opts.margin;
  let left = content.xMin - m;
  let right = content.xMax + m;
  const lo = content.yMin - m;
  const hi = content.yMax + m;
  const needH = (hi - lo) / (1 - band);
  let height = (right - left) / aspect;
  if (height < needH) {
    const cx = (left + right) / 2;
    const width = needH * aspect;
    left = cx - width / 2;
    right = cx + width / 2;
    height = needH;
  }
  // The part of the plot below the band holds the content.
  const free = height * (1 - band);
  const bottom = opts.placement === "bottom" ? lo : (lo + hi) / 2 - free / 2;
  return { bottomLeft: [left, bottom], topRight: [right, bottom + height] };
}

/** Margin around the paper content: a share of its larger span. */
export const PAPER_MARGIN_FRACTION = 0.06;

/**
 * Paper frame width (px at paper zoom 1) for which the symbols drawn at a
 * fixed screen size (loads, the water-table triangle) are sized into the
 * frame: about the smallest paper the app shows. A larger rendering (a big
 * window, the PDF, the PNG export) has the symbols relatively smaller, so
 * they fit there too.
 */
export const REFERENCE_PAPER_WIDTH_PX = 640;

/**
 * The locked view that frames a model on the paper: at true scale (equal
 * x and y scales, as engineering drawings are), with a margin on all sides
 * of a share of the content's span, around everything the model draws:
 * the geometry, water lines over it, loads with their arrows and labels,
 * reinforcement and piles.
 *
 * The width follows from the content, so the height of a flat model leaves
 * room to spare. Vertically the content is centred in the plot, below a
 * `topBand` share kept free when annotations (title, FOS, material table)
 * sit at the top of the paper. A model taller than the plot widens it.
 */
export function paperViewLock(
  content: PaperContent,
  aspect: number,
  opts: { topBand?: number } = {},
): ViewLock | null {
  const base = boundsOf(content.coordinates);
  if (!base) return null;
  const plotWidthPx = REFERENCE_PAPER_WIDTH_PX * (1 - PLOT_MARGINS.L - PLOT_MARGINS.R);
  const lockFor = (b: Bounds) => {
    const span = Math.max(b.xMax - b.xMin, b.yMax - b.yMin);
    const margin = span > 0 ? span * PAPER_MARGIN_FRACTION : 1;
    return fitViewLock(b, aspect, { margin, placement: "centre", topBand: opts.topBand });
  };
  // The fixed-size symbols take more world units the wider the view is,
  // and a taller content can widen it: a few rounds settle it.
  let lock = lockFor(base);
  for (let i = 0; i < 4; i++) {
    const worldPerPx = (lock.topRight[0] - lock.bottomLeft[0]) / plotWidthPx;
    const b = paperContentBounds(content, worldPerPx) ?? base;
    const next = lockFor(b);
    const same =
      Math.abs(next.topRight[0] - next.bottomLeft[0] - (lock.topRight[0] - lock.bottomLeft[0])) < 1e-9 &&
      Math.abs(next.bottomLeft[1] - lock.bottomLeft[1]) < 1e-9;
    lock = next;
    if (same) break;
  }
  return lock;
}

/**
 * Bottom of the title block (title, subtitle, FOS line) and material table
 * at the top of the paper in the default result layout, as a share of the
 * paper height from the top.
 */
export const TITLE_BLOCK_BOTTOM = 0.22;

/**
 * Share of the plot height at its top that `paperViewLock` keeps free of the
 * model for the annotations at the top of the paper: down to the bottom of
 * the title block when an annotation sits there (the default layout, the
 * examples), none otherwise (the verification problems).
 */
export function paperTopBand(annotations: readonly Pick<Annotation, "y">[]): number {
  if (!annotations.some((a) => a.y < TITLE_BLOCK_BOTTOM)) return 0;
  return (TITLE_BLOCK_BOTTOM - PLOT_MARGINS.T) / (1 - PLOT_MARGINS.T - PLOT_MARGINS.B);
}

/**
 * The paper frame of a model for a result view's paper and annotations:
 * what a model starts with, "Use model bounds" sets and the automatic
 * refit after the geometry grows. A placeholder view without geometry.
 */
export function modelViewLock(
  content: PaperContent,
  settings: Pick<ResultViewSettings, "paperFrame" | "annotations">,
): ViewLock {
  const { paperSize, landscape } = settings.paperFrame;
  const aspect = getPlotAspectRatio(paperSize, landscape);
  return (
    paperViewLock(content, aspect, { topBand: paperTopBand(settings.annotations) }) ?? {
      bottomLeft: [-1, -1],
      topRight: [21, -1 + 22 / aspect],
    }
  );
}
