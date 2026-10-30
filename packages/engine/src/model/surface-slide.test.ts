import { describe, expect, it } from "vitest";
import { buildSlope } from "./build-slope";
import { toCanonicalSlopeDefinition } from "./canonical";
import { analysisWarnings } from "./result-warnings";
import { analyseSlope } from "./solvers";
import { frictionalSurfaceSlide } from "./surface-slide";

// A 2:1 slope 10 m high (β = 26.57°).
const slope = (c: number, phi: number, extra: object = {}) =>
  buildSlope(toCanonicalSlopeDefinition({
    coordinates: [[0, 0], [0, 15], [10, 15], [30, 5], [45, 5], [45, 0]],
    materials: [{ name: "Fill", model: { kind: "mohr-coulomb", unitWeight: 20, cohesion: c, frictionAngle: phi } }],
    materialBoundaries: [],
    regionAssignments: [{ point: [1, 1], materialName: "Fill" }],
    ...extra,
  } as never));

describe("frictionalSurfaceSlide", () => {
  it("gives tan φ′/tan β on the face of a cohesionless slope", () => {
    const s = frictionalSurfaceSlide(slope(0, 30))!;
    expect(s.factorOfSafety).toBeCloseTo(Math.tan(Math.PI / 6) * 2, 6);
    expect(s.inclination).toBeCloseTo((Math.atan(0.5) * 180) / Math.PI, 6);
    expect([s.x1, s.y1, s.x2, s.y2]).toEqual([10, 15, 30, 5]);
  });

  it("reports a right-to-left model's face in its own coordinates", () => {
    const s = frictionalSurfaceSlide(buildSlope(toCanonicalSlopeDefinition({
      coordinates: [[0, 0], [0, 5], [15, 5], [35, 15], [45, 15], [45, 0]],
      materials: [{ name: "Fill", model: { kind: "mohr-coulomb", unitWeight: 20, cohesion: 0, frictionAngle: 30 } }],
      materialBoundaries: [],
      regionAssignments: [{ point: [1, 1], materialName: "Fill" }],
      orientation: "rtl",
    } as never)))!;
    expect([s.x1, s.y1, s.x2, s.y2].map((v) => +v.toFixed(9))).toEqual([35, 15, 15, 5]);
    expect(s.factorOfSafety).toBeCloseTo(1.1547, 4);
  });

  it("skips near-vertical steps", () => {
    const s = buildSlope(toCanonicalSlopeDefinition({
      coordinates: [[0, 0], [0, 15], [10, 15], [10.001, 5], [45, 5], [45, 0]],
      materials: [{ name: "Fill", model: { kind: "mohr-coulomb", unitWeight: 20, cohesion: 0, frictionAngle: 30 } }],
      materialBoundaries: [],
      regionAssignments: [{ point: [1, 1], materialName: "Fill" }],
    } as never));
    expect(frictionalSurfaceSlide(s)).toBeNull();
  });

  it("ignores a face with cohesion", () => {
    expect(frictionalSurfaceSlide(slope(5, 30))).toBeNull();
  });

  it("checks a face above the water table only", () => {
    // the water table along the face: the factor depends on the flow
    expect(frictionalSurfaceSlide(slope(0, 30, { waterTable: { mode: "custom", value: [[0, 15], [10, 15], [30, 5], [45, 5]] } }))).toBeNull();
    // below the toe: the face is dry
    expect(frictionalSurfaceSlide(slope(0, 30, { waterTable: { mode: "custom", value: [[0, 3], [45, 3]] } }))?.factorOfSafety).toBeCloseTo(1.1547, 4);
    // level water over the ground: clipped to it, as seepage out of the face
    expect(frictionalSurfaceSlide(slope(0, 30, { waterTable: { mode: "custom", value: [[0, 20], [45, 20]] } }))).toBeNull();
  });

  it("skips a face that reinforcement reaches", () => {
    const s = slope(0, 30, { reinforcements: [{ x1: 20, y1: 10, x2: 5, y2: 10, tensileCapacity: 100 }] });
    expect(frictionalSurfaceSlide(s)).toBeNull();
  });

  it("is a warning of the limit equilibrium analysis when it is below the critical surface's factor", () => {
    // a deep circle in a 2:1 slope with c′ = 0: its factor is above the face's tan φ′/tan β
    const s = slope(0, 30, { customSearchPlanes: [{ cx: 25, cy: 30, radius: 25 }], customPlanesOnly: true });
    const F = analyseSlope(s)!;
    expect(F).toBeGreaterThan(1.1548);
    const w = analysisWarnings(s).find((x) => x.code === "frictional-surface-slide");
    expect(w?.message).toContain("F = tan φ′/tan β = 1.155");
    // with cohesion there is none
    const t = slope(10, 30, { customSearchPlanes: [{ cx: 25, cy: 30, radius: 25 }], customPlanesOnly: true });
    analyseSlope(t);
    expect(analysisWarnings(t).some((x) => x.code === "frictional-surface-slide")).toBe(false);
  });
});
