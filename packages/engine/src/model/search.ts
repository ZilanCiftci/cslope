/**
 * Search plane generation for slope stability analysis.
 */

import {
  circleRadiusFromAbcd,
  circleCentre,
  midCoord,
  distPoints,
} from "../math/index";
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

function planeKey(plane: Pick<SearchPlane, "cx" | "cy" | "radius">): string {
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

  return true;
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

  for (let i = 0; i < numCircles; i++) {
    const chordToEdge = (startChordToEdge * (numCircles - i)) / numCircles;
    const radius = circleRadiusFromAbcd(chordToEdge, C);
    const centre = circleCentre(beta, midCoord(lc, rc), radius - chordToEdge);
    const [cX, cY] = centre;

    const iList = slope.getCircleExternalIntersection(cX, cY, radius);

    if (new Set(iList.map((p) => `${p[0]},${p[1]}`)).size < 2) {
      continue;
    }

    const plane: SearchPlane = {
      lc: iList[0] as [number, number],
      rc: iList[1] as [number, number],
      cx: cX,
      cy: cY,
      radius,
      fos: 100,
      slices: null,
    };

    if (!isPlaneWithinExternalBoundary(slope, plane)) {
      continue;
    }

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

  const validRanked = rankedPlanes.filter((plane) =>
    Number.isFinite(plane.fos),
  );
  if (validRanked.length === 0) {
    return [];
  }

  const existingKeys = new Set(validRanked.map((plane) => planeKey(plane)));
  const generated: SearchPlane[] = [];
  const generatedKeys = new Set<string>();

  const addPlane = (plane: SearchPlane): void => {
    if (generated.length >= refinedIterations) return;
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

  const seeds = validRanked
    .slice()
    .sort((a, b) => a.fos - b.fos)
    .slice(0, Math.min(10, validRanked.length));

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
    const x = udl.x1 - 0.001;
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
  const validPlanes = allPlanes.filter(
    (plane) =>
      entryLeftX <= plane.lc[0] &&
      plane.lc[0] <= entryRightX &&
      exitLeftX <= plane.rc[0] &&
      plane.rc[0] <= exitRightX &&
      (plane.lc[0] !== plane.rc[0] || plane.lc[1] !== plane.rc[1]),
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
  const iList = slope.getCircleExternalIntersection(cx, cy, radius);
  if (new Set(iList.map((p) => `${p[0]},${p[1]}`)).size >= 2) {
    const plane: SearchPlane = {
      lc: iList[0] as [number, number],
      rc: iList[1] as [number, number],
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
