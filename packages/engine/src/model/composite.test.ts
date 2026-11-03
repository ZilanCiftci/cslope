import { describe, expect, it } from "vitest";
import type { SlopeDefinition } from "../types/slope-definition";
import { runVerification } from "../verification/cases";
import { buildSlope } from "./build-slope";
import { toCanonicalSlopeDefinition } from "./canonical";
import { compositeFloor, floorYAt } from "./composite";
import { analyseSlope } from "./solvers";
import { Material } from "../types/index";

const clay = { name: "Clay", model: { kind: "undrained", unitWeight: 18, undrainedShearStrength: 30 } };
const rock = { name: "Rock", model: { kind: "impenetrable", unitWeight: 24 } };
const ground: [number, number][] = [[0, 20], [20, 20], [40, 10], [70, 10]];
const circle = (def: SlopeDefinition, cx: number, cy: number, radius: number, extra = {}) =>
  runVerification({ ...def, customSearchPlanes: [{ cx, cy, radius }], customPlanesOnly: true }, "Bishop", { slices: 40, ...extra });

describe("composite circles", () => {
  // clay on rock at y = 4 (the model base at y = 0)
  const onRock = {
    coordinates: [[0, 0], ...ground, [70, 0]],
    materials: [clay, rock],
    materialBoundaries: [{ coordinates: [[-1, 4], [71, 4]], materialName: "" }],
    regionAssignments: [{ point: [1, 15], materialName: "Clay" }, { point: [1, 2], materialName: "Rock" }],
  } as unknown as SlopeDefinition;

  it("the floor is the base of the model and the rock stacked on it", () => {
    const s = buildSlope(toCanonicalSlopeDefinition(onRock));
    const f = compositeFloor(s.externalBoundaryXY, s.materialGeometries)!;
    for (const x of [1, 30, 69]) expect(floorYAt(f, x)).toBeCloseTo(4, 9);
  });

  it("follows the rock where the circle goes below it, and is never stronger than the circles above it", () => {
    const { fos, slope } = circle(onRock, 32, 22, 21);
    const p = slope.search[0];
    expect(fos).not.toBeNull();
    expect(Math.min(...p.composite!.map(([, y]) => y))).toBeCloseTo(4, 9);
    // the slices along the rock: straight, level, in the clay
    const flat = p.slices!.filter((sl) => !sl.circular);
    expect(flat.length).toBeGreaterThan(2);
    for (const sl of flat) {
      expect(sl.y0Bottom).toBeCloseTo(4, 9);
      expect(sl.baseMaterial?.name).toBe("Clay");
    }
    expect(circle(onRock, 32, 22, 21, { compositeSurfaces: false }).fos).toBeNull();
  });

  it("does not follow a lens of rock with soil below it: a circle below it stays a circle", () => {
    // a lens of rock at y 6–7, x 28–34, above the circle's lowest part (y 4)
    const lens = {
      coordinates: [[0, 0], ...ground, [70, 0]],
      materials: [clay, rock],
      materialBoundaries: [{ coordinates: [[28, 6], [34, 6], [34, 7], [28, 7], [28, 6]], materialName: "" }],
      regionAssignments: [{ point: [1, 15], materialName: "Clay" }, { point: [31, 6.5], materialName: "Rock" }],
    } as unknown as SlopeDefinition;
    const withLens = circle(lens, 32, 26, 22);
    expect(withLens.fos).not.toBeNull();
    expect(withLens.slope.search[0].composite).toBeUndefined();
    expect(withLens.fos).toBeCloseTo(circle(lens, 32, 26, 22, { compositeSurfaces: false }).fos!, 12);
  });

  it("is not analysed where the floor reaches the ground (rock at the surface)", () => {
    // the rock rises to the ground at the toe, x 50–70
    const outcrop = {
      coordinates: [[0, 0], [0, 20], [20, 20], [40, 10], [50, 10], [70, 10], [70, 0]],
      materials: [clay, rock],
      materialBoundaries: [{ coordinates: [[-1, 4], [44, 4], [50, 10]], materialName: "" }],
      regionAssignments: [{ point: [1, 15], materialName: "Clay" }, { point: [60, 5], materialName: "Rock" }],
    } as unknown as SlopeDefinition;
    const { fos } = circle(outcrop, 40, 30, 27);
    expect(fos).toBeNull();
  });

  it("follows the bare base of the model only with compositeBase", () => {
    const onBase = { coordinates: [[0, 0], ...ground, [70, 0]], materials: [clay], regionAssignments: [{ point: [1, 15], materialName: "Clay" }] } as unknown as SlopeDefinition;
    // lowest point y = -1, below the base
    expect(circle(onBase, 32, 22, 23).fos).toBeNull();
    const along = circle(onBase, 32, 22, 23, { compositeBase: true });
    expect(along.fos).not.toBeNull();
    expect(Math.min(...along.slope.search[0].composite!.map(([, y]) => y))).toBeCloseTo(0, 9);
    // rock on part of the base: a circle through the bare base beside it is still not analysed
    const part = {
      ...onBase,
      materials: [clay, rock],
      materialBoundaries: [{ coordinates: [[50, 0], [50, 4], [71, 4]], materialName: "" }],
      regionAssignments: [{ point: [1, 15], materialName: "Clay" }, { point: [60, 2], materialName: "Rock" }],
    } as unknown as SlopeDefinition;
    expect(circle(part, 32, 22, 23).fos).toBeNull();
    expect(circle(part, 32, 22, 23, { compositeBase: true }).fos).not.toBeNull();
  });

  it("keeps the floor up to date when a region becomes rock", () => {
    const s = buildSlope(toCanonicalSlopeDefinition({ ...onRock, materials: [clay, { ...rock, name: "Sand", model: { kind: "mohr-coulomb", unitWeight: 19, cohesion: 0, frictionAngle: 35 } }], regionAssignments: [{ point: [1, 15], materialName: "Clay" }, { point: [1, 2], materialName: "Sand" }] } as unknown as SlopeDefinition));
    // no rock on the base: nothing to follow (the bare base is followed only with compositeBase)
    expect(s.compositeFloor).toBeNull();
    s.updateAnalysisOptions({ method: "Bishop", compositeBase: true });
    expect(floorYAt(s.compositeFloor!, 30)).toBeCloseTo(0, 9);
    s.updateAnalysisOptions({ compositeBase: false });
    analyseSlope(s);
    s.assignMaterial([1, 2], new Material({ name: "Rock", unitWeight: 24, model: { kind: "impenetrable", unitWeight: 24 } }));
    expect(floorYAt(s.compositeFloor!, 30)).toBeCloseTo(4, 9);
  });
});
