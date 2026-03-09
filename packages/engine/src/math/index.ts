/**
 * Barrel export for all engine math functions.
 */

export {
  calculatePolygonArea,
  isPointInPolygon,
  clipPolygonHalfplane,
  clipPolygonVertical,
} from "./polygon";

export {
  getCircleYCoordinateAtX,
  getCircleLineIntersections,
  circleRadiusFromAbcd,
  circleCentre,
  generateCircleCoordinates,
} from "./circle";

export {
  getYAtX,
  getYAtXMany,
  getYAtXStrict,
  getLineBetweenPoints,
  interpolateIDW,
  interpolateNearest,
} from "./interpolation";
export type { SpatialDataPoint } from "./interpolation";

export { calculateAllLoads } from "./loads";
export type { UdlData, LineLoadData } from "./loads";

export {
  constantInterslice,
  halfsine,
  clippedSine,
  trapezoidal,
  dataPointSpecified,
  getIntersliceFunctionValue,
  midCoord,
  distPoints,
  extrapolateLambda,
  getPrecision,
  MATERIAL_COLORS,
} from "./helpers";
