/**
 * Write packages/engine-rs/golden/project-corpus.json: the golden corpus of
 * the Rust conversion between the app's models and the engine's definition
 * (crate cslope-project, tests/golden.rs), made by the app's own code:
 *
 * - every example model (`BENCHMARK_MODELS`) and the synthetic models below,
 *   with the definition `buildModelSpaceSlopeDTO` gives them, in full;
 * - every verification problem as Help › Benchmarks opens it
 *   (`modelFromDefinition`, store/verification-models.ts) and that model's
 *   definition, as digests (the problems' definitions are in
 *   golden/verification.json already);
 * - synthetic definitions through `modelFromDefinition`, and the
 *   definitions it refuses with their messages;
 * - boundary ids of the forms the app writes, in its order (localeCompare),
 *   which the Rust conversion's byte order must give too;
 * - models as saved (`model.json`, sparse, older or hand-made) with the
 *   definition and the options the app runs after opening them
 *   (`parseProjectData`, store/persistence.ts), for the Rust
 *   `normalize_for_run`.
 *
 * Run it after a change to the conversion (store/helpers.ts,
 * store/definition-model.ts, utils/reinforcement.ts) or to a verification
 * problem, and commit the file; the Rust test then fails until its
 * conversion matches again.
 *
 *   bun scripts/project-corpus.ts            # the committed corpus
 *   bun scripts/project-corpus.ts --full out.json
 *       # every entry in full (no digests), for finding a difference:
 *       # CSLOPE_PROJECT_CORPUS=out.json cargo test -p cslope-project --release
 *
 * The digest (`digest` below, `digest` in crates/cslope-project/src/digest.rs)
 * is FNV-1a 64 over the JSON value: objects with their keys in byte order,
 * numbers as their IEEE 754 bits (-0 as 0), so that no number formatting
 * enters it.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { initEngineSync, type SlopeDefinition } from "@cslope/engine";

const require = createRequire(import.meta.url);
initEngineSync(readFileSync(require.resolve("@cslope/engine/wasm")));

const { BENCHMARK_MODELS } = await import("../src/store/benchmarks");
const { VERIFICATION_CASES } = await import("@cslope/engine/verification");
const { verificationModels } = await import("../src/store/verification-models");
const { buildModelSpaceSlopeDTO } = await import("../src/store/helpers");
const { modelFromDefinition } = await import("../src/store/definition-model");
const { APP_DEFAULT_ANALYSIS_OPTIONS, MATERIAL_COLORS, PIEZO_COLORS } = await import("../src/store/defaults");
const { parseProjectData } = await import("../src/store/persistence");
type ModelEntry = import("../src/store/types").ModelEntry;

const OUT = join(import.meta.dirname, "../../engine-rs/golden/project-corpus.json");

// ── Digest ──────────────────────────────────────────────────────

const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const MASK = 0xffffffffffffffffn;

class Fnv {
  h = FNV_OFFSET;
  bytes(b: Uint8Array): void {
    for (const x of b) this.h = ((this.h ^ BigInt(x)) * FNV_PRIME) & MASK;
  }
  tag(t: string): void {
    this.bytes(new Uint8Array([t.charCodeAt(0)]));
  }
  u32(n: number): void {
    const b = new Uint8Array(4);
    new DataView(b.buffer).setUint32(0, n, true);
    this.bytes(b);
  }
  str(s: string): void {
    const b = new TextEncoder().encode(s);
    this.u32(b.length);
    this.bytes(b);
  }
}

const byteOrder = (a: string, b: string) => Buffer.compare(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));

function feed(h: Fnv, v: unknown): void {
  if (v === null) h.tag("n");
  else if (typeof v === "boolean") h.tag(v ? "t" : "f");
  else if (typeof v === "number") {
    h.tag("d");
    const b = new Uint8Array(8);
    new DataView(b.buffer).setFloat64(0, v === 0 ? 0 : v, true);
    h.bytes(b);
  } else if (typeof v === "string") {
    h.tag("s");
    h.str(v);
  } else if (Array.isArray(v)) {
    h.tag("a");
    h.u32(v.length);
    for (const x of v) feed(h, x);
  } else if (typeof v === "object") {
    const keys = Object.keys(v as object).sort(byteOrder);
    h.tag("o");
    h.u32(keys.length);
    for (const k of keys) {
      h.str(k);
      feed(h, (v as Record<string, unknown>)[k]);
    }
  } else throw new Error(`not JSON: ${typeof v}`);
}

/** The value as JSON holds it (undefined left out, -0 as 0). */
const json = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

function digest(v: unknown): string {
  const h = new Fnv();
  feed(h, json(v));
  return h.h.toString(16).padStart(16, "0");
}

// ── Models ──────────────────────────────────────────────────────

/** A model without what the conversion does not read and the corpus need not hold (the paper, the run). */
function stripped(m: ModelEntry): Partial<ModelEntry> {
  const out: Partial<ModelEntry> = json(m);
  for (const k of ["resultViewSettings", "projectInfo", "result", "runState", "progress", "errorMessage"] as const) delete out[k];
  return out;
}

/** A model from definition without the parts the Rust conversion leaves out (the paper; the project block has today's date). */
function comparable(m: ModelEntry): Partial<ModelEntry> {
  const out: Partial<ModelEntry> = json(m);
  delete out.resultViewSettings;
  delete out.projectInfo;
  return out;
}

const mc = (unitWeight: number, cohesion: number, frictionAngle: number) => ({ kind: "mohr-coulomb" as const, unitWeight, cohesion, frictionAngle });

const GROUND: [number, number][] = [
  [0, 0],
  [0, 10],
  [20, 10],
  [40, 20],
  [60, 20],
  [60, 0],
];

/** Every field the conversion reads, with the cases it treats apart. */
const SYNTHETIC_FULL = {
  id: "synthetic-full",
  name: "Synthetic: every field",
  orientation: "ltr",
  coordinates: GROUND,
  coordinateExpressions: [{ x: "0" }],
  parameters: [{ id: "p1", name: "h", expression: "10" }],
  materials: [
    { id: "mat-a", name: "Clay", color: "#aa8844", model: mc(18, 10, 25), modelExpressions: { cohesion: "10" } },
    // the same name twice: the engine gets "Clay (2)"
    { id: "mat-b", name: "Clay", color: "#884422", depthRange: [0, 5], model: mc(19, 5, 30) },
    { id: "mat-c", name: "Clay (2)", color: "#448822", model: { kind: "undrained", unitWeight: 17, undrainedShearStrength: 30 } },
    { id: "mat-d", name: "Sand", color: "#cccc44", model: mc(20, 0, 35) },
  ],
  materialBoundaries: [
    // the store order is not the engine's: by id, open ones first
    { id: "bnd-c", coordinates: [[10, 5], [20, 6], [10, 7], [10, 5]] },
    { id: "bnd-b", coordinates: [[0, 6], [60, 8]], coordinateExpressions: [{ y: "6" }] },
    { id: "bnd-a", coordinates: [[0, 3], [60, 4]] },
    // three points with the ends equal: a line folded back, not a loop
    { id: "bnd-d", coordinates: [[30, 2], [35, 2], [30, 2]] },
  ],
  regionMaterials: [
    { point: [5, 1], materialId: "mat-b" },
    { point: [5, 5], materialId: "mat-c" },
    { point: [5, 8], materialId: "mat-gone" },
    { point: [15, 6], materialId: "mat-d" },
  ],
  piezometricLine: {
    enabled: true,
    lines: [
      { id: "line-1", name: "First", color: "#3b82f6", coordinates: [[0, 8], [60, 15]] },
      { id: "line-2", name: "Main", color: "#ef4444", coordinates: [[0, 7], [30, 12], [60, 14]] },
      { id: "line-3", name: "Being drawn", color: "#10b981", coordinates: [[0, 5]] },
      { id: "line-4", name: "Perched", color: "#f59e0b", coordinates: [[0, 9], [60, 18]] },
    ],
    activeLineId: "line-3",
    mainLineId: "line-2",
    freeWater: true,
    materialAssignment: { "mat-a": "line-4", "mat-b": "line-3", "mat-d": "line-1", "mat-gone": "line-4" },
    rapidDrawdown: { waterBefore: [[0, 9.5], [60, 19]] },
  },
  udls: [
    { id: "udl-1", magnitude: 10, x1: 45, x2: 55 },
    { id: "udl-2", magnitude: 5, x1: 22, x2: 30, direction: "normal", excessPorePressure: [{ materialId: "mat-a", ratio: 0.5 }, { materialId: "mat-gone", ratio: 0.2 }] },
    { id: "udl-3", magnitude: 2, x1: 0, x2: 10, direction: "vertical", excessPorePressure: [{ materialId: "mat-gone", ratio: 1 }], expressions: { magnitude: "2" } },
  ],
  lineLoads: [
    { id: "ll-1", magnitude: 50, x: 50 },
    { id: "ll-2", magnitude: 20, x: 25, angle: 0, y: 3 },
    { id: "ll-3", magnitude: 30, x: 30, angle: -20, y: 14 },
    { id: "ll-4", magnitude: 40, x: 35, angle: 15 },
  ],
  reinforcements: [
    { id: "r-1", label: "Anchor", type: "anchor", x1: 30, y1: 14, x2: 20, y2: 11, tensileCapacity: 200, spacing: 2, pullout: "none", bondStrength: 0, bondedLength: 0, adhesion: 0, interfaceFriction: 0, end1Capacity: 100, end2Capacity: 80, direction: "axial", application: "active" },
    { id: "r-2", type: "tieback", x1: 32, y1: 15, x2: 20, y2: 10, tensileCapacity: 300, spacing: 2, pullout: "bond", bondStrength: 60, bondedLength: 5, prestress: 120, adhesion: 0, interfaceFriction: 0, end1Capacity: 300, end2Capacity: 0, direction: "bisector", application: "active" },
    // a prestress without a bonded length is not passed on
    { id: "r-3", type: "nail", x1: 34, y1: 16, x2: 24, y2: 13, tensileCapacity: 100, spacing: 1.5, pullout: "bond", bondStrength: 15, bondedLength: 0, prestress: 50, adhesion: 0, interfaceFriction: 0, end1Capacity: 50, end2Capacity: 0, direction: "axial", application: "passive" },
    { id: "r-4", type: "geosynthetic", x1: 45, y1: 18, x2: 35, y2: 18, tensileCapacity: 50, spacing: 1, pullout: "interface", bondStrength: 0, bondedLength: 0, adhesion: 2, interfaceFriction: 20, end1Capacity: 0, end2Capacity: 0, direction: "tangent", application: "passive" },
    { id: "r-5", type: "anchor", x1: 36, y1: 17, x2: 26, y2: 14, tensileCapacity: 150, spacing: 1, pullout: "development", developmentLength1: 1.5, developmentLength2: 2, bondStrength: 0, bondedLength: 0, adhesion: 0, interfaceFriction: 0, end1Capacity: 0, end2Capacity: 0, direction: "axial", application: "active" },
    { id: "r-6", type: "anchor", x1: 38, y1: 18, x2: 28, y2: 15, tensileCapacity: 150, spacing: 1, pullout: "development", bondStrength: 0, bondedLength: 0, adhesion: 0, interfaceFriction: 0, end1Capacity: 0, end2Capacity: 0, direction: "axial", application: "passive" },
  ],
  piles: [
    { id: "p-1", label: "Row", type: "pile", x1: 30, y1: 15, x2: 30, y2: 0, mode: "ito-matsui", force: 100, diameter: 0.6, spacing: 2, shearCapacity: 0, momentCapacity: 0, angle: 0, direction: "tangent", application: "passive" },
    { id: "p-2", type: "sheet-pile", x1: 40, y1: 20, x2: 40, y2: 2, mode: "force", force: 80, diameter: 0.6, spacing: 1, shearCapacity: 200, momentCapacity: 300, bendingStiffness: 50000, angle: 10, application: "active", location: "slip-surface" },
    { id: "p-3", type: "pile", x1: 50, y1: 20, x2: 48, y2: 5, mode: "force", force: 60, diameter: 0.8, spacing: 3, shearCapacity: 0, momentCapacity: 150, angle: 5, direction: "angle", application: "active", location: "centroid" },
  ],
  customSearchPlanes: [
    { id: "csp-2", cx: 0, cy: 0, radius: 0, points: [[15, 10], [30, 5], [45, 20]] },
    { id: "csp-1", cx: 25, cy: 40, radius: 30 },
    { id: "csp-3", cx: 0, cy: 0, radius: 0, points: [[20, 10]] },
    { id: "csp-4", cx: 30, cy: 45, radius: 32 },
  ],
  customPlanesOnly: true,
  blockSearchObjects: [
    { id: "bso-1", points: [[20, 4]] },
    { id: "bso-2", points: [] },
    { id: "bso-3", points: [[35, 6], [45, 6]] },
  ],
  waternet: {
    headLines: [{ id: "h1", points: [[0, 9], [60, 16]] }, { id: "h2", points: [[0, 5], [60, 6]] }],
    referenceLines: [{ points: [[0, 4], [60, 4]], topHeadLineId: "h1", bottomHeadLineId: "h2" }],
    phreaticLineId: "h1",
  },
  earlierStage: {
    coordinates: GROUND,
    materials: [{ name: "Clay", model: mc(18, 10, 25) }],
    waterTable: { mode: "custom", value: [[0, 6], [60, 12]], followBoundary: true },
  },
  options: { ...APP_DEFAULT_ANALYSIS_OPTIONS, searchMethod: "block" },
  analysisLimits: { enabled: true, entryLeftX: 18, entryRightX: 30, exitLeftX: 42, exitRightX: 58 },
  locks: { geometry: true },
  editViewScale: 2,
} as unknown as ModelEntry;

/** The other branches: water clipped at the ground, one line, no block search, limits off, no loads. */
const SYNTHETIC_PLAIN = {
  id: "synthetic-plain",
  name: "Synthetic: the other branches",
  orientation: "rtl",
  coordinates: GROUND.map(([x, y]) => [60 - x, y]),
  materials: [{ id: "m1", name: "Fill", color: "#999999", model: mc(19, 3, 32) }],
  materialBoundaries: [],
  regionMaterials: [],
  piezometricLine: {
    enabled: true,
    lines: [{ id: "only", name: "Water", color: "#3b82f6", coordinates: [[0, 12], [60, 6]] }],
    activeLineId: "only",
    freeWater: false,
    materialAssignment: { m1: "only" },
    rapidDrawdown: { waterBefore: [[0, 12]] },
  },
  udls: [],
  lineLoads: [],
  customSearchPlanes: [{ id: "csp", cx: 0, cy: 0, radius: 0, points: [[10, 10], [40, 5], [50, 20]] }],
  customPlanesOnly: false,
  blockSearchObjects: [{ id: "bso", points: [[20, 4]] }],
  options: { ...APP_DEFAULT_ANALYSIS_OPTIONS, method: "Bishop" },
  analysisLimits: { enabled: false, entryLeftX: 1, entryRightX: 2, exitLeftX: 3, exitRightX: 4 },
} as unknown as ModelEntry;

/** The fields an older or hand-made model may lack (the defaults of helpers.ts). */
const SYNTHETIC_SPARSE = {
  id: "synthetic-sparse",
  name: "Synthetic: missing fields",
  coordinates: GROUND,
  materials: [
    { id: "m1", name: "Soil", model: mc(18, 5, 28) },
    { id: "m2", name: "Rock", color: "#666666", model: mc(22, 50, 40) },
  ],
  materialBoundaries: [{ id: "b", coordinates: [[0, 4], [60, 5]] }],
  regionMaterials: [{ point: [5, 2], materialId: "m2" }],
  piezometricLine: {
    enabled: true,
    lines: [
      { id: "short", name: "Short", color: "#3b82f6", coordinates: [[0, 5]] },
      { id: "full", name: "Full", color: "#ef4444", coordinates: [[0, 6], [60, 9]] },
    ],
    activeLineId: null,
    mainLineId: "short",
    materialAssignment: { m2: "short" },
  },
  udls: [{ id: "u", magnitude: 3, x1: 1, x2: 4 }],
  lineLoads: [{ id: "l", magnitude: 3, x: 2, y: 9 }],
  customSearchPlanes: [{ id: "c", cx: 20, cy: 40, radius: 30 }],
  options: { ...APP_DEFAULT_ANALYSIS_OPTIONS },
} as unknown as ModelEntry;

/** One line still being drawn only: no water. */
const SYNTHETIC_NO_WATER = {
  id: "synthetic-no-water",
  name: "Synthetic: a line still being drawn",
  orientation: "ltr",
  coordinates: GROUND,
  materials: [{ id: "m1", name: "Soil", color: "#aaaaaa", model: mc(18, 5, 28) }],
  materialBoundaries: [],
  regionMaterials: [],
  piezometricLine: { enabled: false, lines: [{ id: "x", name: "x", color: "#000000", coordinates: [[1, 2]] }], activeLineId: "x", materialAssignment: {} },
  udls: [],
  lineLoads: [],
  customSearchPlanes: [{ id: "c", cx: 0, cy: 0, radius: 0, points: [[1, 1]] }],
  customPlanesOnly: false,
  options: { ...APP_DEFAULT_ANALYSIS_OPTIONS },
  analysisLimits: { enabled: false, entryLeftX: 4, entryRightX: 8, exitLeftX: 12.5, exitRightX: 15 },
} as unknown as ModelEntry;

// ── Definitions (the reverse) ──────────────────────────────────

const DEF_FULL: SlopeDefinition = {
  orientation: "ltr",
  coordinates: GROUND,
  materials: [
    { name: "Clay", color: "#123456", depthRange: [0, 4], model: mc(18, 10, 25), waterTableId: "perched" },
    // an older definition: the flat Mohr-Coulomb fields
    { name: "Old", unitWeight: 19, cohesion: 2, frictionAngle: 31, cohesionRefDepth: 5, cohesionRateOfChange: 1 } as SlopeDefinition["materials"][number],
    { name: "Sand", model: mc(20, 0, 35), waterTableId: "same" },
    { name: "Gravel", model: mc(21, 0, 38) },
  ],
  waterTable: { mode: "custom", value: [[0, 7], [60, 15]], freeWater: true },
  waterTables: [
    { id: "perched", coordinates: [[0, 9], [60, 18]], freeWater: true },
    { id: "same", coordinates: [[0, 7], [60, 15]] },
  ],
  rapidDrawdown: { waterBefore: [[0, 9], [60, 19]] },
  materialBoundaries: [{ coordinates: [[0, 4], [60, 5]], materialName: "" }, { coordinates: [[0, 2], [60, 3]] }],
  regionAssignments: [
    { point: [5, 1], materialName: "Old" },
    { point: [5, 3], materialName: "Missing" },
    { point: [5, 8], materialName: "Sand" },
  ],
  udls: [
    { magnitude: 10, x1: 45, x2: 55, direction: "vertical" },
    { magnitude: 4, x1: 22, x2: 30, direction: "normal", excessPorePressure: [{ material: "Clay", ratio: 0.4 }, { material: "Missing", ratio: 1 }] },
  ],
  lineLoads: [
    { magnitude: 50, x: 50 },
    { magnitude: 30, x: 30, angle: -20, y: 14 },
    { magnitude: 20, x: 25, angle: 0, y: 3 },
  ],
  customSearchPlanes: [{ cx: 25, cy: 40, radius: 30 }],
  customSurfaces: [{ points: [[15, 10], [30, 5], [45, 20]] }],
  customPlanesOnly: true,
  blockSearchObjects: [{ points: [[20, 4]] }, { points: [[35, 6], [45, 6]] }],
  reinforcements: [
    { x1: 30, y1: 14, x2: 20, y2: 11, tensileCapacity: 200 },
    { x1: 32, y1: 15, x2: 20, y2: 10, tensileCapacity: 300, spacing: 2, pullout: { kind: "bond", strength: 60, bondedLength: 5 }, prestress: 100, end1Capacity: 300, direction: "bisector", application: "active" },
    { x1: 34, y1: 16, x2: 24, y2: 13, tensileCapacity: 100, spacing: 1.5, pullout: { kind: "bond", strength: 15 }, end1Capacity: 50, end2Capacity: 10, application: "passive" },
    { x1: 45, y1: 18, x2: 35, y2: 18, tensileCapacity: 50, pullout: { kind: "interface", adhesion: 2, frictionAngle: 20, coverage: 1 }, direction: "tangent" },
    { x1: 36, y1: 17, x2: 26, y2: 14, tensileCapacity: 150, pullout: { kind: "development", length1: 1.5, length2: 2 } },
    { x1: 37, y1: 17, x2: 27, y2: 14, tensileCapacity: 150, direction: "tangent" },
  ],
  piles: [
    { x1: 30, y1: 15, x2: 30, y2: 0 },
    { x1: 40, y1: 20, x2: 40, y2: 2, force: 80, spacing: 1, shearCapacity: 200, momentCapacity: 300, bendingStiffness: 50000, angle: 10, application: "active", location: "slip-surface" },
    { x1: 50, y1: 20, x2: 48, y2: 5, force: 60, diameter: 0.8, spacing: 3, angle: 5, direction: "angle", application: "passive" },
  ],
  waternet: {
    headLines: [{ id: "h1", points: [[0, 9], [60, 16]] }],
    referenceLines: [{ points: [[0, 4], [60, 4]], topHeadLineId: "h1" }],
    phreaticLineId: "h1",
  },
  earlierStage: { coordinates: GROUND, materials: [{ name: "Clay", model: mc(18, 10, 25) }] },
  analysisLimits: { entryLeftX: 18, entryRightX: 30, exitLeftX: 42, exitRightX: 58 },
} as SlopeDefinition;

/** No orientation (inferred), no water, no limits (the model's x range), the deprecated followBoundary. */
const DEF_PLAIN: SlopeDefinition = {
  coordinates: GROUND.map(([x, y]) => [60 - x, y]),
  materials: [{ name: "Fill", model: mc(19, 3, 32) }],
} as SlopeDefinition;

const DEF_FOLLOW: SlopeDefinition = {
  coordinates: GROUND,
  materials: [{ name: "A", model: mc(19, 3, 32), waterTableId: "b" }, { name: "B", model: mc(19, 3, 32), waterTableId: null }],
  waterTable: { mode: "custom", value: [[0, 7], [60, 15]], followBoundary: false },
  waterTables: [{ id: "b", coordinates: [[0, 6], [60, 12]], followBoundary: false }],
} as unknown as SlopeDefinition;

const REFUSED: { name: string; definition: SlopeDefinition }[] = [
  { name: "a water table by height", definition: { coordinates: GROUND, materials: [{ name: "A", model: mc(19, 3, 32) }], waterTable: { mode: "height", value: 5 } } as SlopeDefinition },
  { name: "further water tables without a main one", definition: { coordinates: GROUND, materials: [{ name: "A", model: mc(19, 3, 32) }], waterTables: [{ id: "x", coordinates: [[0, 5], [60, 5]] }] } as SlopeDefinition },
  {
    name: "water tables that differ in free water",
    definition: { coordinates: GROUND, materials: [{ name: "A", model: mc(19, 3, 32) }], waterTable: { mode: "custom", value: [[0, 5], [60, 5]], freeWater: true }, waterTables: [{ id: "x", coordinates: [[0, 4], [60, 4]], freeWater: false }] } as SlopeDefinition,
  },
  { name: "an unknown water table", definition: { coordinates: GROUND, materials: [{ name: "A", model: mc(19, 3, 32), waterTableId: "nope" }], waterTable: { mode: "custom", value: [[0, 5], [60, 5]] } } as SlopeDefinition },
  {
    name: "interface coverage",
    definition: { coordinates: GROUND, materials: [{ name: "A", model: mc(19, 3, 32) }], reinforcements: [{ x1: 1, y1: 1, x2: 2, y2: 2, tensileCapacity: 5, pullout: { kind: "interface", adhesion: 0, frictionAngle: 20, coverage: 0.5 } }] } as SlopeDefinition,
  },
  { name: "a material without a model", definition: { coordinates: GROUND, materials: [{ name: "A", unitWeight: 19 }] } as SlopeDefinition },
];

// ── Models as saved (the app's load) ───────────────────────────

/** The fixture of a project saved by this schema version, as files hold it (without the run). */
const FIXTURE_MODELS = (
  JSON.parse(readFileSync(join(import.meta.dirname, "../src/features/project/fixtures/legacy-json-v3.json"), "utf8")) as { models: Record<string, unknown>[] }
).models.map((m) => {
  const { runState: _s, progress: _p, result: _r, errorMessage: _e, ...rest } = m;
  void [_s, _p, _r, _e];
  return rest;
});

/** Saved models whose fields the app's load fills, clamps or drops. */
const SAVED: { name: string; raw: Record<string, unknown> }[] = [
  ...FIXTURE_MODELS.map((raw) => ({ name: `fixture legacy-json-v3: ${String(raw.name)}`, raw })),
  {
    name: "fields missing: orientation, options, limits, water",
    raw: {
      id: "sparse",
      // faces left (inferred), no orientation
      coordinates: [[0, 0], [0, 20], [20, 20], [40, 10], [60, 10], [60, 0]],
      materials: [{ id: "m1", name: "Soil", model: mc(18, 5, 28) }],
    },
  },
  {
    name: "options of an older file, out of range and unknown",
    raw: {
      id: "old-options",
      coordinates: GROUND,
      orientation: "ltr",
      materials: [{ id: "m1", name: "Soil", color: "#999999", model: mc(18, 5, 28) }],
      analysisLimits: { enabled: true, entryLeftX: 18, entryRightX: "x", exitLeftX: 42 },
      options: {
        method: "Spencer",
        slices: 5,
        iterations: 50,
        refinedIterations: -3,
        tolerance: 0.5,
        maxIterations: 0,
        minFailureDist: -1,
        tensionCrackDepth: -2,
        tensionCrackWater: 3,
        intersliceFunction: "trapezoidal",
        intersliceDataPoints: [[0, "0.5"], ["1", 1], ["", 2], [3]],
        janbuCorrection: "yes",
        porePressureHead: "phreatic-correction",
        minSlipDepth: 0,
        minSlipArea: 2,
        seismicHorizontal: 0.1,
        seismicVertical: 2,
        tensionCrackAngle: 45,
        nonCircularOptimization: true,
        searchMethod: "grid",
        blockActiveAngle: [40, 60],
        blockPassiveAngle: [60, 40],
        bothDirections: true,
        partialFactors: { cu: 1.5, cohesion: 1.3, tanPhi: 1.3, variableLoad: 1.3, basis: { safetyClass: 3, etaCu: 1, etaDrained: 1, variableLoadBase: 1.3 } },
        fem: { enabled: true, poissonsRatio: 0.6, refinementLevels: 2.4, elementSize: -1, limitAnalysis: true, k0: 9, materialStages: { Soil: 2, Other: 1.5 } },
        sgi3d: { enabled: true, length: -1, excludeMaterials: ["Soil", "Soil", 3] },
        unknownOption: 1,
      },
    },
  },
  {
    name: "rows the load drops or mends",
    raw: {
      id: "rows",
      coordinates: GROUND,
      orientation: "ltr",
      materials: [
        { id: "m1", name: "Flat", unitWeight: 19, cohesion: -2, frictionAngle: 30 },
        { id: "m2", name: "Sat", color: "", model: { ...mc(18, 5, 28), unitWeightSat: 600, phiB: 15, maxSuction: -1, drawdownStrength: { cohesion: 2, frictionAngle: 95 } } },
        { id: "m3", name: "Su", model: { kind: "undrained", unitWeight: 17, undrainedShearStrength: 30, suMax: 0, anisotropy: [], phiB: 10, bBar: 3, ru: 0.2 } },
        { id: "m4", name: "Deep", depthRange: [0, "5"], model: { kind: "s-f-depth", unitWeight: 18, suTop: 10, rate: 1, depthReference: "datum", aboveWater: { kind: "undrained", unitWeight: 18, undrainedShearStrength: 5, aboveWater: { kind: "x" } } } },
      ],
      materialBoundaries: [{ id: "b2", coordinates: [[0, 3], [60, "4"], [60, 4]] }, { id: "b1", coordinates: [[0, 6], [60, 6]], extra: 1 }],
      regionMaterials: [{ point: [5, 1], materialId: "m2" }, { point: [5, 4] }, { point: [5, "x"], materialId: "m3" }, { point: [5, 8], materialId: "m4" }],
      piezometricLine: {
        enabled: true,
        lines: [{ id: "w1", name: "W", color: "#000000", coordinates: [[0, 8], [30, "x"], [60, 12]] }, { id: "w2", coordinates: [[0, 7], [60, 9]] }],
        activeLineId: "nope",
        mainLineId: "nope",
        materialAssignment: { m3: "w2", m4: 7 },
        rapidDrawdown: { waterBefore: [[0, 9], [0, 10]] },
      },
      udls: [
        { id: "u1", magnitude: 5, x1: 3, x2: 3 },
        { id: "", magnitude: 5, x1: 1, x2: 3 },
        { id: "u3", magnitude: "5", x1: 45, x2: 55, direction: "normal", excessPorePressure: [{ materialId: "m3", ratio: 1.5 }, { materialId: "m3", ratio: 0.5 }] },
      ],
      lineLoads: [{ id: "l1", magnitude: 10, x: 50, angle: 200, y: 3 }, { id: "l2", magnitude: 10, x: 30, angle: -30 }, { magnitude: 1, x: 2 }],
      reinforcements: [
        { type: "nail", x1: 34, y1: 16, x2: 24, y2: 13 },
        { type: "rope", x1: 1, y1: 1, x2: 2, y2: 2 },
        { id: "r3", type: "geosynthetic", x1: 45, y1: 18, x2: 35, y2: 18, interfaceFriction: 95, spacing: 0, pullout: "glue" },
        { id: "r4", type: "tieback", x1: 32, y1: 15, x2: 20, y2: "10" },
      ],
      piles: [
        { type: "pile", x1: 30, y1: 15, x2: 30, y2: 0, diameter: -1, angle: 120, direction: "up", location: "top" },
        { id: "p2", type: "sheet-pile", x1: 40, y1: 20, x2: 40, y2: 2, mode: "force", force: -5, bendingStiffness: 0 },
      ],
      customSearchPlanes: [{ id: "c1", cx: 25, cy: 40, radius: 0 }, { id: "c2", cx: 25, cy: 40, radius: 30 }, { id: "c3", points: [[15, 10], ["x", 1], [45, 20]] }],
      customPlanesOnly: "true",
      blockSearchObjects: [{ id: "o1", points: [[20, 4]] }],
      waternet: { headLines: [{ id: "h1", points: [[0, 9], [60, 16]] }, { points: [] }], referenceLines: [{ points: [[0, 4], [60, 4]], topHeadLineId: "h1", bottomHeadLineId: 2 }], phreaticLineId: 1 },
      earlierStage: {
        coordinates: GROUND,
        materials: [{ name: "Soil", model: mc(18, 5, 28), color: 3 }, { name: "Bad", model: mc(-1, 5, 28) }, { name: "Gone" }],
        materialBoundaries: [{ coordinates: [[0, 3], [60, 4]], materialName: "Bad" }, { coordinates: [[0, 1]] }],
        regionAssignments: [{ point: [1, 1], materialName: "Soil" }, { point: [1, 2], materialName: "Bad" }],
        topRegionMaterialName: "Bad",
        waterTable: { mode: "custom", value: [[0, 6], [60, 12]], followBoundary: "yes" },
        waterTables: [{ id: "x", coordinates: [[0, 5], [60, 5]], followBoundary: true, freeWater: true }, { coordinates: [[0, 1], [60, 1]] }],
        udls: [{ magnitude: 3, x1: 1, x2: 1 }, { magnitude: 3, x1: 1, x2: 4, excessPorePressure: [{ material: "Bad", ratio: 0.5 }, { material: "Soil", ratio: 0.5 }] }],
        earlierStage: { coordinates: GROUND, materials: [] },
        unknownStageField: 1,
      },
      options: { ...APP_DEFAULT_ANALYSIS_OPTIONS, searchMethod: "block" },
    },
  },
];

// ── Boundary order ──────────────────────────────────────────────

/** Ids of the forms the app writes (nextId with and without crypto, modelFromDefinition, older files). */
const ORDER_SAMPLES = [
  "bnd-0f8e3a2c-1d4b-4e5f-8a9b-7c6d5e4f3a2b",
  "bnd-0f8e3a2c-1d4b-4e5f-8a9b-7c6d5e4f3a2c",
  "bnd-a0000000-0000-4000-8000-000000000000",
  "bnd-9fffffff-ffff-4fff-bfff-ffffffffffff",
  "bnd-f1e2d3c4-b5a6-4978-8695-a4b3c2d1e0f9",
  "bnd-101",
  "bnd-99",
  "bnd-1000",
  "verification-V001-boundary-001",
  "verification-V001-boundary-010",
  "verification-V001-boundary-002",
  "verification-V105d-boundary-001",
  "synthetic-full-boundary-001",
  "boundary-1",
  "boundary-2",
  "boundary-10",
  "b1",
  "b2",
  "b10",
];

const DIGEST_SAMPLE = { b: [1, 2.5, null, true, -0, 1e-7, 1e21, 0.1 + 0.2], a: "x é ✓", c: { z: { y: [] }, Y: false, "": "" } };

// ── Build ───────────────────────────────────────────────────────

const full = process.argv[2] === "--full";
const fullPath = process.argv[3];
if (full && !fullPath) throw new Error("usage: project-corpus.ts [--full out.json]");

/** The options a model from definition gets on top of the app's defaults: those that differ. */
function optionsDelta(options: Record<string, unknown>): Record<string, unknown> {
  const base = json(APP_DEFAULT_ANALYSIS_OPTIONS) as unknown as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(json(options))) if (JSON.stringify(base[k]) !== JSON.stringify(v)) out[k] = v;
  return out;
}

const orderCheck = (ids: string[]) => {
  const icu = [...ids].sort((a, b) => a.localeCompare(b));
  const bytes = [...ids].sort(byteOrder);
  if (JSON.stringify(icu) !== JSON.stringify(bytes)) throw new Error(`The app's order of the ids ${ids.join(", ")} is not their byte order`);
};
orderCheck(ORDER_SAMPLES);

const models = [...BENCHMARK_MODELS.map((m) => ["example", m] as const), ...[SYNTHETIC_FULL, SYNTHETIC_PLAIN, SYNTHETIC_SPARSE, SYNTHETIC_NO_WATER].map((m) => ["synthetic", m] as const)].map(([source, m]) => {
  orderCheck((m.materialBoundaries ?? []).map((b) => b.id));
  return { name: m.name, source, model: stripped(m), definition: json(buildModelSpaceSlopeDTO(m)) };
});

// Help › Benchmarks: modelFromDefinition with the problem's options.
const verification = verificationModels().map((m, i) => {
  const c = VERIFICATION_CASES[i];
  if (m.id !== `verification-${c.id}`) throw new Error(`verificationModels() is not in the order of VERIFICATION_CASES (${m.id})`);
  orderCheck(m.materialBoundaries.map((b) => b.id));
  const model = comparable(m);
  const definition = json(buildModelSpaceSlopeDTO(m));
  return {
    case: c.id,
    info: { id: m.id, name: m.name, options: optionsDelta(m.options as unknown as Record<string, unknown>) },
    inputDigest: digest(c.definition),
    ...(full ? { input: json(c.definition), model, definition } : { modelDigest: digest(model), definitionDigest: digest(definition) }),
  };
});

const definitions = [
  { name: "every field", info: { id: "def-full", name: "Every field", options: { method: "Bishop" as const, slices: 40 } }, definition: DEF_FULL },
  { name: "plain", info: { id: "def-plain", name: "Plain" }, definition: DEF_PLAIN },
  { name: "deprecated followBoundary", info: { id: "def-follow", name: "Follow" }, definition: DEF_FOLLOW },
].map((d) => {
  const m = modelFromDefinition(d.definition, d.info);
  return { ...d, definition: json(d.definition), model: comparable(m), roundTrip: json(buildModelSpaceSlopeDTO(m)) };
});

// Opened as the app opens a project of this schema version.
const saved = SAVED.map(({ name, raw }) => {
  const [model] = parseProjectData({ version: 3, models: [raw] }).models;
  return { name, raw: json(raw), definition: json(buildModelSpaceSlopeDTO(model)), options: json(model.options) };
});

const refused = REFUSED.map((r) => {
  try {
    modelFromDefinition(r.definition, { id: "x", name: "x" });
  } catch (e) {
    return { name: r.name, definition: json(r.definition), error: (e as Error).message };
  }
  throw new Error(`modelFromDefinition accepted "${r.name}"`);
});

const corpus = {
  $comment:
    "The golden corpus of the conversion between the app's models and the engine's definition (crates/cslope-project, tests/golden.rs), made by the app's code with packages/desktop/scripts/project-corpus.ts; do not edit. Verification entries are digests (FNV-1a 64 over the JSON value, see the script) of the model Help › Benchmarks opens and its definition; their problems are in golden/verification.json.",
  appDefaultOptions: json(APP_DEFAULT_ANALYSIS_OPTIONS),
  materialColors: MATERIAL_COLORS,
  piezoColors: PIEZO_COLORS,
  // the digest of a value with what it treats apart, for the Rust digest to match
  digestSample: { value: DIGEST_SAMPLE, digest: digest(DIGEST_SAMPLE) },
  boundaryOrder: [...ORDER_SAMPLES].sort((a, b) => a.localeCompare(b)),
  models,
  verification,
  definitions,
  saved,
  refused,
};

const text = JSON.stringify(corpus) + "\n";
writeFileSync(full ? fullPath : OUT, text);
console.log(`${full ? fullPath : OUT}: ${models.length} models, ${verification.length} verification problems, ${definitions.length} definitions, ${saved.length} saved, ${refused.length} refused; ${(text.length / 1024).toFixed(0)} kB`);
