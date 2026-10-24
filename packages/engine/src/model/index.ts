/**
 * Barrel export for the engine model layer.
 */

export { Slope } from "./slope";
export type { SearchPlane } from "./slope";

export {
  getSurfaceLine,
  splitPolygonByPolyline,
  polygonizeRegions,
  lineSegmentIntersection,
  createGeometryWithMaterial,
} from "./geometry-ops";

export { createSlice, findCrackX, getSlices, rankineCrackDepth } from "./slices";
export { fitPolylineToGround, isAdmissiblePolyline } from "./surface";

export {
  generatePlanes,
  setEntryExitPlanes,
  addSingleEntryExitPlane,
  addSingleCircularPlane,
  isPlaneWithinExternalBoundary,
  selectEntryExit,
} from "./search";

export {
  analyseOrdinary,
  analyseBishop,
  analyseJanbu,
  analyseMorgensternPrice,
  analyseSlope,
  sliceDrivingMoment,
  sliceVerticalLoad,
} from "./solvers";

export { buildSlope } from "./build-slope";
export { analysisWarnings, danglingBoundaryMessage, M_ALPHA_WARNING_LIMIT } from "./result-warnings";

export {
  mirrorX,
  mirrorPoint,
  mirrorPoints,
  getDomainX,
  inferOrientationFromCoordinates,
  resolveOrientation,
  mirrorLimits,
  toCanonicalSlopeDefinition,
  mapAnalysisResultToModelSpace,
  oppositeDirectionDefinition,
} from "./canonical";
export type { SlopeOrientation } from "./canonical";
