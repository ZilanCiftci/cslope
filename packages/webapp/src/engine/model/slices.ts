/**
 * Slice creation and generation for slope stability analysis.
 */

import type { GeometryWithMaterial, Slice } from "../types/index";
import { WATER_UNIT_WEIGHT, SLICE_DEDUP_TOLERANCE } from "../types/constants";
import {
  getCircleYCoordinateAtX,
  getCircleLineIntersections,
  getYAtXMany,
  calculateAllLoads,
  calculatePolygonArea,
  clipPolygonVertical,
  clipPolygonHalfplane,
  isPointInPolygon,
} from "../math/index";
import type { Slope } from "./slope";

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
): Slice | null {
  const x = (x0 + x1) / 2;
  const dx = cx - x;
  const yTop = (y0Top + y1Top) / 2;
  const width = Math.abs(x0 - x1);

  const y0Bottom = getCircleYCoordinateAtX(cx, cy, radius, x0);
  const y1Bottom = getCircleYCoordinateAtX(cx, cy, radius, x1);
  const yBottom = getCircleYCoordinateAtX(cx, cy, radius, x);

  if (yBottom > yTop) return null; // Invalid: bottom above top

  const height = Math.abs(yTop - yBottom);
  const e = cy - (yTop + yBottom) / 2;

  // Alpha angle
  const dyA = cy - yBottom;
  const alpha = Math.atan(dx / dyA);

  // Base length (arc)
  const chordLength = Math.hypot(x0 - x1, y0Bottom - y1Bottom);
  const baseLength = 2 * Math.asin(chordLength / (2 * radius)) * radius;

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
    totalWeight += area * m.material.unitWeight;

    // Check if this material is at the base of the slice
    if (isPointInPolygon(x, yBottom + 1e-10, mpx, mpy)) {
      baseMaterial = m.material;
    }
  }

  // Fallback: use first intersected material if base not found
  if (baseMaterial === null && intersectedMaterials.length > 0) {
    baseMaterial = intersectedMaterials[0].material;
  }

  if (baseMaterial === null) return null; // No material → invalid slice

  // Material properties at base
  const materialType = baseMaterial.materialType;
  const cohesion = baseMaterial.getCohesion(yBottom);
  const cohesionUndrained = baseMaterial.getCohesionUndrained(yBottom);
  const frictionAngle = baseMaterial.frictionAngle;
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
    R: radius,
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
  };

  return slice;
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
  x0: number,
  x1: number,
  cx: number,
  cy: number,
  radius: number,
): Slice[] {
  if (x0 >= x1) throw new Error("x0 must be less than x1");

  const surfXY = slope.surfaceLineXY;
  if (!surfXY) throw new Error("Surface line not defined");

  const dist = x1 - x0;
  const b = dist / slope.sliceCount;
  const allSlicesSet = new Set<number>();
  allSlicesSet.add(x0);
  allSlicesSet.add(x1);

  if (slope.fixedSlices) {
    for (const fx of slope.fixedSlices) {
      allSlicesSet.add(fx);
    }
  } else {
    // Determine geometry-critical points
    const radiusSq = radius ** 2;
    for (const mg of slope.materialGeometries) {
      // Polygon corner points
      for (let i = 0; i < mg.px.length; i++) {
        if (
          mg.px[i] > x0 &&
          mg.px[i] < x1 &&
          (mg.px[i] - cx) ** 2 + (mg.py[i] - cy) ** 2 <= radiusSq + 1e-9
        ) {
          allSlicesSet.add(mg.px[i]);
        }
      }
      // Circle-polygon edge intersections
      const intersections = getCircleLineIntersections(
        cx,
        cy,
        radius,
        mg.px,
        mg.py,
      );
      for (const [ix] of intersections) {
        if (ix > x0 && ix < x1) {
          allSlicesSet.add(ix);
        }
      }
    }

    // Water table intersections
    const waterXY = slope.waterRLXY;
    if (waterXY) {
      const waterIntersections = getCircleLineIntersections(
        cx,
        cy,
        radius,
        waterXY.x,
        waterXY.y,
      );
      for (const [ix] of waterIntersections) {
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

  // Batch compute surface y-values
  const yTops = getYAtXMany(surfXY.x, surfXY.y, slicesX);
  const yTopsL = yTops.slice(0, -1);
  const yTopsR = yTops.slice(1);

  // Water table y-values
  let waterY: number[] | null = null;
  if (slope.hasWaterTable && slope.waterRLXY) {
    waterY = getYAtXMany(slope.waterRLXY.x, slope.waterRLXY.y, slicesX);
  }

  // Create slices
  const results: Slice[] = [];
  for (let i = 0; i < nSlices; i++) {
    let waterYMean: number | null = null;
    let waterH: number | null = null;

    if (waterY) {
      const wy1 = waterY[i];
      const wy2 = waterY[i + 1];
      // If water Y is NaN (slice x outside water table range), treat as no water
      if (Number.isFinite(wy1) && Number.isFinite(wy2)) {
        waterYMean = (wy1 + wy2) / 2;
        waterH =
          wy1 !== wy2 ? Math.cos(Math.atan((wy2 - wy1) / bArray[i])) ** 2 : 1;
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
      udlForces[i],
      llForces[i],
      waterYMean,
      waterH,
      [...slope.materialGeometries], // pass a copy
    );

    if (s !== null && s.isValid) {
      results.push(s);
    }
  }

  return results;
}
