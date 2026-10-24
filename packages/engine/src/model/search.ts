/**
 * Search plane generation for slope stability analysis.
 */

import {
  circleRadiusFromAbcd,
  circleCentre,
  midCoord,
  distPoints,
} from "../math/index";
import { isPointInPolygon } from "../math/polygon";
import { getYAtX } from "../math/interpolation";
import type { Material } from "../types/index";
import type { Slope, SearchPlane } from "./slope";

interface SearchGridSpec {
  numCircles: number;
  numPointsTop: number;
  numPointsBot: number;
}

function roundTo(value: number, decimals: number): number {
  const scale = 10 ** decimals;
  return Math.round(value * scale) / scale;
}

export function planeKey(
  plane: Pick<SearchPlane, "cx" | "cy" | "radius" | "points">,
): string {
  if (plane.points) {
    return plane.points.map(([x, y]) => `${roundTo(x, 4)},${roundTo(y, 4)}`).join(";");
  }
  return `${roundTo(plane.cx, 4)}|${roundTo(plane.cy, 4)}|${roundTo(plane.radius, 4)}`;
}

function getSearchGridSpec(slope: Slope): SearchGridSpec {
  const numCircles = Math.max(5, Math.floor(slope.iterations / 800));
  const pointCombinations = slope.iterations / numCircles;
  let numPointsTop = Math.floor(Math.sqrt(pointCombinations));
  let numPointsBot = numPointsTop;

  while (numPointsTop * numPointsBot * numCircles < slope.iterations) {
    numPointsBot += 1;
  }

  numPointsTop = numPointsTop - slope.lineLoads.length - slope.udls.length;
  if (numPointsTop < 2) numPointsTop = 2;

  return { numCircles, numPointsTop, numPointsBot };
}

/**
 * Entry and exit of the slip surface on a circle: the first crossing of
 * the lower arc with the ground where the arc goes from air into soil,
 * and the next crossing where it comes out again.
 *
 * Taking simply the first two crossings by x is wrong when
 *  - a crossing lies on the upper half of the circle (e.g. on the crest
 *    behind a vertical face): the slices would hang from the lower arc
 *    metres below the ground, i.e. a free vertical crack, or
 *  - the arc only touches the ground at a vertex (typically the toe) and
 *    stays in the soil: the mass beyond it, and its resistance, was cut
 *    off.
 * Returns null when the circle has no such entry/exit pair.
 */
function selectEntryExit(
  slope: Slope,
  cx: number,
  cy: number,
  radius: number,
): [[number, number], [number, number]] | null {
  const tol = 1e-9 * Math.max(1, radius);
  const crossings = slope
    .getCircleExternalIntersection(cx, cy, radius)
    .filter((p) => p[1] <= cy + tol);
  if (crossings.length < 2) return null;

  const eps = 1e-6 * Math.max(1, radius);
  const arcInSoil = (x: number): boolean => {
    const term = radius ** 2 - (x - cx) ** 2;
    if (term < 0) return false;
    return slope.isInsideExternalBoundary(x, cy - Math.sqrt(term));
  };

  for (let i = 0; i < crossings.length - 1; i++) {
    const [ex] = crossings[i];
    if (arcInSoil(ex - eps) || !arcInSoil(ex + eps)) continue;
    for (let j = i + 1; j < crossings.length; j++) {
      if (!arcInSoil(crossings[j][0] + eps)) {
        return [crossings[i], crossings[j]];
      }
    }
    return null;
  }
  return null;
}

function isPlaneWithinExternalBoundary(
  slope: Slope,
  plane: Pick<SearchPlane, "lc" | "rc" | "cx" | "cy" | "radius">,
): boolean {
  const xSpan = Math.abs(plane.rc[0] - plane.lc[0]);
  const sampleCount = Math.min(64, Math.max(12, Math.ceil(xSpan / 8)));

  for (let i = 1; i < sampleCount; i++) {
    const t = i / sampleCount;
    const x = plane.lc[0] + (plane.rc[0] - plane.lc[0]) * t;
    const radiusTerm = plane.radius ** 2 - (x - plane.cx) ** 2;

    if (radiusTerm < 0) {
      return false;
    }

    const y = plane.cy - Math.sqrt(Math.max(0, radiusTerm));

    if (!slope.isInsideExternalBoundary(x, y + 1e-6)) {
      return false;
    }
  }

  // The lowest point, where a circle tangent to the base touches it.
  const [x0, x1] = [Math.min(plane.lc[0], plane.rc[0]), Math.max(plane.lc[0], plane.rc[0])];
  if (plane.cx > x0 && plane.cx < x1) {
    return slope.isInsideExternalBoundary(plane.cx, plane.cy - plane.radius + 1e-6);
  }
  return true;
}

/**
 * True when a plane's actual entry/exit points lie within the search
 * limits and it is longer (horizontally) than the minimum failure
 * distance.  Circles generated through grid points can intersect the
 * ground elsewhere, so this must be checked on the plane itself.
 */
function isPlaneWithinSearchLimits(
  slope: Slope,
  plane: Pick<SearchPlane, "lc" | "rc">,
): boolean {
  const [entryLeftX, entryRightX, exitLeftX, exitRightX] = slope.limits;
  const tol = 1e-9;
  return (
    plane.lc[0] >= entryLeftX - tol &&
    plane.lc[0] <= entryRightX + tol &&
    plane.rc[0] >= exitLeftX - tol &&
    plane.rc[0] <= exitRightX + tol &&
    plane.rc[0] - plane.lc[0] > Math.max(slope.minFailureDistance, 0)
  );
}

// ── Material interfaces and tangent circles ───────────────────────

/**
 * The boundary between two materials, as straight segments (flat
 * x0, y0, x1, y1, …). One per pair of materials that touch inside the
 * model; the top of impenetrable or high-strength material is one of them.
 */
interface MaterialInterface {
  segs: number[];
}

const interfaceCache = new WeakMap<
  Slope,
  { geoms: readonly unknown[]; mats: Material[]; interfaces: MaterialInterface[] }
>();

/**
 * Edges of the material regions that have a different material on either
 * side, grouped by the pair of materials. Edges on the external boundary
 * (nothing on one side) and between regions of one material (no contrast;
 * also the bridge edges of a region with holes) are left out.
 */
function materialInterfaces(slope: Slope): MaterialInterface[] {
  const geoms = slope.materialGeometries;
  const cached = interfaceCache.get(slope);
  if (
    cached &&
    cached.geoms === geoms &&
    cached.mats.length === geoms.length &&
    cached.mats.every((m, i) => geoms[i].material === m)
  ) {
    return cached.interfaces;
  }
  const regionAt = (x: number, y: number): number => {
    for (let g = 0; g < geoms.length; g++) {
      if (isPointInPolygon(x, y, geoms[g].px, geoms[g].py)) return g;
    }
    return -1;
  };
  const materialId = new Map<Material, number>();
  const idOf = (m: Material): number => {
    let id = materialId.get(m);
    if (id === undefined) {
      id = materialId.size;
      materialId.set(m, id);
    }
    return id;
  };
  const offset = 1e-6 * Math.max(1, slope.modelHeight);
  const byPair = new Map<string, number[]>();
  const seen = new Set<string>();
  if (geoms.length > 1) {
    for (const g of geoms) {
      const n = g.px.length;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const x0 = g.px[i], y0 = g.py[i], x1 = g.px[j], y1 = g.py[j];
        const len = Math.hypot(x1 - x0, y1 - y0);
        if (len < 1e-9) continue;
        const a = `${roundTo(x0, 6)},${roundTo(y0, 6)}`;
        const b = `${roundTo(x1, 6)},${roundTo(y1, 6)}`;
        const key = a < b ? `${a};${b}` : `${b};${a}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
        const nx = -(y1 - y0) / len, ny = (x1 - x0) / len;
        const ra = regionAt(mx + offset * nx, my + offset * ny);
        const rb = regionAt(mx - offset * nx, my - offset * ny);
        if (ra < 0 || rb < 0) continue;
        const ma = geoms[ra].material, mb = geoms[rb].material;
        if (ma === mb) continue;
        const ia = idOf(ma), ib = idOf(mb);
        const pair = ia < ib ? `${ia}|${ib}` : `${ib}|${ia}`;
        let segs = byPair.get(pair);
        if (!segs) byPair.set(pair, (segs = []));
        segs.push(x0, y0, x1, y1);
      }
    }
  }
  const interfaces = [...byPair.values()].map((segs) => ({ segs }));
  interfaceCache.set(slope, { geoms, mats: geoms.map((g) => g.material), interfaces });
  return interfaces;
}

/** The circle through lc and rc whose arc lies chordToEdge below the chord. */
function circleThrough(
  lc: [number, number],
  rc: [number, number],
  chordToEdge: number,
): { cx: number; cy: number; radius: number } | null {
  const C = (distPoints(lc, rc) / 2) ** 2;
  const radius = circleRadiusFromAbcd(chordToEdge, C);
  if (radius === null || !(radius > 0)) return null;
  const beta = Math.atan((lc[1] - rc[1]) / (rc[0] - lc[0]));
  const [cx, cy] = circleCentre(beta, midCoord(lc, rc), radius - chordToEdge);
  return { cx, cy, radius };
}

/**
 * True when the region between the chord lc–rc and the arc chordToEdge
 * below it (a circular segment) contains part of the interface. The arcs
 * through two fixed points are nested, so this is monotonic in
 * chordToEdge: false above the depth where the arc first touches the
 * interface, true below it.
 */
function arcReachesInterface(
  lc: [number, number],
  rc: [number, number],
  chordToEdge: number,
  iface: MaterialInterface,
): boolean {
  const circle = circleThrough(lc, rc, chordToEdge);
  if (!circle) return false;
  const { cx, cy, radius } = circle;
  // Unit normal of the chord on the side of the centre; the arc is on the
  // other side.
  const len = distPoints(lc, rc);
  const nx = -(rc[1] - lc[1]) / len, ny = (rc[0] - lc[0]) / len;
  const [mx, my] = midCoord(lc, rc);
  const minLength = 1e-9 * Math.max(1, len);
  const s = iface.segs;
  for (let k = 0; k < s.length; k += 4) {
    const ax = s[k], ay = s[k + 1];
    const dx = s[k + 2] - ax, dy = s[k + 3] - ay;
    // Part of the segment inside the circle: |A + t·d − C|² < R².
    const fx = ax - cx, fy = ay - cy;
    const qa = dx * dx + dy * dy;
    const qb = 2 * (fx * dx + fy * dy);
    const qc = fx * fx + fy * fy - radius * radius;
    const disc = qb * qb - 4 * qa * qc;
    if (disc <= 0) continue;
    const sq = Math.sqrt(disc);
    let t0 = Math.max(0, (-qb - sq) / (2 * qa));
    let t1 = Math.min(1, (-qb + sq) / (2 * qa));
    if (t0 >= t1) continue;
    // ... and on the arc's side of the chord: s0 + t·ds < 0.
    const s0 = (ax - mx) * nx + (ay - my) * ny;
    const ds = dx * nx + dy * ny;
    if (Math.abs(ds) < 1e-15) {
      if (s0 >= 0) continue;
    } else if (ds > 0) {
      t1 = Math.min(t1, -s0 / ds);
    } else {
      t0 = Math.max(t0, -s0 / ds);
    }
    if ((t1 - t0) * Math.sqrt(qa) > minLength) return true;
  }
  return false;
}

/**
 * Chord-to-arc distance of the circle through lc and rc that touches the
 * interface from above, found by bisection between a shallow arc and
 * maxChordToEdge; null when no arc in that range touches it, or when the
 * interface crosses the chord itself (every arc then cuts it).
 */
function tangentChordToEdge(
  lc: [number, number],
  rc: [number, number],
  iface: MaterialInterface,
  maxChordToEdge: number,
): number | null {
  if (!(maxChordToEdge > 0)) return null;
  let above = maxChordToEdge * 1e-4;
  if (arcReachesInterface(lc, rc, above, iface)) return null;
  let below = maxChordToEdge;
  if (!arcReachesInterface(lc, rc, below, iface)) return null;
  for (let k = 0; k < 30; k++) {
    const mid = (above + below) / 2;
    if (arcReachesInterface(lc, rc, mid, iface)) below = mid;
    else above = mid;
  }
  return above;
}

/**
 * True when a circle touches the interface where the interface meets the
 * ground, between the circle's ends: the arc then grazes the ground
 * surface (at a bench edge, say) and the sliding mass falls apart into two
 * at that point. The real exit is the grazing point, so such a circle
 * could also slip past the search limits. Not a tangent circle.
 */
function touchesGroundBetweenEnds(
  slope: Slope,
  plane: Pick<SearchPlane, "lc" | "rc" | "cx" | "cy" | "radius">,
  iface: MaterialInterface,
): boolean {
  const ground = slope.surfaceLineXY;
  if (!ground) return false;
  // The touching point: the point of the interface closest to the centre.
  let best = Infinity, tx = 0, ty = 0;
  const seg = iface.segs;
  for (let k = 0; k < seg.length; k += 4) {
    const ax = seg[k], ay = seg[k + 1], dx = seg[k + 2] - ax, dy = seg[k + 3] - ay;
    const qa = dx * dx + dy * dy;
    const t = qa > 0 ? Math.min(1, Math.max(0, ((plane.cx - ax) * dx + (plane.cy - ay) * dy) / qa)) : 0;
    const px = ax + t * dx, py = ay + t * dy;
    const d = Math.hypot(px - plane.cx, py - plane.cy);
    if (d < best) {
      best = d;
      tx = px;
      ty = py;
    }
  }
  const tol = 1e-6 * Math.max(1, plane.radius);
  return (
    tx > plane.lc[0] + tol &&
    tx < plane.rc[0] - tol &&
    Math.abs(getYAtX(ground.x, ground.y, tx) - ty) < tol
  );
}

/**
 * Basin of a circle for choosing the seeds of the refinement and the local
 * search: the material region at its lowest point. Circles that bottom out
 * in one layer, or on one interface from above, form one family with its
 * own local minimum (toe, face and deep circles; Duncan & Wright 2014,
 * ch. 14; USACE EM 1110-2-1902, 2003, para. E-3a).
 */
const basinCache = new WeakMap<SearchPlane, number>();
function basinOf(slope: Slope, plane: SearchPlane): number {
  const cached = basinCache.get(plane);
  if (cached !== undefined) return cached;
  const x = Math.min(Math.max(plane.cx, plane.lc[0]), plane.rc[0]);
  const y =
    plane.cy - Math.sqrt(Math.max(0, plane.radius ** 2 - (x - plane.cx) ** 2)) +
    1e-6 * Math.max(1, plane.radius);
  const geoms = slope.materialGeometries;
  let basin = -1;
  for (let g = 0; g < geoms.length; g++) {
    if (isPointInPolygon(x, y, geoms[g].px, geoms[g].py)) {
      basin = g;
      break;
    }
  }
  basinCache.set(plane, basin);
  return basin;
}

/** Most extra seeds, one per further basin, beyond the global best ones. */
const MAX_BASIN_SEEDS = 4;

/**
 * Local search: a further basin gets a seed when its best FOS is within
 * this factor of the global best. A level of the local search moves a
 * surface by a fraction of the grid step and lowers its FOS by a fraction
 * of a percent; a basin further off cannot overtake, and its seed would
 * only take budget from the levels that converge on the minimum.
 */
const LOCAL_BASIN_MARGIN = 1.02;

/**
 * Seeds for the refinement and the local search: the numBest circles of
 * lowest FOS, then the best circle of each basin not among them (at most
 * MAX_BASIN_SEEDS, lowest FOS first, within `margin` of the best FOS).
 * Seeds only from the global best all go to one basin when two compete,
 * and the other basin's minimum, which may be lower once refined, is
 * never approached (Duncan & Wright 2014, ch. 14: search from several
 * starting points for the local minima of toe, face and deep circles).
 */
function chooseSeeds(
  slope: Slope,
  planes: SearchPlane[],
  numBest: number,
  margin = Number.POSITIVE_INFINITY,
): SearchPlane[] {
  const best: SearchPlane[] = [];
  const bestOfBasin = new Map<number, SearchPlane>();
  for (const plane of planes) {
    if (plane.fos == null || !Number.isFinite(plane.fos) || plane.points) continue;
    if (best.length < numBest || plane.fos < best[best.length - 1].fos!) {
      let i = best.length;
      while (i > 0 && best[i - 1].fos! > plane.fos) i--;
      best.splice(i, 0, plane);
      if (best.length > numBest) best.pop();
    }
    const basin = basinOf(slope, plane);
    const current = bestOfBasin.get(basin);
    if (!current || plane.fos < current.fos!) bestOfBasin.set(basin, plane);
  }
  if (best.length === 0) return best;
  const covered = new Set(best.map((p) => basinOf(slope, p)));
  const limit = best[0].fos! * margin;
  const extra = [...bestOfBasin.entries()]
    .filter(([basin, plane]) => !covered.has(basin) && plane.fos! <= limit)
    .map(([, plane]) => plane)
    .sort((a, b) => a.fos! - b.fos!)
    .slice(0, MAX_BASIN_SEEDS);
  return [...best, ...extra];
}

// ── generatePlanes ────────────────────────────────────────────────

/**
 * Generate circular failure planes through entry and exit points.
 */
export function generatePlanes(
  slope: Slope,
  lc: [number, number],
  rc: [number, number],
  numCircles = 5,
): SearchPlane[] {
  return generatePlanesWithScale(slope, lc, rc, numCircles, 1.1);
}

function generatePlanesWithScale(
  slope: Slope,
  lc: [number, number],
  rc: [number, number],
  numCircles: number,
  startRadiusScale: number,
): SearchPlane[] {
  const planes: SearchPlane[] = [];

  const beta = Math.atan((lc[1] - rc[1]) / (rc[0] - lc[0]));
  const halfCoordDist = Math.hypot(lc[1] - rc[1], rc[0] - lc[0]) / 2;

  const startRadius = (halfCoordDist / Math.cos(beta)) * startRadiusScale;
  const startChordToCentre = Math.sqrt(
    Math.max(0, startRadius ** 2 - halfCoordDist ** 2),
  );
  const startChordToEdge = startRadius - startChordToCentre;
  const C = halfCoordDist ** 2;

  const planeAt = (chordToEdge: number): SearchPlane | null | "outside" => {
    const radius = circleRadiusFromAbcd(chordToEdge, C);
    if (radius === null) return null;
    const [cX, cY] = circleCentre(beta, midCoord(lc, rc), radius - chordToEdge);
    const ends = selectEntryExit(slope, cX, cY, radius);
    if (!ends) return null;
    const plane: SearchPlane = {
      lc: ends[0],
      rc: ends[1],
      cx: cX,
      cy: cY,
      radius,
      fos: 100,
      slices: null,
    };
    return isPlaneWithinExternalBoundary(slope, plane) ? plane : "outside";
  };

  // From the deepest circle to the shallowest.
  let deepestOutside: number | null = null;
  let tangentAdded = false;
  for (let i = 0; i < numCircles; i++) {
    const chordToEdge = (startChordToEdge * (numCircles - i)) / numCircles;
    const plane = planeAt(chordToEdge);
    if (plane === "outside") {
      deepestOutside = chordToEdge;
      continue;
    }
    if (plane === null) continue;
    // A deeper circle left the model (typically through its base): the
    // critical circle is often the one just touching the base, between
    // the two depths. Find the deepest circle that still fits.
    if (deepestOutside !== null && !tangentAdded) {
      let inside = chordToEdge;
      let outside = deepestOutside;
      let best: SearchPlane = plane;
      for (let k = 0; k < 24; k++) {
        const mid = (inside + outside) / 2;
        const p = planeAt(mid);
        if (p === "outside" || p === null) outside = mid;
        else {
          inside = mid;
          best = p;
        }
      }
      if (best !== plane) planes.push(best);
      tangentAdded = true;
    }
    planes.push(plane);
  }

  // Circles tangent to each material interface from above (the top of a
  // stronger or impenetrable layer, the base of a weaker one), found with
  // the same bisection as against the model base. The critical circle is
  // often one of them, and the fixed sagittas above rarely come close:
  // circles are searched per tangent line (USACE EM 1110-2-1902, 2003,
  // para. C-2g(1) and E-3a(2); Duncan & Wright 2014, ch. 14).
  const interfaces = materialInterfaces(slope);
  for (let k = 0; k < interfaces.length; k++) {
    const chordToEdge = tangentChordToEdge(lc, rc, interfaces[k], startChordToEdge);
    if (chordToEdge === null) continue;
    const plane = planeAt(chordToEdge);
    if (plane === null || plane === "outside") continue;
    if (touchesGroundBetweenEnds(slope, plane, interfaces[k])) continue;
    plane.tangentTo = k;
    planes.push(plane);
  }

  return planes;
}

export function generateRefinedPlanes(
  slope: Slope,
  rankedPlanes: SearchPlane[],
  refinedIterations: number,
): SearchPlane[] {
  if (refinedIterations <= 0 || rankedPlanes.length === 0) {
    return [];
  }

  const validRanked = rankedPlanes.filter(
    (plane) => plane.fos != null && Number.isFinite(plane.fos),
  );
  if (validRanked.length === 0) {
    return [];
  }

  const existingKeys = new Set(validRanked.map((plane) => planeKey(plane)));
  const generated: SearchPlane[] = [];
  const generatedKeys = new Set<string>();

  const addPlane = (plane: SearchPlane): void => {
    if (generated.length >= refinedIterations) return;
    if (!isPlaneWithinSearchLimits(slope, plane)) return;
    const key = planeKey(plane);
    if (existingKeys.has(key) || generatedKeys.has(key)) return;
    generatedKeys.add(key);
    generated.push(plane);
  };

  const addPlanes = (planes: SearchPlane[]): void => {
    for (const plane of planes) {
      addPlane(plane);
      if (generated.length >= refinedIterations) break;
    }
  };

  // Refinement varies circles; non-circular surfaces are not seeds. The
  // ten best, then the best of each further basin.
  const seeds = chooseSeeds(slope, validRanked, 10);

  const grid = getSearchGridSpec(slope);
  const [entryLeftX, entryRightX, exitLeftX, exitRightX] = slope.limits;
  const entryStep =
    grid.numPointsTop > 1
      ? Math.abs(entryRightX - entryLeftX) / (grid.numPointsTop - 1)
      : 0;
  const exitStep =
    grid.numPointsBot > 0
      ? Math.abs(exitRightX - exitLeftX) / grid.numPointsBot
      : 0;

  const radiusGroupTol = Math.max(
    0.25,
    Math.min(entryStep || 0.25, exitStep || 0.25),
  );

  for (const seed of seeds) {
    if (generated.length >= refinedIterations) break;

    const siblings = validRanked.filter(
      (plane) =>
        !plane.points && // a custom polyline has no radius
        Math.abs(plane.lc[0] - seed.lc[0]) <= radiusGroupTol &&
        Math.abs(plane.rc[0] - seed.rc[0]) <= radiusGroupTol,
    );

    if (siblings.length > 0) {
      const minRadius = Math.min(...siblings.map((plane) => plane.radius));
      const maxRadius = Math.max(...siblings.map((plane) => plane.radius));

      if (seed.radius >= maxRadius - 1e-6) {
        const largerPlanes = generatePlanesWithScale(
          slope,
          seed.lc,
          seed.rc,
          Math.max(grid.numCircles + 4, 8),
          1.45,
        ).filter((plane) => plane.radius > maxRadius + 1e-6);
        addPlanes(largerPlanes);
      }

      if (seed.radius <= minRadius + 1e-6) {
        const smallerPlanes = generatePlanesWithScale(
          slope,
          seed.lc,
          seed.rc,
          Math.max(grid.numCircles + 4, 8),
          1.02,
        ).filter((plane) => plane.radius < minRadius - 1e-6);
        addPlanes(smallerPlanes);
      }
    }

    if (generated.length >= refinedIterations) break;

    const entryOffsets =
      entryStep > 0 ? [-0.5 * entryStep, 0.5 * entryStep] : [];
    const exitOffsets = exitStep > 0 ? [-0.5 * exitStep, 0.5 * exitStep] : [];

    const entryCandidates = new Set<number>([seed.lc[0]]);
    const exitCandidates = new Set<number>([seed.rc[0]]);

    for (const delta of entryOffsets) {
      const x = seed.lc[0] + delta;
      if (entryLeftX <= x && x <= entryRightX) entryCandidates.add(x);
    }
    for (const delta of exitOffsets) {
      const x = seed.rc[0] + delta;
      if (exitLeftX <= x && x <= exitRightX) exitCandidates.add(x);
    }

    for (const ex of entryCandidates) {
      for (const xx of exitCandidates) {
        if (
          Math.abs(ex - seed.lc[0]) < 1e-9 &&
          Math.abs(xx - seed.rc[0]) < 1e-9
        ) {
          continue;
        }
        const lc: [number, number] = [ex, slope.getExternalYIntersection(ex)];
        const rc: [number, number] = [xx, slope.getExternalYIntersection(xx)];
        if (distPoints(lc, rc) <= slope.minFailureDistance) continue;
        const localPlanes = generatePlanesWithScale(
          slope,
          lc,
          rc,
          Math.max(4, Math.ceil(grid.numCircles / 2)),
          1.1,
        );
        addPlanes(localPlanes);
        if (generated.length >= refinedIterations) break;
      }
      if (generated.length >= refinedIterations) break;
    }
  }

  return generated;
}

/**
 * One level of the local pattern search that follows the grid search and
 * generateRefinedPlanes.  Entry, exit and sagitta (chord-to-arc distance)
 * of the best surfaces so far are moved by steps that halve with each
 * level, so repeated levels converge on the minimum between grid points
 * instead of stopping at the grid resolution.
 */
export function generateLocalPlanes(
  slope: Slope,
  evaluatedPlanes: SearchPlane[],
  budget: number,
  level: number,
  /** Keys of all planes so far; new planes are added to it. */
  existingKeys: Set<string> = new Set(evaluatedPlanes.map(planeKey)),
  numSeeds = 4,
): SearchPlane[] {
  if (budget <= 0) return [];
  // The numSeeds best planes, then the best of each further basin that
  // is close to the best.
  const seeds = chooseSeeds(slope, evaluatedPlanes, numSeeds, LOCAL_BASIN_MARGIN);
  if (seeds.length === 0) return [];
  const interfaces = materialInterfaces(slope);

  const generated: SearchPlane[] = [];

  const grid = getSearchGridSpec(slope);
  const [entryLeftX, entryRightX, exitLeftX, exitRightX] = slope.limits;
  const scale = 0.5 ** (level + 1);
  const entryStep =
    grid.numPointsTop > 1
      ? (Math.abs(entryRightX - entryLeftX) / (grid.numPointsTop - 1)) * scale
      : 0;
  const exitStep =
    grid.numPointsBot > 0
      ? (Math.abs(exitRightX - exitLeftX) / grid.numPointsBot) * scale
      : 0;
  // The grid spaces sagittas by 1/numCircles of the largest one.
  const sagittaStep = (2 * scale) / Math.max(grid.numCircles, 1);

  for (const seed of seeds) {
    const vx = seed.rc[0] - seed.lc[0];
    const vy = seed.rc[1] - seed.lc[1];
    const halfChord = Math.hypot(vx, vy) / 2;
    const centreToChord = Math.sqrt(
      Math.max(0, seed.radius ** 2 - halfChord ** 2),
    );
    const centreAbove =
      vx * (seed.cy - seed.lc[1]) - vy * (seed.cx - seed.lc[0]) > 0;
    const sagitta = centreAbove
      ? seed.radius - centreToChord
      : seed.radius + centreToChord;

    for (const de of [-entryStep, 0, entryStep]) {
      const ex = seed.lc[0] + de;
      if (ex < entryLeftX || ex > entryRightX) continue;
      for (const dx of [-exitStep, 0, exitStep]) {
        const xx = seed.rc[0] + dx;
        if (xx < exitLeftX || xx > exitRightX) continue;
        const lc: [number, number] = [ex, slope.getExternalYIntersection(ex)];
        const rc: [number, number] = [xx, slope.getExternalYIntersection(xx)];
        if (distPoints(lc, rc) <= slope.minFailureDistance) continue;
        /** Adds the circle with this chord-to-arc distance; true when the budget is spent. */
        const add = (chordToEdge: number, tangentTo?: number): boolean => {
          const circle = circleThrough(lc, rc, chordToEdge);
          if (!circle) return false;
          const { cx: cX, cy: cY, radius } = circle;
          const ends = selectEntryExit(slope, cX, cY, radius);
          if (!ends) return false;
          const plane: SearchPlane = {
            lc: ends[0],
            rc: ends[1],
            cx: cX,
            cy: cY,
            radius,
            fos: 100,
            slices: null,
          };
          if (tangentTo !== undefined) {
            if (touchesGroundBetweenEnds(slope, plane, interfaces[tangentTo])) return false;
            plane.tangentTo = tangentTo;
          }
          if (!isPlaneWithinExternalBoundary(slope, plane)) return false;
          if (!isPlaneWithinSearchLimits(slope, plane)) return false;
          const key = planeKey(plane);
          if (existingKeys.has(key)) return false;
          existingKeys.add(key);
          generated.push(plane);
          return generated.length >= budget;
        };
        for (const ds of [-sagittaStep, 0, sagittaStep]) {
          if (de === 0 && dx === 0 && ds === 0) continue;
          if (add(sagitta * (1 + ds))) return generated;
        }
        // A seed tangent to an interface stays tangent to it as its ends
        // move: the search follows the tangent line (USACE EM 1110-2-1902,
        // 2003, fig. C-6; Edris & Wright 1987).
        const iface = seed.tangentTo !== undefined ? interfaces[seed.tangentTo] : undefined;
        if (iface && (de !== 0 || dx !== 0)) {
          const chordToEdge = tangentChordToEdge(lc, rc, iface, 2 * sagitta);
          if (chordToEdge !== null && add(chordToEdge, seed.tangentTo)) return generated;
        }
      }
    }
  }
  return generated;
}

// ── setEntryExitPlanes ────────────────────────────────────────────

/**
 * Generate search planes based on predetermined entry/exit points.
 */
export function setEntryExitPlanes(slope: Slope): void {
  const { numCircles, numPointsTop, numPointsBot } = getSearchGridSpec(slope);

  const [entryLeftX, entryRightX, exitLeftX, exitRightX] = slope.limits;

  // Generate entry (left) coordinates
  const leftCoords: [number, number][] = [];
  for (let n = 0; n < numPointsTop; n++) {
    const x =
      entryLeftX + (n / (numPointsTop - 1)) * (entryRightX - entryLeftX);
    leftCoords.push([x, slope.getExternalYIntersection(x)]);
  }

  // Generate exit (right) coordinates
  const rightCoords: [number, number][] = [];
  for (let n = 0; n <= numPointsBot; n++) {
    const x = exitLeftX + (n / numPointsBot) * (exitRightX - exitLeftX);
    rightCoords.push([x, slope.getExternalYIntersection(x)]);
  }

  // Add coordinates adjacent to loads
  for (const ll of slope.lineLoads) {
    const x = ll.x - 0.001;
    leftCoords.push([x, slope.getExternalYIntersection(x)]);
  }
  for (const udl of slope.udls) {
    const x = Math.min(udl.x1, udl.x2) - 0.001;
    leftCoords.push([x, slope.getExternalYIntersection(x)]);
  }

  // Generate search planes
  let allPlanes: SearchPlane[] = [];
  for (const lCo of leftCoords) {
    for (const rCo of rightCoords) {
      if (distPoints(lCo, rCo) > slope.minFailureDistance) {
        const newPlanes = generatePlanes(slope, lCo, rCo, numCircles);
        allPlanes = allPlanes.concat(newPlanes);
      }
    }
  }

  // Filter valid planes
  const validPlanes = allPlanes.filter((plane) =>
    isPlaneWithinSearchLimits(slope, plane),
  );

  slope.setSearchPlanes(validPlanes);
}

// ── addSingleEntryExitPlane ───────────────────────────────────────

/**
 * Add potential failure surfaces defined by entry and exit x-coordinates.
 */
export function addSingleEntryExitPlane(
  slope: Slope,
  lcX: number,
  rcX: number,
  numCircles = 5,
): void {
  const planes = generatePlanes(
    slope,
    [lcX, slope.getExternalYIntersection(lcX)],
    [rcX, slope.getExternalYIntersection(rcX)],
    numCircles,
  );
  slope.addIndividualPlanes(planes);
}

// ── addSingleCircularPlane ────────────────────────────────────────

/**
 * Add a specific circular failure surface to the analysis.
 */
export function addSingleCircularPlane(
  slope: Slope,
  cx: number,
  cy: number,
  radius: number,
): void {
  const ends = selectEntryExit(slope, cx, cy, radius);
  if (ends) {
    const plane: SearchPlane = {
      lc: ends[0],
      rc: ends[1],
      cx,
      cy,
      radius,
      fos: 100,
      slices: null,
    };

    if (isPlaneWithinExternalBoundary(slope, plane)) {
      slope.addIndividualPlanes([plane]);
    }
  }
}
