import { describe, it, expect } from "vitest";
import { buildSlope } from "./build-slope";
import type { SlopeDefinition } from "../types/slope-definition";

const COORDS: [number, number][] = [
  [0, -15],
  [0, 0],
  [20, 0],
  [40, -10],
  [50, -10],
  [50, -15],
];
const MATERIALS: SlopeDefinition["materials"] = [
  { name: "A", unitWeight: 18, frictionAngle: 30, cohesion: 1 },
  { name: "B", unitWeight: 19, frictionAngle: 20, cohesion: 9 },
];

describe("buildSlope region assignments", () => {
  it("applies an assignment when there are no interior boundaries", () => {
    const slope = buildSlope({
      coordinates: COORDS,
      materials: MATERIALS,
      regionAssignments: [{ point: [10, -5], materialName: "B" }],
    });
    expect(slope.materialGeometries).toHaveLength(1);
    expect(slope.materialGeometries[0].material.name).toBe("B");
  });

  it("lets the first assignment win when two fall in the same region", () => {
    const slope = buildSlope({
      coordinates: COORDS,
      materials: MATERIALS,
      regionAssignments: [
        { point: [10, -5], materialName: "B" },
        { point: [5, -10], materialName: "A" },
      ],
    });
    expect(slope.materialGeometries[0].material.name).toBe("B");
  });
});
