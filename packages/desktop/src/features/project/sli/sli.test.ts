import { describe, expect, it } from "vitest";
import { analyseSlope, buildSlope, toCanonicalSlopeDefinition, DEFAULT_ANALYSIS_OPTIONS, type AnalysisOptions, type SlopeDefinition } from "@cslope/engine";
import { modelFromDefinition } from "../../../store/definition-model";
import { writeZip } from "../../../utils/zip";
import { parseSli, readSli } from "./sli-read";
import { cellRegions, sliToDefinition } from "./sli-to-definition";
import { modelToSli, modelToSlim, triangulate } from "./sli-write";

const F = (def: SlopeDefinition, options: Partial<AnalysisOptions>) => {
  const s = buildSlope(toCanonicalSlopeDefinition(def));
  s.updateAnalysisOptions({ ...DEFAULT_ANALYSIS_OPTIONS, ...options });
  return analyseSlope(s) as number;
};

/** A .sli text from its parts (the sections the reader needs). */
function sli(p: { description?: string[]; materials: string[]; names: string[]; vertices: [number, number][]; cells: [number[], number][]; extra?: string }): string {
  return [
    "model description:",
    ...(p.description ?? ["  methods: 2", "  water: hu", "  direction: right to left"]),
    "",
    "material types:",
    ...p.materials.map((m, i) => `  soil${i + 1} = ${m}`),
    "",
    "vertices:",
    ...p.vertices.map(([x, y], i) => `  ${i + 1} x: ${x}  y: ${y}`),
    "",
    "cells:",
    ...p.cells.map(([ids, m], i) => `  ${i + 1}  vertices: [${ids.join(",")}] material: soil${m}`),
    "",
    p.extra ?? "",
    "material properties:",
    ...p.names.map((n) => `  ${n}    red: 255  green: 200  blue: 100  has_hatch: 0 hatch2: 0  hatch_clr: 0`),
    "  Support 1    red: 0  green: 0  blue: 255",
    "",
  ].join("\r\n");
}

/** A slope sliding to the left: clay over a sand base, in triangles. */
const slope = sli({
  materials: [
    "type: 0 water: 1 wtable: 1 c: 10 phi: 25 uw: 18 uwbwt: 20 hutype: 0 withru: 0",
    "type: 0 water: 1 wtable: 0 c: 1 phi: 35 uw: 20 hutype: 0 withru: 0",
  ],
  names: ["Clay", "Sand"],
  // 1-4 the base, 4-7 the slope; 8 the water table's end
  vertices: [[0, 0], [40, 0], [40, 5], [0, 5], [0, 10], [15, 10], [25, 15], [40, 15], [40, 12]],
  cells: [[[1, 2, 3], 2], [[1, 3, 4], 2], [[4, 3, 6], 1], [[4, 6, 5], 1], [[3, 7, 6], 1], [[3, 8, 7], 1]],
  extra: [
    "water table:",
    "  from_boreholes: 0  unique_id: {X} vertices: [5,6,9]",
    "",
    "forces:",
    "  1 type: 0 x1: 38 y1: 15 x2: 30 y2: 15 angle: 270 load: 20 load2: 20 stage2: 0",
    "",
    "circular analysis:",
    "  slices: 30",
    "",
    "centers:",
    "  1 x: 13 y: 26 r: 20",
    "",
  ].join("\r\n"),
});

describe(".sli import", () => {
  it("reads the sections, merges the cells into regions and maps the materials, water, load and circle", () => {
    const file = parseSli(slope);
    expect(file.scenarios).toHaveLength(1);
    const imp = sliToDefinition(file, 0, "Slope.sli");
    const d = imp.definition;
    expect(imp.name).toBe("Slope");
    expect(d.orientation).toBe("rtl");
    // the outline: the union of the cells, with the corners of the boundary on the sides
    expect(d.coordinates).toHaveLength(8);
    expect(d.materialBoundaries).toHaveLength(1);
    expect(d.materialBoundaries![0].coordinates.map((p) => p.join(",")).sort()).toEqual(["0,5", "40,5"]);
    expect(d.materials.map((m) => m.name)).toEqual(["Clay", "Sand"]);
    expect(d.materials[0].model).toMatchObject({ kind: "mohr-coulomb", cohesion: 10, frictionAngle: 25, unitWeight: 18, unitWeightSat: 20 });
    expect(d.materials[0].color).toBe("#ffc864");
    // a point in each region
    expect(d.regionAssignments).toHaveLength(2);
    expect(d.regionAssignments!.find((a) => a.materialName === "Sand")!.point[1]).toBeLessThan(5);
    // water: the clay uses the water table, the sand is dry
    expect(d.waterTable).toEqual({ mode: "custom", value: [[0, 10], [15, 10], [40, 12]], followBoundary: false });
    expect(d.materials[1].waterTableId).toBe("no-water");
    expect(d.materials[0].waterTableId).toBeUndefined();
    expect(d.udls).toEqual([{ magnitude: 20, x1: 30, x2: 38 }]);
    expect(d.customSearchPlanes).toEqual([{ cx: 13, cy: 26, radius: 20 }]);
    expect(d.customPlanesOnly).toBe(true);
    expect(imp.options).toMatchObject({ method: "Bishop", slices: 30 });
    expect(F(d, imp.options)).toBeGreaterThan(0.5);
  });

  it("joins cells of one material across a vertex on another cell's edge, and makes a lens a closed boundary", () => {
    // a square of material 1 in four cells around a square lens of material 2; vertex 9 lies on the edge 1-2 of the first cell's neighbour
    const v: [number, number][] = [[0, 0], [10, 0], [10, 10], [0, 10], [4, 4], [6, 4], [6, 6], [4, 6], [5, 0]];
    const notes: string[] = [];
    const g = cellRegions({
      vertices: new Map(v.map((p, i) => [i + 1, p])),
      cells: [
        { ids: [1, 9, 6, 5], material: "soil1" }, { ids: [9, 2, 6], material: "soil1" }, { ids: [2, 3, 7, 6], material: "soil1" },
        { ids: [3, 4, 8, 7], material: "soil1" }, { ids: [4, 1, 5, 8], material: "soil1" }, { ids: [5, 6, 7, 8], material: "soil2" },
      ],
    }, notes);
    expect(g.regions.map((r) => r.material).sort()).toEqual(["soil1", "soil2"]);
    expect(g.outline).toHaveLength(5);
    expect(g.boundaries).toHaveLength(1);
    const ring = g.boundaries[0];
    expect(ring[0]).toEqual(ring[ring.length - 1]);
    expect(notes).toEqual([]);
  });

  it("maps the strength types and notes what it cannot", () => {
    const text = sli({
      description: ["  methods: 136", "  water: hu", "  direction: left to right"],
      materials: [
        "type: 1 ctype: 0 c: 30 wtable: 0 uw: 17",
        "type: 1 ctype: 1 c: 15 dc: 3.75 wtable: 0 uw: 18",
        "type: 5 water: 1 wtable: 0 uw: 20 name: Weak rock fn",
        "type: 8 water: 1 wtable: 0 mb: 1.5 s: 0.004 a: 0.51 sigc: 50000 uw: 26",
        "type: 18 water: 1 wtable: 0 uw: 19 shansepA: 0 shansepS: 0.25 shansepm: 0.8 histype: 0 shansepmd: 0 shansepht: 0 shansepcon: 2",
        "type: 15 water: 1 wtable: 0 c: 8 phi: 15 c2: 20 phi2: 30 ang: 0 snowA: 5 snowB: 10 uw: 22 anisoDef: 0",
        "type: 42 water: 1 wtable: 0 c: 5 phi: 20",
      ],
      names: ["Clay", "Clay deep", "Rock", "HB", "Shansep", "Bedded", "Odd"],
      vertices: [[0, 0], [70, 0], [70, 10], [0, 10], [0, 20], [10, 20], [20, 20], [30, 20], [40, 20], [50, 20], [60, 20], [70, 20]],
      cells: [[[1, 2, 3], 1], [[1, 3, 4], 2], [[4, 6, 5], 3], [[4, 7, 6], 4], [[4, 8, 7], 5], [[4, 3, 8], 6], [[3, 9, 8], 7], [[3, 10, 9], 7], [[3, 11, 10], 7], [[3, 12, 11], 7]],
      extra: [
        "strength functions:",
        "1  type: 5  num: 3  name: Weak rock fn",
        "    n: 0 s: 0",
        "    n: 100 s: 60",
        "    n: 300 s: 150",
        "",
        "shansep variable functions:",
        "  numfunctions: 1",
        "    soil: 5 numdata: 2",
        "      id1: 1 x: 10 y: 1.5",
        "      id1: 2 x: 20 y: 3",
        "",
        "material gen. hoek-brown:",
        "  num: 4  gsi: 45  mi: 12  disturbance: 0.2  use_gsi_mi_d: 0",
        "",
      ].join("\r\n"),
    });
    const imp = sliToDefinition(parseSli(text), 0, "m.sli");
    const m = Object.fromEntries(imp.definition.materials.map((q) => [q.name, q.model]));
    expect(m["Clay"]).toEqual({ kind: "undrained", unitWeight: 17, undrainedShearStrength: 30 });
    expect(m["Clay deep"]).toEqual({ kind: "s-f-depth", unitWeight: 18, suRef: 15, depthRef: 0, rate: 3.75, depthReference: "layer-top" });
    expect(m["Rock"]).toEqual({ kind: "shear-normal", unitWeight: 20, points: [[0, 0], [100, 60], [300, 150]] });
    expect(m["HB"]).toMatchObject({ kind: "hoek-brown", ucs: 50000, gsi: 45, mi: 12, disturbance: 0.2, mb: 1.5, s: 0.004, a: 0.51 });
    expect(m["Shansep"]).toEqual({ kind: "shansep", unitWeight: 19, ratio: 0.25, exponent: 0.8, ocrByElevation: [[10, 1.5], [20, 3]] });
    // the anisotropic strength: φ 15° (factor 0.5) within 5° of the horizontal, 30° beyond 10°
    const an = m["Bedded"] as { kind: string; modifierFunction: [number, number][] };
    expect(an).toMatchObject({ kind: "anisotropic-function", cohesion: 20, frictionAngle: 30 });
    const at = (a: number) => {
      const f = an.modifierFunction;
      const k = f.findIndex((p) => p[0] >= a);
      const [p, q] = [f[k - 1], f[k]];
      return p[1] + ((a - p[0]) / (q[0] - p[0])) * (q[1] - p[1]);
    };
    expect(at(0)).toBeCloseTo(0.5, 6);
    expect(at(-4)).toBeCloseTo(0.5, 6);
    expect(at(7.5)).toBeCloseTo(0.75, 6);
    expect(at(30)).toBeCloseTo(1, 6);
    // no unit weight in the file: 20 kN/m³, as the .gsz import
    expect(m["Odd"]).toEqual({ kind: "mohr-coulomb", unitWeight: 20, cohesion: 5, frictionAngle: 20 });
    const notes = imp.notes.join(" ");
    expect(notes).toContain('Material "Odd": no unit weight in the file; 20 kN/m³ used.');
    expect(notes).toMatch(/"Odd": its strength model is an option of the file \(code 42\) that cSlope does not import/);
    expect(notes).toMatch(/"Bedded".*scales c and φ together/);
    // Spencer and GLE: Spencer is used, GLE noted
    expect(imp.options).toMatchObject({ method: "Morgenstern-Price", intersliceFunction: "constant" });
    expect(notes).toMatch(/also runs GLE/);
    expect(imp.definition.orientation).toBe("ltr");
  });

  it("maps Hu, piezometric lines, loads, seismic coefficients, a tieback and a tension crack", () => {
    const text = sli({
      description: ["  methods: 2", "  water: hu", "  direction: right to left", "  seismic: 0.1", "  mode: 1", "  search: 5"],
      materials: [
        "type: 0 water: 1 wtable: 1 c: 5 phi: 30 uw: 19 hutype: 1",
        "type: 0 water: 1 wtable: 2 c: 0 phi: 34 uw: 20 hutype: 1",
      ],
      names: ["Fill", "Gravel"],
      vertices: [[0, 0], [40, 0], [40, 5], [0, 5], [0, 10], [15, 10], [25, 15], [40, 15], [40, 13], [0, 3], [40, 4], [30, 13], [36, 13], [22, 12], [32, 10]],
      cells: [[[1, 2, 3], 2], [[1, 3, 4], 2], [[4, 3, 6], 1], [[4, 6, 5], 1], [[3, 7, 6], 1], [[3, 8, 7], 1]],
      extra: [
        "water table:",
        "  vertices: [5,6,9]",
        "",
        "piezos:",
        "  1  vertices: [10,11]",
        "",
        "forces:",
        "  1 type: 0 x1: 30 y1: 15 x2: 40 y2: 15 angle: 270 load: 10 load2: 20 stage2: 0",
        "  2 type: 1 x1: 27 y1: 15 angle: 300 load: 50 stage2: 0",
        "",
        "anchor types:",
        "  anchor1 = type: 2 fa: 0 sp: 2 cap: 100 pc: 80 bst: 0 bs: 15 bt: 1 bl: 50",
        "  anchor2 = type: 4 fa: 1 fo_flag: 0 ts: 50 anch: 2 po_type: 1 po_adh: 4 po_fric: 45 cov_perc: 50 conn_strength: 40",
        "",
        "anchors:",
        "  1 x1: 22 y1: 12 x2: 32 y2: 10  material: anchor1",
        "  2 x1: 24 y1: 13 x2: 34 y2: 13  material: anchor2",
        "",
        "tension crack properties:",
        "  type: filled  angle_flag: 0  angle_value: 10",
        "",
        "tension crack:",
        "  1 unique_id: {X} vertices: [12,13]",
        "",
      ].join("\r\n"),
    });
    const imp = sliToDefinition(parseSli(text), 0, "w.sli");
    const d = imp.definition;
    expect(imp.options).toMatchObject({ porePressureHead: "phreatic-correction", seismicHorizontal: 0.1, nonCircularOptimization: true, tensionCrackDepth: 2, tensionCrackWater: 1 });
    expect(d.materials.find((m) => m.name === "Gravel")!.waterTableId).toBe("piezo-1");
    expect(d.waterTables).toEqual([{ id: "piezo-1", coordinates: [[0, 3], [40, 4]], followBoundary: false }]);
    // the varying load in ten steps from 10.5 to 19.5 kPa
    expect(d.udls).toHaveLength(10);
    expect(d.udls![0]).toMatchObject({ x1: 30, x2: 31, magnitude: 10.5 });
    expect(d.udls![9].magnitude).toBeCloseTo(19.5, 9);
    // the line load at 300° (30° from the downward vertical, towards +x)
    expect(d.lineLoads).toEqual([{ magnitude: 50, x: 27, angle: 30, y: 15 }]);
    expect(d.reinforcements).toEqual([
      { x1: 22, y1: 12, x2: 32, y2: 10, tensileCapacity: 100, spacing: 2, direction: "axial", application: "active", pullout: { kind: "bond", strength: 15, bondedLength: Math.hypot(10, 2) / 2 }, end1Capacity: 80 },
      // a geosynthetic with half coverage: its strengths per metre, the coverage on the pullout's adhesion and tan δ
      { x1: 24, y1: 13, x2: 34, y2: 13, tensileCapacity: 25, spacing: 1, direction: "tangent", application: "passive", pullout: { kind: "interface", adhesion: 2, frictionAngle: expect.closeTo((Math.atan(0.5) * 180) / Math.PI, 9) }, end1Capacity: 20 },
    ]);
    expect(F({ ...d, customPlanesOnly: true, customSearchPlanes: [{ cx: 13, cy: 26, radius: 20 }] }, imp.options)).toBeGreaterThan(0.3);
  });

  it("reads a .slmd archive: the shared materials with each scenario's water settings, in the index's order", async () => {
    const shared = [
      "shared model description:",
      "  version: 9.027",
      "",
      "material types:",
      "  soil1 = type: 0 water: 1 wtable: 1 c: 10 phi: 25 uw: 18 hutype: 0",
      "",
      "material properties:",
      "  Clay    red: 10  green: 20  blue: 30  has_hatch: 0 hatch2: 0  hatch_clr: 0 guid: {A}",
      "",
    ].join("\r\n");
    const scenario = (wtable: number) =>
      sli({ materials: [`water: 1 wtable: ${wtable}, hutype: 0 withru: 0`], names: [], vertices: [[0, 0], [30, 0], [30, 10], [10, 10], [0, 5]], cells: [[[1, 2, 3], 1], [[1, 3, 4], 1], [[1, 4, 5], 1]], extra: "water table:\r\n  vertices: [5,4]\r\n" })
        .replace(/material properties:[\s\S]*$/, "");
    const index = ['  sc_name: "Dry"', '  sc_filename: "{B}.slsc"', '  sc_name: "Wet"', '  sc_filename: "{A}.slsc"'].join("\r\n");
    const bytes = writeZip([
      { name: "m.slmm", data: index },
      { name: "m.slsp", data: shared },
      { name: "{A}.slsc", data: scenario(1) },
      { name: "{B}.slsc", data: scenario(0) },
    ]);
    const file = await readSli(bytes);
    expect(file.kind).toBe("slmd");
    expect(file.version).toBe("9.027");
    expect(file.scenarios.map((s) => s.name)).toEqual(["Dry", "Wet"]);
    const [dry, wet] = [0, 1].map((i) => sliToDefinition(file, i, "m.slmd"));
    expect(dry.name).toBe("Dry (m)");
    expect(dry.definition.materials[0]).toMatchObject({ name: "Clay", color: "#0a141e", model: { cohesion: 10, frictionAngle: 25 } });
    expect(dry.definition.waterTable).toBeUndefined();
    expect(wet.definition.waterTable).toBeDefined();
  });

});

/** A dike on clay over sand, sliding to the right, with water, loads and a tieback. */
const dike: SlopeDefinition = {
  coordinates: [[0, 0], [0, 6], [10, 6], [16, 10], [20, 10], [28, 6], [40, 6], [40, 0]],
  materials: [
    { name: "Sand", model: { kind: "mohr-coulomb", unitWeight: 18, unitWeightSat: 20, cohesion: 0, frictionAngle: 32 }, color: "#e0c080" },
    { name: "Clay", model: { kind: "undrained", unitWeight: 16, undrainedShearStrength: 25 } },
    { name: "Dike", model: { kind: "mohr-coulomb", unitWeight: 19, cohesion: 4, frictionAngle: 30 } },
  ],
  materialBoundaries: [
    { coordinates: [[0, 2], [40, 2]], materialName: "" },
    { coordinates: [[0, 6], [40, 6]], materialName: "" },
  ],
  regionAssignments: [
    { point: [20, 1], materialName: "Sand" },
    { point: [20, 4], materialName: "Clay" },
    { point: [18, 8], materialName: "Dike" },
  ],
  waterTable: { mode: "custom", value: [[0, 9], [16, 9], [28, 5.5], [40, 5.5]], followBoundary: false },
  udls: [{ magnitude: 13, x1: 16, x2: 20 }],
  lineLoads: [{ magnitude: 10, x: 18 }],
  reinforcements: [
    { x1: 25, y1: 7, x2: 15, y2: 5, tensileCapacity: 40, spacing: 1.5, direction: "axial", application: "passive", pullout: { kind: "bond", strength: 8, bondedLength: 5 }, end1Capacity: 30 },
    { x1: 26, y1: 6.8, x2: 15, y2: 6.8, tensileCapacity: 30, spacing: 1, direction: "tangent", application: "passive", pullout: { kind: "interface", adhesion: 0, frictionAngle: 30 }, end1Capacity: 20 },
  ],
  customSearchPlanes: [{ cx: 26, cy: 16, radius: 12 }],
  customPlanesOnly: true,
};
const model = (def: SlopeDefinition, options: Partial<AnalysisOptions> = {}) =>
  modelFromDefinition(def, { id: "m", name: "Dike", options: { ...DEFAULT_ANALYSIS_OPTIONS, method: "Bishop", ...options } });

describe(".sli export and import", () => {
  it("round-trips a model: regions in triangles, materials, water, loads, a tieback and the circle give the same factor of safety", async () => {
    const opts = { method: "Bishop" as const, slices: 40 };
    const f0 = F(dike, opts);
    const { text, notes } = modelToSli(model(dike, opts));
    expect(text).toMatch(/^model description:/);
    const imp = sliToDefinition(parseSli(text), 0, "Dike.sli");
    expect(imp.options).toMatchObject({ method: "Bishop", slices: 40 });
    expect(imp.definition.customSearchPlanes).toEqual([{ cx: 26, cy: 16, radius: 12 }]);
    expect(imp.definition.customPlanesOnly).toBe(true);
    expect(imp.definition.materials.map((m) => m.name)).toEqual(["Sand", "Clay", "Dike"]);
    expect(imp.definition.materials[0]).toMatchObject({ color: "#e0c080", model: { unitWeightSat: 20 } });
    const [tieback, sheet] = dike.reinforcements!;
    expect(imp.definition.reinforcements).toEqual([
      { ...tieback, pullout: { ...tieback.pullout!, bondedLength: expect.closeTo(5, 9) } },
      { ...sheet, pullout: { kind: "interface", adhesion: 0, frictionAngle: expect.closeTo(30, 9) } },
    ]);
    expect(imp.definition.lineLoads).toEqual([{ magnitude: 10, x: 18 }]);
    expect(F(imp.definition, imp.options)).toBeCloseTo(f0, 6);
    expect(notes.join(" ")).toMatch(/Line loads are written as type 1/);
    // the same through a .slim archive
    const slim = await readSli(modelToSlim(model(dike, opts), "Dike").bytes);
    expect(slim.kind).toBe("slim");
    expect(F(sliToDefinition(slim, 0, "Dike.slim").definition, imp.options)).toBeCloseTo(f0, 6);
  });

  it("writes a right-to-left model in its own coordinates, with dry materials, a piezometric line, Hu and Spencer", () => {
    const rtl: SlopeDefinition = {
      orientation: "rtl",
      coordinates: [[0, 0], [0, 4], [15, 4], [30, 10], [40, 10], [40, 0]],
      materials: [
        { name: "Clay", model: { kind: "mohr-coulomb", unitWeight: 18, cohesion: 8, frictionAngle: 25 } },
        { name: "Base", model: { kind: "mohr-coulomb", unitWeight: 20, cohesion: 2, frictionAngle: 33 }, waterTableId: "low" },
        { name: "Dry lens", model: { kind: "mohr-coulomb", unitWeight: 17, cohesion: 15, frictionAngle: 20 }, waterTableId: "dry" },
      ],
      materialBoundaries: [{ coordinates: [[0, 2], [40, 2]], materialName: "" }, { coordinates: [[30, 7], [35, 7], [35, 9], [30, 9], [30, 7]], materialName: "" }],
      regionAssignments: [{ point: [20, 1], materialName: "Base" }, { point: [20, 3], materialName: "Clay" }, { point: [32, 8], materialName: "Dry lens" }],
      waterTable: { mode: "custom", value: [[0, 3], [15, 3], [40, 7]], followBoundary: false },
      waterTables: [
        { id: "main", coordinates: [[0, 3], [15, 3], [40, 7]], followBoundary: false },
        { id: "low", coordinates: [[0, 1], [40, 1.5]], followBoundary: false },
        { id: "dry", coordinates: [[0, -50], [40, -50]], followBoundary: false },
      ],
      udls: [{ magnitude: 10, x1: 32, x2: 38 }],
      customSearchPlanes: [{ cx: 18, cy: 20, radius: 18 }],
      customPlanesOnly: true,
    };
    const opts = { method: "Morgenstern-Price" as const, intersliceFunction: "constant" as const, porePressureHead: "phreatic-correction" as const };
    const f0 = F(rtl, opts);
    const { text } = modelToSli(model(rtl, opts));
    expect(text).toMatch(/direction: right to left/);
    expect(text).toMatch(/methods: 8/);
    expect(text).toMatch(/x1: 32 y1: 10 x2: 38 y2: 10 angle: 270 load: 10/);
    const imp = sliToDefinition(parseSli(text), 0, "x.sli");
    expect(imp.options).toMatchObject({ method: "Morgenstern-Price", intersliceFunction: "constant", porePressureHead: "phreatic-correction" });
    expect(imp.definition.materials.map((m) => m.waterTableId)).toEqual([undefined, "piezo-1", "no-water"]);
    // the lens: a closed boundary
    expect(imp.definition.materialBoundaries!.some((b) => b.coordinates.length === 5)).toBe(true);
    expect(f0).toBeGreaterThan(0);
    expect(F(imp.definition, imp.options)).toBeCloseTo(f0, 6);
  });

  it("writes the other strength types so that they read back", () => {
    const def: SlopeDefinition = {
      ...dike,
      materials: [
        { name: "Sand", model: { kind: "shear-normal", unitWeight: 19, points: [[0, 0], [50, 40], [200, 120]] } },
        { name: "Clay", model: { kind: "shansep", unitWeight: 16, ratio: 0.3, exponent: 0.8, ocrByElevation: [[2, 2], [6, 1.2]] } },
        { name: "Dike", model: { kind: "hoek-brown", unitWeight: 24, ucs: 20000, gsi: 40, mi: 10, disturbance: 0 } },
      ],
      reinforcements: [],
      lineLoads: [],
    };
    const f0 = F(def, { method: "Bishop" });
    const imp = sliToDefinition(parseSli(modelToSli(model(def)).text), 0, "x.sli");
    expect(imp.definition.materials.map((m) => m.model!.kind)).toEqual(["shear-normal", "shansep", "hoek-brown"]);
    expect(F(imp.definition, imp.options)).toBeCloseTo(f0, 5);
  });

  it("triangulates a region around a hole and keeps the corners on straight edges", () => {
    const pts: [number, number][] = [[0, 0], [5, 0], [10, 0], [10, 10], [0, 10], [4, 4], [6, 4], [6, 6], [4, 6]];
    const at = (id: number) => pts[id - 1];
    const tris = triangulate([1, 2, 3, 4, 5], [[6, 9, 8, 7]], at);
    const area = tris.reduce((s, [a, b, c]) => s + Math.abs((at(b)[0] - at(a)[0]) * (at(c)[1] - at(a)[1]) - (at(c)[0] - at(a)[0]) * (at(b)[1] - at(a)[1])) / 2, 0);
    expect(area).toBeCloseTo(96, 9);
    expect(tris.flat()).toContain(2);
  });
});

describe(".sli review regressions", () => {
  const areaOf = (tris: number[][], at: (id: number) => [number, number]) =>
    tris.reduce((s, [a, b, c]) => s + ((at(b)[0] - at(a)[0]) * (at(c)[1] - at(a)[1]) - (at(c)[0] - at(a)[0]) * (at(b)[1] - at(a)[1])) / 2, 0);

  it("bridges a hole whose nearest corner is in line with another of its corners, and covers the region once", () => {
    // a bridge from (4,4) to (0,0) would pass through the hole's corner (2,2)
    const pts: [number, number][] = [[0, 0], [10, 0], [10, 10], [0, 10], [2, 2], [4, 2], [4, 4], [2, 4]];
    const at = (id: number) => pts[id - 1];
    const tris = triangulate([1, 2, 3, 4], [[5, 6, 7, 8]], at);
    expect(areaOf(tris, at)).toBeCloseTo(96, 9);
    // a crossing outline cannot be covered: it fails instead of writing overlapping cells
    expect(() => triangulate([1, 3, 2, 4], [], at)).toThrow(/cover|ear/);
  });

  it("exports a model with a lens and reads it back with the same regions", () => {
    const def: SlopeDefinition = {
      coordinates: [[0, 0], [10, 0], [10, 10], [0, 10]],
      materials: [{ name: "Soil", model: { kind: "mohr-coulomb", unitWeight: 18, cohesion: 10, frictionAngle: 30 } }, { name: "Lens", model: { kind: "mohr-coulomb", unitWeight: 18, cohesion: 1, frictionAngle: 20 } }],
      materialBoundaries: [{ coordinates: [[2, 2], [4, 2], [4, 4], [2, 4], [2, 2]], materialName: "" }],
      regionAssignments: [{ point: [8, 8], materialName: "Soil" }, { point: [3, 3], materialName: "Lens" }],
    };
    const file = parseSli(modelToSli(model(def)).text);
    const sc = file.scenarios[0];
    const cellArea = (m: string) => sc.cells.filter((c) => c.material === m).reduce((s, c) => s + Math.abs(areaOf([c.ids], (id) => sc.vertices.get(id)!)), 0);
    expect(cellArea("soil1")).toBeCloseTo(96, 9);
    expect(cellArea("soil2")).toBeCloseTo(4, 9);
  });

  it("writes the ground and the tension crack along the outline at a vertical step", () => {
    const def: SlopeDefinition = {
      orientation: "ltr",
      coordinates: [[0, 0], [30, 0], [30, 4], [10, 4], [10, 10], [0, 10]],
      materials: [{ name: "Clay", model: { kind: "mohr-coulomb", unitWeight: 18, cohesion: 10, frictionAngle: 25 } }],
    };
    const { text } = modelToSli(model(def, { tensionCrackDepth: 2 }));
    const sc = parseSli(text).scenarios[0];
    const ground = sc.sections.get("slope")!.join(" ").match(/\[([^\]]*)\]/)![1].split(",").map((k) => sc.vertices.get(Number(k)));
    expect(ground).toEqual([[0, 10], [10, 10], [10, 4], [30, 4]]);
    expect(sliToDefinition(parseSli(text), 0, "x.sli").options.tensionCrackDepth).toBeCloseTo(2, 9);
  });

  it("numbers the strength functions one by one, clamps Su at the top and notes characters outside Latin-1", async () => {
    const def: SlopeDefinition = {
      coordinates: [[0, 0], [20, 0], [20, 10], [0, 10]],
      materials: [
        { name: "Rock 1", model: { kind: "shear-normal", unitWeight: 20, points: [[0, 0], [100, 60], [200, 100]] } },
        { name: "Rock 2 →", model: { kind: "shear-normal", unitWeight: 20, points: [[0, 0], [100, 50]] } },
        { name: "Clay", model: { kind: "s-f-depth", unitWeight: 17, suRef: 5, depthRef: 4, rate: 2, depthReference: "layer-top" } },
      ],
      materialBoundaries: [{ coordinates: [[0, 4], [20, 4]], materialName: "" }, { coordinates: [[0, 7], [20, 7]], materialName: "" }],
      regionAssignments: [{ point: [5, 2], materialName: "Rock 1" }, { point: [5, 5], materialName: "Rock 2 →" }, { point: [5, 8], materialName: "Clay" }],
    };
    const { text, notes } = modelToSli(model(def));
    expect(text.split("\r\n").filter((l) => /^\d+\s+type: 5/.test(l)).map((l) => l.split(/\s+/)[0])).toEqual(["1", "2"]);
    expect(text).toMatch(/type: 1 ctype: 1 c: 0 dc: 2/);
    expect(notes.join(" ")).toMatch(/"Clay": Su at the top of the layer would be -3 kPa/);
    const slim = modelToSlim(model(def), "x");
    expect(slim.notes.join(" ")).toMatch(/→.*written as "\?"/);
    const back = sliToDefinition(await readSli(slim.bytes), 0, "x.slim");
    expect(back.definition.materials.map((m) => m.model!.kind)).toEqual(["shear-normal", "shear-normal", "s-f-depth"]);
  });

  it("merges 12 800 cells quickly", () => {
    const nx = 100, ny = 64;
    const vertices: [number, number][] = [];
    for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) vertices.push([i, j * 0.5]);
    const id = (i: number, j: number) => j * (nx + 1) + i + 1;
    const cells: [number[], number][] = [];
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const m = j < ny / 2 ? 1 : 2;
      cells.push([[id(i, j), id(i + 1, j), id(i + 1, j + 1)], m], [[id(i, j), id(i + 1, j + 1), id(i, j + 1)], m]);
    }
    const text = sli({ materials: ["type: 0 c: 10 phi: 30 uw: 18", "type: 0 c: 5 phi: 25 uw: 18"], names: ["A", "B"], vertices, cells });
    const t0 = performance.now();
    const imp = sliToDefinition(parseSli(text), 0, "big.sli");
    expect(performance.now() - t0).toBeLessThan(3000);
    expect(imp.definition.materials).toHaveLength(2);
    expect(imp.definition.materialBoundaries).toHaveLength(1);
  });

  it("puts a region's point inside its cell when the cell is concave", () => {
    const v: [number, number][] = [[0, 0], [10, 0], [10, 2], [2, 2], [2, 8], [10, 8], [10, 10], [0, 10]];
    const g = cellRegions({ vertices: new Map(v.map((p, i) => [i + 1, p])), cells: [{ ids: [1, 2, 3, 4, 5, 6, 7, 8], material: "soil1" }] }, []);
    const [x, y] = g.regions[0].point;
    const inC = (x >= 0 && x <= 2 && y >= 0 && y <= 10) || (y >= 0 && y <= 2) || (y >= 8 && y <= 10);
    expect(inC && x >= 0 && x <= 10).toBe(true);
  });

  it("imports a material's ru coefficient on top of its water line, and the water method ru", () => {
    const text = sli({
      description: ["  methods: 2", "  water: hu", "  with_ru: 1"],
      materials: ["type: 0 water: 1 wtable: 1 c: 5 phi: 30 uw: 19 hutype: 0 withru: 0.4", "type: 0 water: 1 wtable: 0 c: 1 phi: 35 uw: 20"],
      names: ["Fill", "Rock"],
      vertices: [[0, 0], [20, 0], [20, 10], [0, 10], [0, 8], [20, 6]],
      cells: [[[1, 2, 3], 1], [[1, 3, 4], 1]],
      extra: "water table:\r\n  vertices: [5,6]\r\n",
    });
    const imp = sliToDefinition(parseSli(text), 0, "ru.sli");
    expect(imp.definition.waterTable).toBeDefined();
    expect(imp.definition.materials[0].waterTableId).toBeUndefined();
    expect(imp.definition.materials[0].model).toMatchObject({ ru: 0.4 });
    expect(imp.notes.join(" ")).not.toMatch(/ru coefficient/);
    expect(imp.notes.join(" ")).toMatch(/no region uses are not imported: Rock/);
    // the water method ru: the material's `water` value is its ru, without a water line
    const ruMode = sli({
      description: ["  methods: 2", "  water: ru"],
      materials: ["type: 0 water: 0.25 wtable: 0 c: 5 phi: 30 uw: 19 hutype: 0"],
      names: ["Fill"],
      vertices: [[0, 0], [20, 0], [20, 10], [0, 10]],
      cells: [[[1, 2, 3], 1], [[1, 3, 4], 1]],
    });
    const r = sliToDefinition(parseSli(ruMode), 0, "ru.sli");
    expect(r.definition.materials[0].model).toMatchObject({ ru: 0.25 });
    expect(r.notes.join(" ")).not.toMatch(/not imported; the model has no pore pressure/);
  });

  it("imports the B-bar method: B̄ on its materials, the others as fill, second-stage loads; and writes it back", () => {
    const text = sli({
      description: ["  methods: 1", "  water: hu", "  advanced_options: yes", "  advanced_options_type: 1"],
      materials: ["type: 0 water: 1 wtable: 0 c: 5 phi: 32 uw: 20 bbar: 0", "type: 0 water: 1 wtable: 1 c: 10 phi: 20 uw: 17 bbar: 1"],
      names: ["Fill", "Clay"],
      vertices: [[0, 0], [40, 0], [40, 6], [28, 6], [20, 10], [12, 10], [0, 10], [0, 6]],
      cells: [[[1, 2, 3], 2], [[1, 3, 8], 2], [[8, 3, 4], 1], [[8, 4, 5], 1], [[8, 5, 6], 1], [[8, 6, 7], 1]],
      extra: "water table:\r\n  vertices: [8,3]\r\n\r\nforces:\r\n  1 type: 0 x1: 13 y1: 10 x2: 19 y2: 10 angle: 270 load: 10 load2: 10 stage2: 1\r\n",
    });
    const imp = sliToDefinition(parseSli(text), 0, "bbar.sli");
    const byName = Object.fromEntries(imp.definition.materials.map((m) => [m.name, m.model]));
    expect(byName.Clay).toMatchObject({ bBar: 1 });
    expect(byName.Fill).toMatchObject({ bBarLoad: true });
    expect(imp.definition.udls?.[0].excessPorePressure).toEqual([{ material: "Clay", ratio: 1 }]);
    expect(imp.notes.join(" ")).toMatch(/Excess pore pressure \(B̄\): Clay \(B̄ = 1\)/);
    // written back: the method, B̄ and the second-stage load
    const def = { ...imp.definition, customSearchPlanes: [{ cx: 24, cy: 18, radius: 13 }], customPlanesOnly: true };
    const opts = { method: "Bishop" as const, slices: 40 };
    const f0 = F(def, opts);
    const { text: out } = modelToSli(model(def, opts));
    expect(out).toMatch(/advanced_options_type: 1/);
    expect(out).toMatch(/stage2: 1/);
    const back = sliToDefinition(parseSli(out), 0, "bbar.sli");
    expect(F(back.definition, back.options)).toBeCloseTo(f0, 6);
    expect(f0).toBeLessThan(F({ ...def, materials: def.materials.map((m) => ({ ...m, model: { ...m.model!, bBar: undefined, bBarLoad: undefined } })), udls: [{ magnitude: 10, x1: 13, x2: 19 }] }, opts));
  });

  it("marks the fill with stg2: 1 when it writes B̄, and reads only the marked materials as fill when the file marks them", () => {
    const base = {
      description: ["  methods: 1", "  water: hu", "  advanced_options: yes", "  advanced_options_type: 1"],
      names: ["Fill", "Clay", "Drain"],
      vertices: [[0, 0], [40, 0], [40, 6], [28, 6], [20, 10], [12, 10], [0, 10], [0, 6]] as [number, number][],
      cells: [[[1, 2, 3], 2], [[1, 3, 8], 3], [[8, 3, 4], 1], [[8, 4, 5], 1], [[8, 5, 6], 1], [[8, 6, 7], 1]] as [number[], number][],
      extra: "water table:\r\n  vertices: [8,3]\r\n",
    };
    const fillOf = (text: string) =>
      sliToDefinition(parseSli(text), 0, "bbar.sli").definition.materials.filter((m) => (m.model as { bBarLoad?: boolean }).bBarLoad).map((m) => m.name);
    // marked (as in the format's own B̄ tutorial): only stg2: 1 is fill, a bbar: 0 material without the mark is not
    const marked = sli({ ...base, materials: ["type: 0 water: 1 wtable: 0 c: 5 phi: 32 uw: 20 stg2: 1 bbar: 0", "type: 0 water: 1 wtable: 1 c: 10 phi: 20 uw: 17 stg2: 0 bbar: 1", "type: 0 water: 1 wtable: 1 c: 1 phi: 35 uw: 20 stg2: 0 bbar: 0"] });
    expect(fillOf(marked)).toEqual(["Fill"]);
    // not marked: every bbar: 0 material is fill
    const unmarked = sli({ ...base, materials: ["type: 0 water: 1 wtable: 0 c: 5 phi: 32 uw: 20 bbar: 0", "type: 0 water: 1 wtable: 1 c: 10 phi: 20 uw: 17 bbar: 1", "type: 0 water: 1 wtable: 1 c: 1 phi: 35 uw: 20 bbar: 0"] });
    expect(fillOf(unmarked)).toEqual(["Fill", "Drain"]);
    // written: stg2 1 on the fill only, and read back the same
    const imp = sliToDefinition(parseSli(marked), 0, "bbar.sli");
    const { text, notes } = modelToSli(model({ ...imp.definition, customSearchPlanes: [{ cx: 24, cy: 18, radius: 13 }], customPlanesOnly: true }, { method: "Bishop" }));
    const soil = (k: number) => text.split("\r\n").find((l) => l.startsWith(`  soil${k} = `))!;
    expect([1, 2, 3].map((k) => soil(k).match(/stg2: (\d) bbar: (\S+)/)!.slice(1))).toEqual([["1", "0"], ["0", "1"], ["0", "0"]]);
    expect(notes.join(" ")).not.toMatch(/not marked as fill/);
    expect(fillOf(text)).toEqual(["Fill"]);
    // without B̄ written, no material is marked
    const dry = modelToSli(model(dike, { method: "Bishop" })).text;
    expect(dry.split("\r\n").filter((l) => /^ {2}soil\d+ = /.test(l)).every((l) => / stg2: 0 /.test(l))).toBe(true);
  });

  it("writes ru and reads it back with the same factor of safety", () => {
    const wet: SlopeDefinition = { ...dike, materials: dike.materials.map((m) => ({ ...m, model: { ...m.model!, ru: 0.3 } })) };
    const opts = { method: "Bishop" as const, slices: 40 };
    const f0 = F(wet, opts);
    expect(f0).toBeLessThan(F(dike, opts));
    const { text } = modelToSli(model(wet, opts));
    expect(text).toMatch(/with_ru: 1/);
    const imp = sliToDefinition(parseSli(text), 0, "Dike.sli");
    expect(imp.definition.materials.map((m) => (m.model as { ru?: number }).ru)).toEqual([0.3, 0.3, 0.3]);
    expect(F(imp.definition, imp.options)).toBeCloseTo(f0, 6);
  });

  it("notes a void inside the model and what fills it", () => {
    // four quadrilaterals around an empty square 4..6
    const v: [number, number][] = [[0, 0], [10, 0], [10, 10], [0, 10], [4, 4], [6, 4], [6, 6], [4, 6]];
    const text = sli({ materials: ["type: 0 c: 10 phi: 30 uw: 18"], names: ["Soil"], vertices: v, cells: [[[1, 2, 6, 5], 1], [[2, 3, 7, 6], 1], [[3, 4, 8, 7], 1], [[4, 1, 5, 8], 1]] });
    const imp = sliToDefinition(parseSli(text), 0, "void.sli");
    expect(imp.notes.join(" ")).toMatch(/void around \(5, 5\).*filled with "Soil"/);
    expect(imp.notes.join(" ")).not.toMatch(/separate bodies/);
  });

  it("does not move vertices outside the model when it squares the sides, nor note it", () => {
    const text = sli({
      materials: ["type: 0 water: 1 wtable: 1 c: 10 phi: 30 uw: 18"],
      names: ["Soil"],
      vertices: [[0, 0], [20, 0], [20, 10], [0, 10], [-5, 8], [25, 6]],
      cells: [[[1, 2, 3], 1], [[1, 3, 4], 1]],
      extra: "water table:\r\n  vertices: [5,6]\r\n",
    });
    const imp = sliToDefinition(parseSli(text), 0, "w.sli");
    expect(imp.notes.join(" ")).not.toMatch(/lean/);
    const w = imp.definition.waterTable!.value as [number, number][];
    expect(w.map((p) => p[0])).toEqual([0, 20]);
    expect(w[0][1]).toBeCloseTo(8 - 1 / 3, 9);
    expect(w[1][1]).toBeCloseTo(6 + 1 / 3, 9);
  });

  it("keeps a piezometric line when the drawdown line would replace an unused water table, and ignores a one-point water table", () => {
    const base = {
      materials: ["type: 0 water: 1 wtable: 2 c: 0 phi: 30 uw: 20 rd_undrained: 1 rd_cr: 20 rd_phir: 15"],
      names: ["Shell"],
      vertices: [[0, 0], [20, 0], [20, 10], [0, 10], [0, 9], [20, 9], [0, 4], [20, 4], [0, 6], [20, 6]] as [number, number][],
      cells: [[[1, 2, 3], 1], [[1, 3, 4], 1]] as [number[], number][],
    };
    const text = sli({ ...base, extra: "water table:\r\n  vertices: [5,6]\r\n\r\npiezos:\r\n  1  vertices: [9,10]\r\n\r\ndrawdown line:\r\n  vertices: [7,8]\r\n" });
    const imp = sliToDefinition(parseSli(text), 0, "d.sli");
    expect(imp.definition.rapidDrawdown).toBeUndefined();
    expect(imp.definition.waterTable!.value).toEqual([[0, 6], [20, 6]]);
    const one = sli({ ...base, materials: ["type: 0 water: 1 wtable: 1 c: 0 phi: 30 uw: 20 rd_undrained: 1 rd_cr: 20 rd_phir: 15"], extra: "water table:\r\n  vertices: [5]\r\n\r\ndrawdown line:\r\n  vertices: [7,8]\r\n" });
    expect(() => sliToDefinition(parseSli(one), 0, "d.sli")).not.toThrow();
  });

  it("finds vertices on edges with a tolerance from the model's extent, not its coordinates", () => {
    // at x ≈ 5e5 a vertex 2 cm from a neighbour's edge is not on it
    const o = 5e5;
    const v: [number, number][] = [[o, 0], [o + 1, 0], [o + 1, 1], [o, 1], [o + 2, 0], [o + 2, 1], [o + 1.02, 0.5]];
    const g = cellRegions({ vertices: new Map(v.map((p, i) => [i + 1, p])), cells: [{ ids: [1, 2, 3, 4], material: "soil1" }, { ids: [2, 5, 6, 3, 7], material: "soil2" }] }, []);
    const a = g.regions.find((r) => r.material === "soil1")!;
    expect(a.loops.flat()).not.toContain(7);
  });
});
