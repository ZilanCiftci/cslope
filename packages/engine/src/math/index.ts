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
  getCirclePolygonIntersection,
  circleRadiusFromAbcd,
  circleCentre,
  generateCircleCoordinates,
} from "./circle";

export {
  getYAtX,
  getYAtXMany,
  getYAtXStrict,
  getLineBetweenPoints,
} from "./interpolation";

export { calculateAllLoads } from "./loads";
export type { UdlData, LineLoadData } from "./loads";

export {
  halfsine,
  midCoord,
  distPoints,
  extrapolateLambda,
  getPrecision,
  MATERIAL_COLORS,
} from "./helpers";
