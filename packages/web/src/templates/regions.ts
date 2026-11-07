/**
 * The number of regions the engine cuts a definition's outline into with
 * its interior boundaries (`polygonizeRegions`, as `buildSlope` does): the
 * tests check that every layer and the road is a region of its own.
 */
import { polygonizeRegions, type SlopeDefinition } from "@cslope/engine";

export function regionCount(def: SlopeDefinition): number {
  const xs = def.coordinates.map((p) => p[0]);
  const ys = def.coordinates.map((p) => p[1]);
  return polygonizeRegions(xs, ys, (def.materialBoundaries ?? []).map((b) => b.coordinates)).length;
}
