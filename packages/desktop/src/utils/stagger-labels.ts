/** A label's box: its right edge (labels are right-aligned at a line's end), top, width and height. */
export interface LabelBox {
  right: number;
  top: number;
  width: number;
  height: number;
}

/**
 * The tops of labels moved down, the lower of two overlapping labels below
 * the other, so that labels at the ends of nearby lines (e.g. head lines
 * ending at the edge of the model) do not overlap. In screen order (y
 * downward); the labels keep their order from top to bottom.
 */
export function staggerLabelTops(labels: readonly LabelBox[], gap = 0): number[] {
  const order = labels.map((_, i) => i).sort((a, b) => labels[a].top - labels[b].top || a - b);
  const tops = labels.map((l) => l.top);
  const placed: number[] = [];
  for (const i of order) {
    const l = labels[i];
    for (const j of placed) {
      const o = labels[j];
      const overlapX = l.right - l.width < o.right && o.right - o.width < l.right;
      if (overlapX && tops[i] < tops[j] + o.height + gap && tops[j] < tops[i] + l.height + gap) {
        tops[i] = tops[j] + o.height + gap;
      }
    }
    placed.push(i);
  }
  return tops;
}
