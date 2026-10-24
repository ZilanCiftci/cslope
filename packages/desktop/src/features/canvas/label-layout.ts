/**
 * Collision-aware placement of point labels (greedy point-feature
 * labelling): each label tries a few candidate positions around its point
 * in order of preference and takes the first that is inside the visible
 * area and clear of everything placed or reserved before it. A label with
 * no free position is left out.
 */

/** An axis-aligned box in canvas pixels. */
export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Space kept between labels and other things, in pixels. */
const CLEARANCE = 1;

export function boxesOverlap(a: Box, b: Box, clearance = CLEARANCE): boolean {
  return (
    a.left < b.right + clearance &&
    b.left < a.right + clearance &&
    a.top < b.bottom + clearance &&
    b.top < a.bottom + clearance
  );
}

/** Distance from (x, y) to the segment a–b. */
export function distanceToSegment(
  x: number,
  y: number,
  a: readonly [number, number],
  b: readonly [number, number],
): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / len2)) : 0;
  return Math.hypot(x - (a[0] + t * dx), y - (a[1] + t * dy));
}

/** A box of half-size `r` around a point. */
export function boxAround(x: number, y: number, rx: number, ry = rx): Box {
  return { left: x - rx, top: y - ry, right: x + rx, bottom: y + ry };
}

/** Moves a box inward so it lies inside `bounds` (when it fits). */
export function clampBox(b: Box, bounds: Box): Box {
  const w = b.right - b.left;
  const h = b.bottom - b.top;
  const left = Math.max(bounds.left, Math.min(b.left, bounds.right - w));
  const top = Math.max(bounds.top, Math.min(b.top, bounds.bottom - h));
  return { left, top, right: left + w, bottom: top + h };
}

export class LabelLayout {
  private readonly taken: Box[] = [];

  readonly bounds: Box;

  constructor(bounds: Box) {
    this.bounds = bounds;
  }

  /** Keeps labels off this box (a symbol, marker or another label). */
  reserve(b: Box): void {
    this.taken.push(b);
  }

  isFree(b: Box): boolean {
    return !this.taken.some((t) => boxesOverlap(b, t));
  }

  /**
   * Places a label at the first free candidate (each moved inside the
   * bounds first) and reserves it. Returns null when none is free, unless
   * `force` is set: then the first candidate is used anyway.
   */
  place(candidates: readonly Box[], force = false): Box | null {
    const inside = candidates.map((c) => clampBox(c, this.bounds));
    const free = inside.find((c) => this.isFree(c));
    const chosen = free ?? (force ? inside[0] : undefined);
    if (!chosen) return null;
    this.reserve(chosen);
    return chosen;
  }
}

/**
 * Candidate boxes of size `w`×`h` for the label of a point at (px, py),
 * clear of a point symbol of half-size `r`: the preferred side (above, or
 * below when `below`), the other side, right, left, the four diagonals,
 * and last a little further above and below (clear of a marker standing
 * on the point).
 */
export function pointLabelCandidates(
  px: number,
  py: number,
  w: number,
  h: number,
  below: boolean,
  r = 6,
): Box[] {
  const gap = r + 2;
  const at = (left: number, top: number): Box => ({ left, top, right: left + w, bottom: top + h });
  const above = at(px - w / 2, py - gap - h);
  const under = at(px - w / 2, py + gap);
  const right = at(px + gap, py - h / 2);
  const left = at(px - gap - w, py - h / 2);
  const d = r + 1;
  const aboveRight = at(px + d, py - d - h);
  const aboveLeft = at(px - d - w, py - d - h);
  const belowRight = at(px + d, py + d);
  const belowLeft = at(px - d - w, py + d);
  const farAbove = at(px - w / 2, py - gap - h - 6);
  const farBelow = at(px - w / 2, py + gap + 6);
  return below
    ? [under, above, right, left, belowRight, belowLeft, aboveRight, aboveLeft, farBelow, farAbove]
    : [above, under, right, left, aboveRight, aboveLeft, belowRight, belowLeft, farAbove, farBelow];
}
