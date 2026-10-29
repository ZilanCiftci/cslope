/**
 * Slice creation and generation for slope stability analysis.
 */

import type { GeometryWithMaterial, PartialFactors, Slice } from "../types/index";
import { designStrength, needsLayerTop, resolveStrength, resolveUnitWeight } from "../types/index";
import { WATER_UNIT_WEIGHT, SLICE_DEDUP_TOLERANCE } from "../types/constants";
import {
  getCircleYCoordinateAtX,
  getCircleLineIntersections,
  getYAtX,
  getYAtXMany,
  calculateAllLoads,
  isPointInPolygon,
} from "../math/index";
import type { Slope } from "./slope";
import { materialLayerTopAt, polylineYFrom } from "./geometry-ops";
import { polylineCrossingsX, polylineYAt, type Pt } from "./surface";
import { applyReinforcement } from "./reinforcement";

// ── createSlice ───────────────────────────────────────────────────

/** Grid of the local origin for clipping material regions (see createSlice). */
const LOCAL_ORIGIN_GRID = 4096;

// ── Clipping buffers ──────────────────────────────────────────────
// A slice clips every material polygon four times (the vertical strip,
// then the two slip-surface edges). Done with fresh arrays and `map`
// passes, the allocation was a fifth of a whole search. The clips below
// write into two reused buffers instead, with the same arithmetic in the
// same order, so the results are identical to the last bit.

let bufAx = new Float64Array(64);
let bufAy = new Float64Array(64);
let bufBx = new Float64Array(64);
let bufBy = new Float64Array(64);

/** Make both buffers hold at least `n` vertices. */
function ensureClipCapacity(n: number): void {
  if (bufAx.length >= n) return;
  let cap = bufAx.length;
  while (cap < n) cap *= 2;
  bufAx = new Float64Array(cap);
  bufAy = new Float64Array(cap);
  bufBx = new Float64Array(cap);
  bufBy = new Float64Array(cap);
}

/**
 * Clip the polygon in (inX, inY)[0..n) by the half-plane ax + by + c ≥ 0
 * (Sutherland–Hodgman) into (outX, outY); returns the vertex count. Same
 * arithmetic as `clipPolygonHalfplane` in math/polygon.ts.
 */
function clipHalfplaneInto(
  inX: ArrayLike<number>,
  inY: ArrayLike<number>,
  n: number,
  a: number,
  b: number,
  c: number,
  outX: Float64Array,
  outY: Float64Array,
): number {
  let m = 0;
  for (let i = 0; i < n; i++) {
    const k = i + 1 === n ? 0 : i + 1;
    const p1x = inX[i],
      p1y = inY[i];
    const p2x = inX[k],
      p2y = inY[k];
    const d1 = a * p1x + b * p1y + c;
    const d2 = a * p2x + b * p2y + c;
    const in1 = d1 >= -1e-12;
    const in2 = d2 >= -1e-12;
    if (in1) {
      if (in2) {
        outX[m] = p2x;
        outY[m++] = p2y;
      } else {
        const dx = p2x - p1x;
        const dy = p2y - p1y;
        const denom = a * dx + b * dy;
        if (Math.abs(denom) > 1e-14) {
          const t = -d1 / denom;
          outX[m] = p1x + t * dx;
          outY[m++] = p1y + t * dy;
        }
      }
    } else if (in2) {
      const dx = p2x - p1x;
      const dy = p2y - p1y;
      const denom = a * dx + b * dy;
      if (Math.abs(denom) > 1e-14) {
        const t = -d1 / denom;
        outX[m] = p1x + t * dx;
        outY[m++] = p1y + t * dy;
      }
      outX[m] = p2x;
      outY[m++] = p2y;
    }
  }
  return m;
}

/** Shoelace area of the first `n` vertices (as `calculatePolygonArea`). */
function polygonAreaN(x: Float64Array, y: Float64Array, n: number): number {
  if (n < 3) return 0.0;
  let area = 0.0;
  for (let i = 0; i < n; i++) {
    const j = i + 1 === n ? 0 : i + 1;
    area += x[i] * y[j];
    area -= x[j] * y[i];
  }
  return Math.abs(area) / 2.0;
}

/**
 * Ray-casting point test on the polygon shifted by (−sx, −sy), the same
 * arithmetic as `isPointInPolygon` on the shifted arrays.
 */
function pointInShiftedPolygon(
  px: number,
  py: number,
  polyX: ArrayLike<number>,
  polyY: ArrayLike<number>,
  n: number,
  sx: number,
  sy: number,
): boolean {
  let inside = false;
  for (let i = 0; i < n; i++) {
    const j = i + 1 === n ? 0 : i + 1;
    const xi = polyX[i] - sx,
      yi = polyY[i] - sy;
    const xj = polyX[j] - sx,
      yj = polyY[j] - sy;
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi + 1e-15) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * Create a single Slice from its geometric parameters.
 */
export function createSlice(
  x0: number,
  x1: number,
  y0Top: number,
  y1Top: number,
  cx: number,
  cy: number,
  radius: number,
  udlForce: number,
  llForce: number,
  waterYMean: number | null,
  waterH: number | null,
  materialGeometries: GeometryWithMaterial[],
  /**
   * Per-material water: when given, pore pressure comes from the water
   * line of the base material (overriding `waterYMean` / `waterH`).
   */
  waterForMaterial?: (
    material: GeometryWithMaterial["material"],
  ) => { yMean: number; h: number } | null,
  /**
   * Base of a non-circular surface (straight within the slice); then
   * (cx, cy) is the axis point for moment equilibrium and `radius` unused.
   */
  base?: (x: number) => number,
  /**
   * Water line of a material at the slice edges [y at x0, y at x1], for
   * materials with a saturated unit weight (null: no water there).
   */
  waterForWeight?: (
    material: GeometryWithMaterial["material"],
  ) => [number, number] | null,
): Slice | null {
  const x = (x0 + x1) / 2;
  const dx = cx - x;
  const yTop = (y0Top + y1Top) / 2;
  const width = Math.abs(x0 - x1);

  const y0Bottom = base ? base(x0) : getCircleYCoordinateAtX(cx, cy, radius, x0);
  const y1Bottom = base ? base(x1) : getCircleYCoordinateAtX(cx, cy, radius, x1);
  const yBottom = base
    ? (y0Bottom + y1Bottom) / 2
    : getCircleYCoordinateAtX(cx, cy, radius, x);

  if (yBottom > yTop) return null; // Invalid: bottom above top

  const height = Math.abs(yTop - yBottom);
  const e = cy - (yTop + yBottom) / 2;

  // Alpha angle: positive where the base descends towards +x (the
  // sliding direction). On a circle the tangent at the slice middle.
  const alpha = base
    ? Math.atan((y0Bottom - y1Bottom) / width)
    : Math.atan(dx / (cy - yBottom));

  // Moment arms about the centre / axis point. The base shear resists
  // with arm R; the normal force has arm `normalArm` (0 on a circle,
  // where it passes through the centre).
  let shearArm = radius;
  let normalArm = 0;
  if (base) {
    const bx = x - cx;
    const by = yBottom - cy;
    shearArm = -(bx * Math.sin(alpha) + by * Math.cos(alpha));
    normalArm = bx * Math.cos(alpha) - by * Math.sin(alpha);
  }

  // Base length consistent with the base inclination the solvers use
  // (the equilibrium equations assume a straight base of length b/cos α).
  // The arc length over-credited cohesion on steep slices: on a nearly
  // vertical entry slice by ~40 %, e.g. +5 % FOS at 50 slices on
  // V068 compared with a converged slice count.
  const baseLength = width / Math.cos(alpha);

  // Pore water pressure
  let U = 0;
  if (waterYMean !== null && waterH !== null) {
    U = Math.max(waterYMean - yBottom, 0) * WATER_UNIT_WEIGHT * waterH;
  }

  // ── Material intersection and weight calculation ─────────────
  // Build the clipping polygon for material intersection
  // geometry_for_area: [(x0, 10000), (x1, 10000), (x1, y1_bottom), (xm, ym_bottom), (x0, y0_bottom)]
  // The top at y = 10000 is a fixed ceiling: material above it is not
  // counted, so model elevations must stay below 10000 m.
  const clipPoly: [number, number][] = [
    [x0, 10000],
    [x1, 10000],
    [x1, y1Bottom],
    [x, yBottom],
    [x0, y0Bottom],
  ];

  // Compute edge coefficients for the slip-surface edges (indices 2-3 and 3-4),
  // relative to a local origin (ox, oy) near the slice: with real-world
  // coordinates (eastings ~1e6 and elevations ~1e3) the constant term x·y
  // of global coefficients lost the base by more than `lift` below, and the
  // slice got the wrong base material. The origin is a multiple of 4096 so
  // that models near the global origin are computed exactly as before.
  const ox = Math.round(x / LOCAL_ORIGIN_GRID) * LOCAL_ORIGIN_GRID;
  const oy = Math.round(yBottom / LOCAL_ORIGIN_GRID) * LOCAL_ORIGIN_GRID;
  const edgeCoeffs: [number, number, number][] = [];
  for (let i = 2; i < 4; i++) {
    const p1: [number, number] = [clipPoly[i][0] - ox, clipPoly[i][1] - oy];
    const p2: [number, number] = [clipPoly[i + 1][0] - ox, clipPoly[i + 1][1] - oy];
    const a = p2[1] - p1[1];
    const b = -(p2[0] - p1[0]);
    const c = p2[0] * p1[1] - p2[1] * p1[0];
    edgeCoeffs.push([a, b, c]);
  }

  const lift = 1e-6 * Math.max(1, yTop - yBottom);
  let baseMaterial: GeometryWithMaterial["material"] | null = null;
  // Base material found inside its fragment (not the fallback below).
  let baseInside = false;
  let firstIntersected: GeometryWithMaterial["material"] | null = null;
  let totalWeight = 0;
  let totalArea = 0;

  for (const m of materialGeometries) {
    // Fast X-bounds check
    if (m.xMax !== undefined && m.xMin !== undefined) {
      if (m.xMax < x0 || m.xMin > x1) continue;
    }

    // Step 1: Vertical clip (global coordinates), as clipPolygonVertical.
    const nIn = m.px.length;
    ensureClipCapacity(2 * nIn + 8);
    let n = clipHalfplaneInto(m.px, m.py, nIn, 1.0, 0.0, -x0, bufAx, bufAy);
    if (n > 0) n = clipHalfplaneInto(bufAx, bufAy, n, -1.0, 0.0, x1, bufBx, bufBy);
    if (n < 3) continue;

    // Step 2: Clip by slip-surface edges (in local coordinates)
    for (let i = 0; i < n; i++) {
      bufBx[i] = bufBx[i] - ox;
      bufBy[i] = bufBy[i] - oy;
    }
    // Ping-pong between the buffers: the result ends in (lx, ly).
    let lx = bufBx, ly = bufBy, tx = bufAx, ty = bufAy;
    let valid = true;
    for (const [a, b, c] of edgeCoeffs) {
      n = clipHalfplaneInto(lx, ly, n, a, b, c, tx, ty);
      [lx, ly, tx, ty] = [tx, ty, lx, ly];
      if (n < 3) {
        valid = false;
        break;
      }
    }
    if (!valid) continue;
    if (firstIntersected === null) firstIntersected = m.material;

    // Calculate area and weight
    const area = polygonAreaN(lx, ly, n);
    totalArea += area;
    let gamma = m.material.unitWeight;
    if (m.material.model.kind === "spatial-mohr-coulomb") {
      // The fragment in global coordinates, only for a spatially varying
      // unit weight (its centroid).
      const mpx: number[] = new Array(n);
      const mpy: number[] = new Array(n);
      for (let i = 0; i < n; i++) {
        mpx[i] = lx[i] + ox;
        mpy[i] = ly[i] + oy;
      }
      gamma = fragmentUnitWeight(m.material, mpx, mpy, area);
    }
    totalWeight += area * gamma;
    const gammaSat = m.material.model.unitWeightSat;
    if (gammaSat !== undefined && gammaSat !== gamma && waterForWeight) {
      // The part of the fragment below the material's water line (straight
      // across the slice) weighs γsat instead of γ.
      const w = waterForWeight(m.material);
      if (w) {
        const s = (w[1] - w[0]) / (x1 - x0);
        const nb = clipHalfplaneInto(lx, ly, n, s, -1, w[0] - oy - s * (x0 - ox), tx, ty);
        if (nb >= 3) {
          totalWeight += polygonAreaN(tx, ty, nb) * (gammaSat - gamma);
        }
      }
    }

    // Check if this material is at the base of the slice
    // Test in coordinates local to the slice base: with real-world
    // eastings (~1e5..1e7) a fixed 1e-10 offset is below the floating
    // point resolution and the base material was missed.
    if (pointInShiftedPolygon(0, lift, lx, ly, n, x - ox, yBottom - oy)) {
      baseMaterial = m.material;
      baseInside = true;
    }
  }

  // A base exactly on a layer boundary (a polyline run along it, a circle
  // grazing it at the slice centre): the point just above the base lies in
  // the upper material, which a surface 1 mm lower would not see at all.
  // Soil on soil: the base takes the weaker of the two, the limit a surface
  // just inside the weaker layer approaches, so a surface along the top or
  // the bottom of a weak layer is analysed in the weak layer. The strengths
  // are compared at the slice's normal stress by the ordinary method of
  // slices, σ′ = W cos²α / b − u. Not when the lower material is bedrock
  // or high-strength: a surface on the rock head runs in the soil above it,
  // so a circle tangent to the rock stays analysable instead of being
  // rejected as entering the rock.
  let liftBelow = false;
  if (baseInside && baseMaterial !== null) {
    const above = baseMaterial;
    const holdsBelow = (g: GeometryWithMaterial) =>
      (g.xMin === undefined || g.xMax === undefined || (x >= g.xMin && x <= g.xMax)) &&
      pointInShiftedPolygon(0, -lift, g.px, g.py, g.px.length, x, yBottom);
    if (!materialGeometries.some((g) => g.material === above && holdsBelow(g))) {
      const below = materialGeometries.find((g) => g.material !== above && holdsBelow(g))?.material;
      const kind = below?.model.kind;
      if (below && kind !== "impenetrable" && kind !== "high-strength") {
        const sigma = (totalWeight / width) * Math.cos(alpha) ** 2;
        const strengthAt = (mat: GeometryWithMaterial["material"], yProbe: number): number => {
          const k = mat.model.kind;
          if (k === "impenetrable" || k === "high-strength") return Infinity;
          const yLT = needsLayerTop(mat.model)
            ? (materialLayerTopAt(materialGeometries, mat, x, yProbe) ?? undefined)
            : undefined;
          const st = resolveStrength(mat.model, { yBottom, x, yGround: yTop, yLayerTop: yLT, alpha });
          const w = waterForMaterial
            ? waterForMaterial(mat)
            : waterYMean !== null && waterH !== null
              ? { yMean: waterYMean, h: waterH }
              : null;
          const u = w ? Math.max(w.yMean - yBottom, 0) * WATER_UNIT_WEIGHT * w.h : 0;
          const drained = st.cohesion + Math.max(0, sigma - u) * Math.tan((st.frictionAngle * Math.PI) / 180);
          return st.isCombined ? Math.min(drained, st.cohesionUndrained) : drained;
        };
        if (strengthAt(below, yBottom - lift) < strengthAt(above, yBottom + lift)) {
          baseMaterial = below;
          liftBelow = true;
        }
      }
    }
  }

  // Fallback: use first intersected material if base not found
  if (baseMaterial === null) baseMaterial = firstIntersected;

  if (baseMaterial === null) return null; // No material → invalid slice

  if (waterForMaterial) {
    const water = waterForMaterial(baseMaterial);
    U = water ? Math.max(water.yMean - yBottom, 0) * WATER_UNIT_WEIGHT * water.h : 0;
  }

  // Top of the base material's layer, for depth measured from it: searched
  // in the full material regions just above the base centre.
  let yLayerTop: number | undefined;
  if (baseInside && needsLayerTop(baseMaterial.model)) {
    yLayerTop =
      materialLayerTopAt(materialGeometries, baseMaterial, x, yBottom + (liftBelow ? -lift : lift)) ??
      undefined;
  }

  // Resolve strength via the material model plugin system
  const strength = resolveStrength(baseMaterial.model, {
    yBottom,
    x,
    yGround: yTop,
    yLayerTop,
    alpha,
  });

  const cohesion = strength.cohesion;
  const cohesionUndrained = strength.cohesionUndrained;
  const frictionAngle = strength.frictionAngle;
  const phi = (frictionAngle * Math.PI) / 180;

  const slice: Slice = {
    x,
    xLeft: x0,
    xRight: x1,
    y0Top,
    y1Top,
    yTop,
    y0Bottom,
    y1Bottom,
    yBottom,
    width,
    height,
    area: totalArea,
    alpha,
    baseLength,
    weight: totalWeight,
    dx,
    e,
    R: shearArm,
    normalArm,
    udl: udlForce,
    ll: llForce,
    isValid: true,
    baseMaterial,
    cohesion,
    cohesionUndrained,
    ...(strength.cohesionUndrainedPart !== undefined
      ? { cohesionUndrainedPart: strength.cohesionUndrainedPart }
      : {}),
    frictionAngle,
    phi,
    U,
    isCombined: strength.isCombined,
    ...(strength.hoekBrown ? { hoekBrown: strength.hoekBrown } : {}),
    skipSurface: strength.skipSurface,
    impenetrable: strength.impenetrable,
  };

  return slice;
}

// ── Water at a slice ──────────────────────────────────────────────

/**
 * A water line that does not reach a slice. Water lines are continued
 * horizontally to the model edges (as is common practice), so this does not
 * happen for a line set on the slope; should it, the surface is invalid (as
 * commercial programs give no FOS where the water table does not span the slip surface) instead of
 * silently getting no pore pressure there.
 */
export const WATER_LINE_GAP = "The water table does not span the slip surface.";

/**
 * Water elevation at the slice midpoint and the head correction factor
 * cos²θ for an inclined water line, or null without a line (no pore
 * pressure). Throws when the line does not reach the slice.
 */
function waterAtSlice(
  line: { x: number[]; y: number[] } | null,
  xLeft: number,
  xRight: number,
  xMid: number,
  verticalHead = false,
): { yMean: number; h: number } | null {
  if (!line) return null;
  const wy1 = lineYFrom(line, xLeft, "right");
  const wy2 = lineYFrom(line, xRight, "left");
  const wyMid = getYAtX(line.x, line.y, xMid);
  if (!Number.isFinite(wy1) || !Number.isFinite(wy2) || !Number.isFinite(wyMid)) {
    throw new Error(WATER_LINE_GAP);
  }
  return { yMean: wyMid, h: headFactor(line, wy1, wy2, xLeft, xRight, verticalHead) };
}

/**
 * Factor h on the vertical head over a slice base, u = γw·(yw − yb)·h:
 * cos²θ with θ the inclination of the water line across the slice (the
 * equipotentials of seepage parallel to a straight phreatic surface are
 * normal to it, Duncan & Wright 2014, ch. 6), or 1 with vertical head.
 * Also 1 where the line has a vertical segment inside the slice: a step in
 * the line is a wall or a sheet pile between two water levels, not a
 * seepage gradient, and the secant across it is no flow line. (Water-line
 * vertices are slice edges, so this is only a safeguard.)
 */
export function headFactor(
  line: { x: number[]; y: number[] },
  wyLeft: number,
  wyRight: number,
  xLeft: number,
  xRight: number,
  verticalHead: boolean,
): number {
  if (verticalHead || wyLeft === wyRight) return 1;
  for (let k = 1; k < line.x.length; k++) {
    const xs = line.x[k];
    if (xs === line.x[k - 1] && line.y[k] !== line.y[k - 1] && xs > xLeft && xs < xRight) return 1;
  }
  return Math.cos(Math.atan((wyRight - wyLeft) / (xRight - xLeft))) ** 2;
}

const lineYFrom = (line: { x: number[]; y: number[] }, x: number, side: "left" | "right") =>
  polylineYFrom(line.x, line.y, x, side);

/**
 * Water line that gives the free water standing on the ground at x: the
 * line governing pore pressure in the material just below the ground
 * there (its own line, else the main line), or null without water. x must
 * not lie on a vertical face of the ground.
 *
 * External water is a load on the ground plus hydrostatic pore pressure
 * below it, and the two must come from the same water level, else the
 * base carries the pore pressure of a pond whose weight is missing (or the
 * reverse) and the FOS is wrong by about the whole water load (Duncan &
 * Wright 2014, ch. 6). The water at the ground surface is the water of
 * the surface material, so that material's line decides both.
 */
function freeWaterLineAt(slope: Slope, x: number): { x: number[]; y: number[] } | null {
  if (!slope.hasMaterialWaterTables) return slope.hasWaterTable ? slope.waterRLXY : null;
  const surf = slope.surfaceLineXY;
  const yGround = surf ? getYAtX(surf.x, surf.y, x) : Number.NaN;
  let material: GeometryWithMaterial["material"] | null = null;
  if (surf && Number.isFinite(yGround)) {
    const y = yGround - 1e-6 * Math.max(1, Math.abs(surf.x[surf.x.length - 1] - surf.x[0]));
    material = slope.materialGeometries.find((g) => isPointInPolygon(x, y, g.px, g.py))?.material ?? null;
  }
  return slope.getWaterLineForMaterial(material);
}

// ── getSlices ─────────────────────────────────────────────────────

/**
 * Divide a circular failure surface into vertical slices.
 *
 * @param slope The Slope model.
 * @param x0 Left entry point x.
 * @param x1 Right exit point x.
 * @param cx Circle center x.
 * @param cy Circle center y.
 * @param radius Circle radius.
 * @returns Array of valid Slice objects.
 */
export function getSlices(
  slope: Slope,
  entryX: number,
  x1: number,
  cx: number,
  cy: number,
  radius: number,
  /**
   * Non-circular surface: polyline from entry to exit (x increasing);
   * (cx, cy) is then the axis point and `radius` is unused.
   */
  points?: readonly Pt[],
): Slice[] {
  if (entryX >= x1) throw new Error("x0 must be less than x1");

  const surfXY = slope.surfaceLineXY;
  if (!surfXY) throw new Error("Surface line not defined");
  const poly = points && points.length >= 2 ? points : null;
  const baseY = poly
    ? (x: number) => polylineYAt(poly, x)
    : (x: number) => getCircleYCoordinateAtX(cx, cy, radius, x);

  // A tension crack cuts the surface off where it reaches the crack depth
  // on the upslope side; a surface that never gets that deep has no
  // sliding mass below the crack zone.
  // With the automatic depth the crack is where the surface is as deep as
  // the Rankine depth of the soil there, so re-slicing from the crack finds
  // the same crack.
  let x0 = entryX;
  let crackDepth = 0;
  if (slope.tensionCrackAuto) {
    const depthAt = (x: number) => rankineCrackDepth(slope, x);
    if (depthAt(entryX) > 0 || depthAt(x1) > 0) {
      const xc = findCrackX(surfXY, entryX, x1, baseY, depthAt);
      if (xc === null) return [];
      x0 = xc;
      crackDepth = depthAt(xc);
    }
  } else if (slope.tensionCrackDepth > 0) {
    crackDepth = slope.tensionCrackDepth;
    const xc = findCrackX(surfXY, entryX, x1, baseY, () => crackDepth);
    if (xc === null) return [];
    x0 = xc;
  }

  const dist = x1 - x0;
  const b = dist / slope.sliceCount;
  const allSlicesSet = new Set<number>();
  allSlicesSet.add(x0);
  allSlicesSet.add(x1);

  // A polyline's kinks must be slice boundaries (straight bases), also
  // with fixed slices.
  if (poly) {
    for (const [px] of poly) if (px > x0 && px < x1) allSlicesSet.add(px);
  }
  if (slope.fixedSlices) {
    for (const fx of slope.fixedSlices) {
      if (fx > x0 && fx < x1) allSlicesSet.add(fx);
    }
  }
  // Geometry-critical points, also with fixed slices: the fixed
  // boundaries are added to them, so that a slice still has one material
  // and a straight water line along its base.
  {
    const radiusSq = radius ** 2;
    for (const mg of slope.materialGeometries) {
      // Polygon corner points within the sliding mass
      for (let i = 0; i < mg.px.length; i++) {
        if (mg.px[i] <= x0 || mg.px[i] >= x1) continue;
        const inside = poly
          ? mg.py[i] >= baseY(mg.px[i]) - 1e-9
          : (mg.px[i] - cx) ** 2 + (mg.py[i] - cy) ** 2 <= radiusSq + 1e-9;
        if (inside) allSlicesSet.add(mg.px[i]);
      }
      // Surface-polygon edge intersections
      const intersections = poly
        ? polylineCrossingsX(poly, mg.px, mg.py, true)
        : getCircleLineIntersections(cx, cy, radius, mg.px, mg.py).map(
            ([ix]) => ix,
          );
      for (const ix of intersections) {
        if (ix > x0 && ix < x1) {
          allSlicesSet.add(ix);
        }
      }
    }

    // Concentrated and edge loads: a line load gets its own thin slice so
    // its moment arm is exact, and UDL ends become slice boundaries.
    const LINE_LOAD_HALF_WIDTH = 0.01;
    for (const ll of slope.lineLoads) {
      for (const x of [ll.x - LINE_LOAD_HALF_WIDTH, ll.x + LINE_LOAD_HALF_WIDTH]) {
        if (x > x0 && x < x1) allSlicesSet.add(x);
      }
    }
    for (const udl of slope.udls) {
      for (const x of [udl.x1, udl.x2]) {
        if (x > x0 && x < x1) allSlicesSet.add(x);
      }
    }

    // Water table intersections (every line, so per-material lines too)
    for (const waterXY of slope.allWaterLines) {
      const waterIntersections = poly
        ? polylineCrossingsX(poly, waterXY.x, waterXY.y, false)
        : getCircleLineIntersections(cx, cy, radius, waterXY.x, waterXY.y).map(
            ([ix]) => ix,
          );
      for (const ix of waterIntersections) {
        if (ix > x0 && ix < x1) {
          allSlicesSet.add(ix);
        }
      }
      // The line's own kinks above the slip surface: between slice edges
      // the line is then straight, so the pore pressure at the slice centre
      // is the slice's mean, the γsat part and the free water on the ground
      // are exact, and a vertical step (a wall, a sheet pile) lies on a
      // slice edge instead of being read as a steep line across a slice.
      // A vertex on a straight run (or an end continuing horizontally)
      // changes nothing and is left out.
      const wx = waterXY.x, wy = waterXY.y, nw = wx.length;
      for (let k = 0; k < nw; k++) {
        const vx = wx[k];
        if (!(vx > x0 && vx < x1) || wy[k] < baseY(vx) - 1e-9) continue;
        // Neighbours, past repeated points.
        let p = k - 1;
        while (p >= 0 && wx[p] === vx && wy[p] === wy[k]) p--;
        let q = k + 1;
        while (q < nw && wx[q] === vx && wy[q] === wy[k]) q++;
        const ax = p >= 0 ? vx - wx[p] : 1, ay = p >= 0 ? wy[k] - wy[p] : 0;
        const bx = q < nw ? wx[q] - vx : 1, by = q < nw ? wy[q] - wy[k] : 0;
        if (Math.abs(ax * by - ay * bx) > 1e-12 * Math.hypot(ax, ay) * Math.hypot(bx, by)) {
          allSlicesSet.add(vx);
        }
      }
    }
  }

  // Sort and deduplicate (remove points too close together)
  let allSlicesArr = Array.from(allSlicesSet).sort((a, b) => a - b);
  allSlicesArr = allSlicesArr.filter(
    (v, i) => i === 0 || v - allSlicesArr[i - 1] > SLICE_DEDUP_TOLERANCE,
  );

  // Subdivide large intervals
  const finalX = [...allSlicesArr];
  const diffs = allSlicesArr
    .slice(0, -1)
    .map((v, i) => allSlicesArr[i + 1] - v);
  const numGeomSlices = diffs.length;

  const largeIndices = diffs
    .map((d, i) => (d > 1.5 * b ? i : -1))
    .filter((i) => i >= 0);
  const numLarge = largeIndices.length;
  const numSmall = numGeomSlices - numLarge;

  const targetFromLarge = Math.max(numLarge, slope.sliceCount - numSmall);
  const largeSum = largeIndices.reduce((s, i) => s + diffs[i], 0);

  if (targetFromLarge > 0 && largeSum > 0) {
    // At most the width up to which an interval counts as small: once the
    // short intervals (a densely digitised water line, many layer edges)
    // use up the slice count, a long interval is still cut to about the
    // nominal width instead of staying one wide slice.
    const newB = Math.min(largeSum / targetFromLarge, 1.5 * b);
    for (const i of largeIndices) {
      const d = diffs[i];
      const n = Math.round(d / newB);
      if (n > 1) {
        for (let j = 1; j < n; j++) {
          finalX.push(allSlicesArr[i] + (j * d) / n);
        }
      }
    }
  }

  const slicesX = finalX.sort((a, b) => a - b);
  const nSlices = slicesX.length - 1;
  const bArray = slicesX.slice(0, -1).map((v, i) => slicesX[i + 1] - v);
  const sxArray = slicesX.slice(0, -1).map((v, i) => (v + slicesX[i + 1]) / 2);

  // A slice whose base lies below the ground but outside the model (below
  // its base) has no soil to take its strength from: the surface is not
  // admissible. The slices are cut at every crossing with the material
  // regions, so a base is wholly inside or wholly outside, and its centre
  // decides. A base above the ground (where a circle leaves the soil
  // through a face and re-enters it below) is left to the slices.
  const baseLift = 1e-6 * Math.max(1, slope.modelHeight);
  for (const sx of sxArray) {
    const y = baseY(sx);
    if (y < slope.getExternalYIntersection(sx) - baseLift && !slope.isInsideExternalBoundary(sx, y + baseLift)) return [];
  }

  // Batch compute loads
  const udlData: [number, number, number][] = slope.udls.map((u) => [
    u.x1,
    u.x2,
    u.magnitude,
  ]);
  const llData: [number, number][] = slope.lineLoads.map((ll) => [
    ll.x,
    ll.magnitude,
  ]);
  const [udlForces, llForces] = calculateAllLoads(
    bArray,
    sxArray,
    udlData,
    llData,
  );
  const factors = slope.partialFactors;
  const loadFactor = factors?.variableLoad ?? 1;

  // Surface y at each slice edge, taken from the slice's own side: at a
  // vertical face the averaged value would put the top below the base and
  // the slice next to the face would be dropped.
  const surfaceYFrom = (x: number, side: "left" | "right") => lineYFrom(surfXY, x, side);
  const yTopsL = slicesX.slice(0, -1).map((x) => surfaceYFrom(x, "right"));
  const yTopsR = slicesX.slice(1).map((x) => surfaceYFrom(x, "left"));

  // Water table y-values
  // At the slice edges from the slice's own side, so that a vertical step
  // in the line (e.g. at a wall) does not leak into the next slice.
  let waterYL: number[] | null = null;
  let waterYR: number[] | null = null;
  let waterYMid: number[] | null = null;
  const mainLine = slope.hasWaterTable ? slope.waterRLXY : null;
  if (mainLine) {
    const w = mainLine;
    waterYL = slicesX.slice(0, -1).map((x) => lineYFrom(w, x, "right"));
    waterYR = slicesX.slice(1).map((x) => lineYFrom(w, x, "left"));
    waterYMid = getYAtXMany(w.x, w.y, sxArray);
  }

  // Free water on the ground: the line of the surface material of each
  // slice (freeWaterLineAt), at the slice edges from the slice's side.
  const freeLines = sxArray.map((x) => freeWaterLineAt(slope, x));
  const freeYsCache = new Map<{ x: number[]; y: number[] }, [number[], number[]]>();
  const freeYs = (line: { x: number[]; y: number[] }) => {
    let ys = freeYsCache.get(line);
    if (!ys) {
      ys = [
        slicesX.slice(0, -1).map((x) => lineYFrom(line, x, "right")),
        slicesX.slice(1).map((x) => lineYFrom(line, x, "left")),
      ];
      freeYsCache.set(line, ys);
    }
    return ys;
  };
  const freeYL = freeLines.map((line, i) => (line ? freeYs(line)[0][i] : Number.NaN));
  const freeYR = freeLines.map((line, i) => (line ? freeYs(line)[1][i] : Number.NaN));
  const hasFreeWater = freeLines.some((line) => line !== null);

  // A non-circular surface must stay below the ground between entry and
  // exit; a segment cutting through the air is no slip surface.
  if (poly) {
    const tol = 1e-6 * Math.max(1, x1 - x0);
    for (let i = 0; i < nSlices; i++) {
      if (
        baseY(slicesX[i]) > yTopsL[i] + tol ||
        baseY(slicesX[i + 1]) > yTopsR[i] + tol
      ) {
        return [];
      }
    }
  }

  // Create slices
  const results: Slice[] = [];
  const verticalHead = slope.porePressureHead === "vertical";
  const hasSatWeight = slope.materialGeometries.some(
    (g) => g.material.model.unitWeightSat !== undefined,
  );
  // Water y at the slice edges, once per water line (for γsat).
  const waterYsCache = new Map<{ x: number[]; y: number[] }, [number[], number[]]>();
  const waterYsFor = (material: GeometryWithMaterial["material"]) => {
    const line = slope.getWaterLineForMaterial(material);
    if (!line) return null;
    let ys = waterYsCache.get(line);
    if (!ys) {
      ys = [
        slicesX.slice(0, -1).map((x) => lineYFrom(line, x, "right")),
        slicesX.slice(1).map((x) => lineYFrom(line, x, "left")),
      ];
      waterYsCache.set(line, ys);
    }
    return ys;
  };
  for (let i = 0; i < nSlices; i++) {
    let waterYMean: number | null = null;
    let waterH: number | null = null;

    if (mainLine && waterYL && waterYR && waterYMid) {
      const wy1 = waterYL[i];
      const wy2 = waterYR[i];
      const wyMid = waterYMid[i];
      // Use midpoint water elevation for pore-pressure head so visual checks at slice
      // center align with the computed U value.
      if (
        !Number.isFinite(wy1) ||
        !Number.isFinite(wy2) ||
        !Number.isFinite(wyMid)
      ) {
        throw new Error(WATER_LINE_GAP);
      }
      waterYMean = wyMid;
      waterH = headFactor(mainLine, wy1, wy2, slicesX[i], slicesX[i + 1], verticalHead);
    }

    const s = createSlice(
      slicesX[i],
      slicesX[i + 1],
      yTopsL[i],
      yTopsR[i],
      cx,
      cy,
      radius,
      udlForces[i] * loadFactor,
      llForces[i] * loadFactor,
      waterYMean,
      waterH,
      [...slope.materialGeometries], // pass a copy
      slope.hasMaterialWaterTables
        ? (material) =>
            waterAtSlice(
              slope.getWaterLineForMaterial(material),
              slicesX[i],
              slicesX[i + 1],
              sxArray[i],
              verticalHead,
            )
        : undefined,
      poly ? baseY : undefined,
      hasSatWeight
        ? (material) => {
            const ys = waterYsFor(material);
            if (!ys) return null;
            const w0 = ys[0][i];
            const w1 = ys[1][i];
            return Number.isFinite(w0) && Number.isFinite(w1) ? [w0, w1] : null;
          }
        : undefined,
    );

    if (s !== null && s.isValid) {
      if (factors) applyMaterialFactors(s, factors);
      if (freeLines[i]) applyFreeWater(s, freeYL[i], freeYR[i], cy);
      results.push(s);
    }
  }

  // Free water against a vertical face of the ground (a wall, a quay): the
  // slice tops never include the face, so its horizontal pressure is
  // applied here, toward the higher side, like the inclined-face thrust
  // in applyFreeWater.
  if (hasFreeWater && results.length > 0) {
    const tol = 1e-6 * Math.max(1, x1 - x0);
    // Water just outside an end of the mass (the surface material there).
    const outsideY = (x: number, side: "left" | "right") => {
      const line = freeWaterLineAt(slope, side === "left" ? x - tol : x + tol);
      return line ? lineYFrom(line, x, side) : Number.NaN;
    };
    for (let k = 0; k <= nSlices; k++) {
      // Ground on each side of the boundary; outside the mass at its ends.
      const yL = k > 0 ? yTopsR[k - 1] : surfaceYFrom(x0, "left");
      const yR = k < nSlices ? yTopsL[k] : surfaceYFrom(x1, "right");
      if (!Number.isFinite(yL) || !Number.isFinite(yR) || Math.abs(yL - yR) <= tol) continue;
      const highLeft = yL > yR;
      // The face belongs to the sliding mass only where the mass is the
      // higher side (at the ends, the single slice there).
      if ((k === 0 && highLeft) || (k === nSlices && !highLeft)) continue;
      // Only the part of the face above the slip surface bounds the mass:
      // a surface leaving through the face (above its foot) must not get
      // the thrust on the face below it.
      const yLo = Math.max(Math.min(yL, yR), baseY(slicesX[k]));
      const yHi = Math.max(yL, yR);
      if (yHi - yLo <= tol) continue;
      // Water on the low side, read from that side (the line of the
      // surface material there).
      const wy = highLeft
        ? k < nSlices ? freeYL[k] : outsideY(x1, "right")
        : k > 0 ? freeYR[k - 1] : outsideY(x0, "left");
      if (!Number.isFinite(wy) || wy <= yLo) continue;
      const h1 = wy - yLo;
      const h2 = Math.max(wy - yHi, 0);
      const force = (WATER_UNIT_WEIGHT * (h1 * h1 - h2 * h2)) / 2;
      // Centroid of the trapezoidal pressure between yLo and min(wy, yHi).
      const d = Math.min(wy, yHi) - yLo;
      const yc = yLo + (d * (h1 + 2 * h2)) / (3 * (h1 + h2));
      const fx = highLeft ? -force : force;
      const xFace = slicesX[k];
      // The slice on the low side carries the force.
      const target =
        results.find((s) => Math.abs((highLeft ? s.xLeft : s.xRight) - xFace) <= SLICE_DEDUP_TOLERANCE) ??
        results.find((s) => Math.abs((highLeft ? s.xRight : s.xLeft) - xFace) <= SLICE_DEDUP_TOLERANCE);
      if (!target) continue;
      target.hForce = (target.hForce ?? 0) + fx;
      target.extraMoment = (target.extraMoment ?? 0) + fx * (cy - yc);
    }
  }

  // Water in the crack pushes the sliding mass downslope (+x): resultant
  // γw·hw²/2 at hw/3 above the crack bottom.
  const hw = crackDepth * slope.tensionCrackWater;
  if (crackDepth > 0 && hw > 0 && results.length > 0) {
    // The force acts on the slice at the crack face; if that slice was
    // dropped as degenerate, the surface is not a valid cracked mass.
    const first = results[0];
    if (Math.abs(first.xLeft - x0) > SLICE_DEDUP_TOLERANCE) return [];
    const yCrackBottom = first.y0Bottom;
    const force = 0.5 * WATER_UNIT_WEIGHT * hw * hw;
    first.hForce = (first.hForce ?? 0) + force;
    first.extraMoment =
      (first.extraMoment ?? 0) + force * (cy - (yCrackBottom + hw / 3));
  }

  applyReinforcement(slope, results, cx, cy);

  return results;
}

/**
 * Design strength of the slice base: each characteristic parameter divided
 * by its own partial factor (designStrength).
 */
function applyMaterialFactors(s: Slice, f: PartialFactors): void {
  const kind = s.baseMaterial?.model.kind;
  if (kind === "high-strength" || kind === "impenetrable") return;
  const d = designStrength(kind, s, f);
  s.cohesion = d.cohesion;
  s.cohesionUndrained = d.cohesionUndrained;
  if (d.undrained) return;
  s.phi = Math.atan(d.tanPhi);
  s.frictionAngle = (s.phi * 180) / Math.PI;
}

/**
 * Rankine depth of a tension crack at x: where the active earth pressure
 * of the soil just below the ground, σa = (γz + q)·Ka − 2c√Ka, is zero.
 * z = 2c/(γ√Ka) − q/γ, Ka = tan²(45° − φ/2); for undrained strength
 * (φ = 0) z = 2cu/γ − q/γ. Strength as in the analysis (design values with
 * partial factors), q the (factored) distributed load and any free water
 * standing on the ground at x. A combined material uses its drained c′,
 * which is what governs near the surface.
 */
export function rankineCrackDepth(slope: Slope, x: number): number {
  const surf = slope.surfaceLineXY;
  if (!surf) return 0;
  const yGround = getYAtX(surf.x, surf.y, x);
  if (!Number.isFinite(yGround)) return 0;
  const y = yGround - 1e-3;
  const geo = slope.materialGeometries.find((g) => isPointInPolygon(x, y, g.px, g.py));
  if (!geo) return 0;
  const model = geo.material.model;
  if (model.kind === "high-strength" || model.kind === "impenetrable") return 0;
  const yLayerTop = needsLayerTop(model)
    ? (materialLayerTopAt(slope.materialGeometries, geo.material, x, y) ?? undefined)
    : undefined;
  const strength = resolveStrength(model, { yBottom: y, x, yGround, yLayerTop, alpha: 0 });
  const f = slope.partialFactors;
  const { cohesion: c, tanPhi } = designStrength(model.kind, strength, f);
  const gamma = resolveUnitWeight(model, geo.material.unitWeight, x, y);
  if (!(c > 0) || !(gamma > 0)) return 0;
  const phi = Math.atan(tanPhi);
  const sqrtKa = Math.tan(Math.PI / 4 - phi / 2);
  const loadFactor = f?.variableLoad ?? 1;
  let q = 0;
  for (const u of slope.udls) {
    if (x >= Math.min(u.x1, u.x2) && x <= Math.max(u.x1, u.x2)) q += u.magnitude * loadFactor;
  }
  // Free water standing on the ground is a surcharge too (a clipped line
  // never rises above the ground): the line of the material at the ground,
  // as in getSlices (freeWaterLineAt).
  const water = slope.getWaterLineForMaterial(geo.material);
  if (water) {
    const wy = getYAtX(water.x, water.y, x);
    if (Number.isFinite(wy) && wy > yGround) q += WATER_UNIT_WEIGHT * (wy - yGround);
  }
  return Math.max(0, (2 * c) / (gamma * sqrtKa) - q / gamma);
}

/**
 * x of the tension crack: the first point from the entry where the slip
 * surface lies `depth` below the ground, or null if it never does.
 */
export function findCrackX(
  surf: { x: number[]; y: number[] },
  xEntry: number,
  xExit: number,
  baseY: (x: number) => number,
  depthAt: (x: number) => number,
): number | null {
  // Surface depth beyond the crack depth at x (≥ 0: deep enough).
  const below = (x: number) => getYAtX(surf.x, surf.y, x) - baseY(x) - depthAt(x);
  const steps = 200;
  let prev = xEntry;
  for (let k = 1; k <= steps; k++) {
    const x = xEntry + ((xExit - xEntry) * k) / steps;
    if (below(x) >= 0) {
      let lo = prev;
      let hi = x;
      for (let it = 0; it < 50; it++) {
        const mid = (lo + hi) / 2;
        if (below(mid) >= 0) hi = mid;
        else lo = mid;
      }
      return hi < xExit ? hi : null;
    }
    prev = x;
  }
  return null;
}

/**
 * Water standing above the ground (a water line above the surface, e.g. a
 * submerged slope or a lake at the toe) presses on the slice top: its
 * weight acts as a vertical load and, on an inclined surface, it pushes
 * horizontally. Without this the base carried the full pore pressure of
 * the water depth but nothing balanced it, and a fully submerged slope
 * gave about half its FOS. Commercial programs apply this automatically.
 *
 * The pressure γw·g(x), with g the water depth above the surface, is
 * integrated over the wet part of the slice top: vertical load ∫p dx,
 * horizontal force ∫p dy = slope·∫p dx, and their moment about the centre.
 */
function applyFreeWater(
  s: Slice,
  wyLeft: number,
  wyRight: number,
  cy: number,
): void {
  if (!Number.isFinite(wyLeft) || !Number.isFinite(wyRight)) return;
  const g0 = wyLeft - s.y0Top;
  const g1 = wyRight - s.y1Top;
  if (g0 <= 0 && g1 <= 0) return;
  const b = s.xRight - s.xLeft;
  if (b <= 0) return;
  // Wet part of the slice top as fractions of its width.
  let ta = 0;
  let tb = 1;
  if (g0 <= 0) ta = g0 / (g0 - g1);
  if (g1 <= 0) tb = g0 / (g0 - g1);
  const cx = s.x + s.dx;
  const surfaceSlope = (s.y1Top - s.y0Top) / b;
  const depth = (t: number) => Math.max(g0 + (g1 - g0) * t, 0);
  const xAt = (t: number) => s.xLeft + b * t;
  const yAt = (t: number) => s.y0Top + (s.y1Top - s.y0Top) * t;
  // Moment of the pressure per unit x: downward part at arm (cx − x),
  // horizontal part at arm (cy − y). Quadratic in t, so Simpson is exact.
  const momentDensity = (t: number) =>
    depth(t) * (cx - xAt(t) + surfaceSlope * (cy - yAt(t)));
  const tm = (ta + tb) / 2;
  const len = (tb - ta) * b;
  const load = WATER_UNIT_WEIGHT * len * ((depth(ta) + depth(tb)) / 2);
  const moment =
    (WATER_UNIT_WEIGHT * len *
      (momentDensity(ta) + 4 * momentDensity(tm) + momentDensity(tb))) /
    6;
  s.waterLoad = (s.waterLoad ?? 0) + load;
  s.hForce = (s.hForce ?? 0) + surfaceSlope * load;
  // The solvers already take the vertical load at the slice centre.
  s.extraMoment = (s.extraMoment ?? 0) + moment - load * s.dx;
}

/**
 * Unit weight of a clipped material fragment: the material's γ, or for a
 * spatially varying model the γ interpolated at the fragment centroid.
 */
function fragmentUnitWeight(
  material: GeometryWithMaterial["material"],
  px: number[],
  py: number[],
  area: number,
): number {
  if (material.model.kind !== "spatial-mohr-coulomb" || area <= 0) {
    return material.unitWeight;
  }
  let a2 = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0, j = px.length - 1; i < px.length; j = i++) {
    const cross = px[j] * py[i] - px[i] * py[j];
    a2 += cross;
    cx += (px[j] + px[i]) * cross;
    cy += (py[j] + py[i]) * cross;
  }
  if (Math.abs(a2) < 1e-12) return material.unitWeight;
  return resolveUnitWeight(
    material.model,
    material.unitWeight,
    cx / (3 * a2),
    cy / (3 * a2),
  );
}
