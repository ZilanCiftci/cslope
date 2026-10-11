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

/** Top of the model polygon at x (highest edge crossing), or NaN. */
function groundTopAt(model: Pt[], x: number): number {
  let top = Number.NaN;
  for (let i = 0; i < model.length; i++) {
    const [ax, ay] = model[i];
    const [bx, by] = model[(i + 1) % model.length];
    if (ax === bx || x < Math.min(ax, bx) || x > Math.max(ax, bx)) continue;
    const y = ay + ((x - ax) / (bx - ax)) * (by - ay);
    if (!(y <= top)) top = y;
  }
  return top;
}

/** Water level of a line at x, continued horizontally beyond its ends. */
function lineYAt(line: Pt[], x: number): number {
  const pts = [...line].sort((a, b) => a[0] - b[0]);
  if (x <= pts[0][0]) return pts[0][1];
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, ay] = pts[i];
    const [bx, by] = pts[i + 1];
    if (x <= bx) return bx === ax ? by : ay + ((x - ax) / (bx - ax)) * (by - ay);
  }
  return pts[pts.length - 1][1];
}

/**
 * Areas where the water line lies above the ground: the free water the
 * analysis loads the slope with. Each polygon runs along the water surface
 * and back along the ground.
 */
export function freeWaterPolygons(line: Pt[], model: Pt[]): Pt[][] {
  if (line.length < 2 || model.length < 3) return [];
  const xs = model.map((p) => p[0]);
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const eps = 1e-9 * Math.max(1, xMax - xMin);
  const breaks = [...new Set([...xs, ...line.map((p) => p[0])])]
    .filter((x) => x >= xMin && x <= xMax)
    .sort((a, b) => a - b);
  const polygons: Pt[][] = [];
  let water: Pt[] = [];
  let ground: Pt[] = [];
  const close = () => {
    if (water.length >= 2) polygons.push([...water, ...ground.reverse()]);
    water = [];
    ground = [];
  };
  for (let i = 0; i < breaks.length - 1; i++) {
    const xa = breaks[i];
    const xb = breaks[i + 1];
    if (xb - xa <= 2 * eps) continue;
    // Ground just inside the interval, so vertical faces are taken from
    // the correct side.
    const ga = groundTopAt(model, xa + eps);
    const gb = groundTopAt(model, xb - eps);
    const wa = lineYAt(line, xa);
    const wb = lineYAt(line, xb);
    if (!Number.isFinite(ga) || !Number.isFinite(gb)) {
      close();
      continue;
    }
    const da = wa - ga;
    const db = wb - gb;
    if (da <= 0 && db <= 0) {
      close();
      continue;
    }
    let xs0 = xa;
    let xs1 = xb;
    if (da <= 0) xs0 = xa + ((xb - xa) * da) / (da - db);
    if (db <= 0) xs1 = xa + ((xb - xa) * da) / (da - db);
    const at = (x: number, a: number, b: number) => a + ((x - xa) / (xb - xa)) * (b - a);
    if (da <= 0 || water.length === 0) {
      close();
      water.push([xs0, at(xs0, wa, wb)]);
      ground.push([xs0, at(xs0, ga, gb)]);
    } else if (ground.length > 0 && ground[ground.length - 1][1] !== ga) {
      // Vertical face between intervals.
      ground.push([xa, ga]);
    }
    water.push([xs1, at(xs1, wa, wb)]);
    ground.push([xs1, at(xs1, ga, gb)]);
    if (db <= 0) close();
  }
  close();
  return polygons;
}
