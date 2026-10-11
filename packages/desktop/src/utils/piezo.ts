type Pt = [number, number];

/**
 * Horizontal continuations of a piezometric line beyond its end points to
 * the model edges, as the engine applies them (like Slide and SLOPE/W).
 * Drawn dashed so the user sees the water the analysis actually uses.
 */
export function piezoExtensions(line: Pt[], model: Pt[]): [Pt, Pt][] {
  if (line.length < 2 || model.length < 3) return [];
  const xs = model.map((p) => p[0]);
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  let left = line[0];
  let right = line[0];
  for (const p of line) {
    if (p[0] < left[0]) left = p;
    if (p[0] > right[0]) right = p;
  }
  const out: [Pt, Pt][] = [];
  if (left[0] > xMin) out.push([[xMin, left[1]], left]);
  if (right[0] < xMax) out.push([right, [xMax, right[1]]]);
  return out;
}
