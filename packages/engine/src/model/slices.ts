/**
 * Slice creation and generation for slope stability analysis.
 */

import type { GeometryWithMaterial, PartialFactors, Slice } from "../types/index";
import { resolveStrength, resolveUnitWeight } from "../types/index";
import { WATER_UNIT_WEIGHT, SLICE_DEDUP_TOLERANCE } from "../types/constants";
import {
  getCircleYCoordinateAtX,
  getCircleLineIntersections,
  getYAtX,
  getYAtXMany,
  calculateAllLoads,
  calculatePolygonArea,
  clipPolygonVertical,
  clipPolygonHalfplane,
  isPointInPolygon,
} from "../math/index";
import type { Slope } from "./slope";
import { polylineYFrom } from "./geometry-ops";
import { polylineCrossingsX, polylineYAt, type Pt } from "./surface";
import { applyReinforcement } from "./reinforcement";

// ── createSlice ───────────────────────────────────────────────────

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
  // vertical entry slice by ~40 %, e.g. +5 % FOS at 50 slices on Slide
  // VP23 compared with a converged slice count.
  const baseLength = width / Math.cos(alpha);

  // Pore water pressure
  let U = 0;
  if (waterYMean !== null && waterH !== null) {
    U = Math.max(waterYMean - yBottom, 0) * WATER_UNIT_WEIGHT * waterH;
  }

  // ── Material intersection and weight calculation ─────────────
  // Build the clipping polygon for material intersection
  // geometry_for_area: [(x0, 10000), (x1, 10000), (x1, y1_bottom), (xm, ym_bottom), (x0, y0_bottom)]
  const clipPoly: [number, number][] = [
    [x0, 10000],
    [x1, 10000],
    [x1, y1Bottom],
    [x, yBottom],
    [x0, y0Bottom],
  ];

  // Compute edge coefficients for the slip-surface edges (indices 2-3 and 3-4)
  const edgeCoeffs: [number, number, number][] = [];
  for (let i = 2; i < 4; i++) {
    const p1 = clipPoly[i];
    const p2 = clipPoly[i + 1];
    const a = p2[1] - p1[1];
    const b = -(p2[0] - p1[0]);
    const c = p2[0] * p1[1] - p2[1] * p1[0];
    edgeCoeffs.push([a, b, c]);
  }

  let baseMaterial: GeometryWithMaterial["material"] | null = null;
  const intersectedMaterials: GeometryWithMaterial[] = [];
  let totalWeight = 0;
  let totalArea = 0;

  for (const m of materialGeometries) {
    // Fast X-bounds check
    if (m.xMax !== undefined && m.xMin !== undefined) {
      if (m.xMax < x0 || m.xMin > x1) continue;
    }

    // Step 1: Vertical clip
    let mpx: number[];
    let mpy: number[];
    [mpx, mpy] = clipPolygonVertical(m.px, m.py, x0, x1);
    if (mpx.length < 3) continue;

    // Step 2: Clip by slip-surface edges
    let valid = true;
    for (const [a, b, c] of edgeCoeffs) {
      [mpx, mpy] = clipPolygonHalfplane(mpx, mpy, a, b, c);
      if (mpx.length < 3) {
        valid = false;
        break;
      }
    }
    if (!valid) continue;

    // Create clipped material fragment
    const mFrag: GeometryWithMaterial = {
      px: mpx,
      py: mpy,
      material: m.material,
    };
    intersectedMaterials.push(mFrag);

    // Calculate area and weight
    const area = calculatePolygonArea(mpx, mpy);
    totalArea += area;
    const gamma = fragmentUnitWeight(m.material, mpx, mpy, area);
    totalWeight += area * gamma;
    const gammaSat = m.material.model.unitWeightSat;
    if (gammaSat !== undefined && gammaSat !== gamma && waterForWeight) {
      // The part of the fragment below the material's water line (straight
      // across the slice) weighs γsat instead of γ.
      const w = waterForWeight(m.material);
      if (w) {
        const s = (w[1] - w[0]) / (x1 - x0);
        const [bx, by] = clipPolygonHalfplane(mpx, mpy, s, -1, w[0] - s * x0);
        if (bx.length >= 3) {
          totalWeight += calculatePolygonArea(bx, by) * (gammaSat - gamma);
        }
      }
    }

    // Check if this material is at the base of the slice
    // Test in coordinates local to the slice base: with real-world
    // eastings (~1e5..1e7) a fixed 1e-10 offset is below the floating
    // point resolution and the base material was missed.
    const lift = 1e-6 * Math.max(1, yTop - yBottom);
    if (
      isPointInPolygon(
        0,
        lift,
        mpx.map((v) => v - x),
        mpy.map((v) => v - yBottom),
      )
    ) {
      baseMaterial = m.material;
    }
  }

  // Fallback: use first intersected material if base not found
  if (baseMaterial === null && intersectedMaterials.length > 0) {
    baseMaterial = intersectedMaterials[0].material;
  }

  if (baseMaterial === null) return null; // No material → invalid slice

  if (waterForMaterial) {
    const water = waterForMaterial(baseMaterial);
    U = water ? Math.max(water.yMean - yBottom, 0) * WATER_UNIT_WEIGHT * water.h : 0;
  }

  // Resolve strength via the material model plugin system
  const strength = resolveStrength(baseMaterial.model, {
    yBottom,
    x,
    yGround: yTop,
    alpha,
  });

  const materialType = baseMaterial.materialType;
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
    materialType,
    cohesion,
    cohesionUndrained,
    frictionAngle,
    phi,
    U,
    isCombined: strength.isCombined,
    skipSurface: strength.skipSurface,
    impenetrable: strength.impenetrable,
  };

  return slice;
}

// ── Water at a slice ──────────────────────────────────────────────

/**
 * Water elevation at the slice midpoint and the head correction factor
 * cos²θ for an inclined water line, or null when the slice lies outside
 * the line's x-range (no pore pressure).
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
    return null;
  }
  const h =
    !verticalHead && wy1 !== wy2
      ? Math.cos(Math.atan((wy2 - wy1) / (xRight - xLeft))) ** 2
      : 1;
  return { yMean: wyMid, h };
}

const lineYFrom = (line: { x: number[]; y: number[] }, x: number, side: "left" | "right") =>
  polylineYFrom(line.x, line.y, x, side);

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
  } else {
    // Determine geometry-critical points
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
    const newB = largeSum / targetFromLarge;
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
  if (slope.hasWaterTable && slope.waterRLXY) {
    const w = slope.waterRLXY;
    waterYL = slicesX.slice(0, -1).map((x) => lineYFrom(w, x, "right"));
    waterYR = slicesX.slice(1).map((x) => lineYFrom(w, x, "left"));
    waterYMid = getYAtXMany(slope.waterRLXY.x, slope.waterRLXY.y, sxArray);
  }

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

    if (waterYL && waterYR && waterYMid) {
      const wy1 = waterYL[i];
      const wy2 = waterYR[i];
      const wyMid = waterYMid[i];
      // If water Y is NaN (slice x outside water table range), treat as no water.
      // Use midpoint water elevation for pore-pressure head so visual checks at slice
      // center align with the computed U value.
      if (
        Number.isFinite(wy1) &&
        Number.isFinite(wy2) &&
        Number.isFinite(wyMid)
      ) {
        waterYMean = wyMid;
        waterH =
          !verticalHead && wy1 !== wy2
            ? Math.cos(Math.atan((wy2 - wy1) / bArray[i])) ** 2
            : 1;
      }
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
      if (waterYL && waterYR) applyFreeWater(s, waterYL[i], waterYR[i], cy);
      results.push(s);
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
 * Design strength: characteristic strength divided by the partial factor.
 * Undrained strength (Su, S = f(depth/datum), and any model entered with
 * φ = 0, the common way to give undrained clay as Mohr-Coulomb) takes γcu;
 * drained strength takes γc' on c' and γφ' on tan φ'. The undrained
 * strength of a combined material takes γcu.
 */
function applyMaterialFactors(s: Slice, f: PartialFactors): void {
  const kind = s.baseMaterial?.model.kind;
  const undrained =
    kind === "undrained" ||
    kind === "s-f-depth" ||
    kind === "s-f-datum" ||
    (s.frictionAngle === 0 && !s.isCombined);
  if (kind === "high-strength" || kind === "impenetrable") return;
  s.cohesionUndrained /= f.cu;
  if (kind === "lime-cement-columns") {
    // Column-improved clay: Su of soil and columns take γcu, also in the
    // drained limit of the columns; tan φ′ takes γφ′.
    s.cohesion /= f.cu;
    s.phi = Math.atan(Math.tan(s.phi) / f.tanPhi);
    s.frictionAngle = (s.phi * 180) / Math.PI;
    return;
  }
  if (undrained) {
    s.cohesion /= f.cu;
    return;
  }
  s.cohesion /= f.cohesion;
  s.phi = Math.atan(Math.tan(s.phi) / f.tanPhi);
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
  const strength = resolveStrength(model, { yBottom: y, x, yGround, alpha: 0 });
  let c = strength.cohesion;
  let tanPhi = Math.tan((strength.frictionAngle * Math.PI) / 180);
  const f = slope.partialFactors;
  if (f) {
    const undrained =
      model.kind === "undrained" ||
      model.kind === "s-f-depth" ||
      model.kind === "s-f-datum" ||
      model.kind === "lime-cement-columns" ||
      (strength.frictionAngle === 0 && !strength.isCombined);
    if (undrained) {
      c /= f.cu;
      if (model.kind === "lime-cement-columns") tanPhi /= f.tanPhi;
    } else {
      c /= f.cohesion;
      tanPhi /= f.tanPhi;
    }
  }
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
  // never rises above the ground).
  const water = slope.hasWaterTable ? slope.waterRLXY : null;
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
function findCrackX(
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
 * gave about half its FOS. Slide and SLOPE/W apply this automatically.
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
