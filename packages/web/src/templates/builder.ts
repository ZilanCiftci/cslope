/**
 * A slope model in the app's terms, written as an analysis document: the
 * TypeScript twin of Python's builder (packages/engine-rs/crates/cslope-py/
 * python/cslope/build.py), with its names (addMaterial, addInteriorBoundary,
 * assign(at), addPiezometricLine, addDistributedLoad, searchLimits) and its
 * checks (a point lies in the model, a boundary reaches the exterior), so
 * that a mistake fails where it is made. Units: m, kPa, kN/m³ and degrees.
 */
import type { AnalysisOptions, MaterialModel, SlopeDefinition, SlopeOrientation } from "@cslope/engine";
import { DOCUMENT_FORMAT, DOCUMENT_FORMAT_VERSION, type AnalysisDocument } from "../engine/document";

export type Point = [number, number];

/**
 * A material's strength and weight, as Python's `add_material` takes them:
 * `su` (undrained, kPa), `su` with `suRate` and `suLevel` (Su increasing
 * by `suRate` kPa/m below the elevation `suLevel`, where it is `su`),
 * `c` and `phi` (drained, kPa and °), or `impenetrable` (rock). `gamma`
 * is the unit weight (kN/m³), `gammaSat` the one below the water
 * (default: `gamma`).
 */
export type Strength =
  | { su: number; suRate?: undefined; gamma: number; gammaSat?: number }
  | { su: number; suRate: number; suLevel: number; gamma: number; gammaSat?: number }
  | { c: number; phi: number; gamma: number; gammaSat?: number }
  | { impenetrable: true; gamma: number };

/**
 * The app's options for a new model (D-23), written out as Python's
 * `Options` does: `publicDefaultOptions()` over the engine's defaults.
 * A test keeps them equal to the engine's.
 */
export const APP_OPTIONS: Partial<AnalysisOptions> = {
  method: "Morgenstern-Price",
  slices: 30,
  iterations: 1000,
  refinedIterations: 500,
  compositeSurfaces: true,
  searchMethod: "circular",
  intersliceFunction: "half-sine",
  tolerance: 0.001,
  minSlipDepth: 0,
  tensionCrackDepth: 0,
  seismicHorizontal: 0,
  seismicVertical: 0,
  bothDirections: false,
};

/** Relative to the model's size: points closer than this to an edge are on it. */
const ON_EDGE = 1e-9;

function finite(value: number, what: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${what} must be a finite number, not ${String(value)}`);
  return value;
}

function positive(value: number, what: string): number {
  if (finite(value, what) <= 0) throw new Error(`${what} must be greater than 0, not ${value}`);
  return value;
}

function nonNegative(value: number, what: string): number {
  if (finite(value, what) < 0) throw new Error(`${what} must be 0 or more, not ${value}`);
  return value;
}

function area(poly: Point[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i];
    const [x2, y2] = poly[(i + 1) % poly.length];
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
}

function distanceToSegment([px, py]: Point, [ax, ay]: Point, [bx, by]: Point): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Ray casting; a point on an edge counts as outside. */
function inside([x, y]: Point, poly: Point[]): boolean {
  let result = false;
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i];
    const [x2, y2] = poly[(i + 1) % poly.length];
    if (y1 > y !== y2 > y && x < x1 + ((y - y1) * (x2 - x1)) / (y2 - y1)) result = !result;
  }
  return result;
}

/** The material model of a strength. */
export function materialModel(strength: Strength): MaterialModel {
  const gamma = positive(strength.gamma, "gamma");
  if ("impenetrable" in strength) return { kind: "impenetrable", unitWeight: gamma };
  const unitWeightSat = positive(strength.gammaSat ?? gamma, "gammaSat");
  if ("su" in strength) {
    const su = nonNegative(strength.su, "su");
    if (strength.suRate === undefined) return { kind: "undrained", unitWeight: gamma, unitWeightSat, undrainedShearStrength: su };
    return {
      kind: "s-f-datum",
      unitWeight: gamma,
      unitWeightSat,
      suRef: su,
      yRef: finite(strength.suLevel, "suLevel"),
      rate: nonNegative(strength.suRate, "suRate"),
    };
  }
  const phi = nonNegative(strength.phi, "phi");
  if (phi >= 90) throw new Error(`phi must be less than 90°, not ${phi}`);
  return { kind: "mohr-coulomb", unitWeight: gamma, unitWeightSat, cohesion: nonNegative(strength.c, "c"), frictionAngle: phi };
}

export class Definition {
  readonly orientation: SlopeOrientation;
  private outline: Point[] | null = null;
  private readonly materials: { name: string; model: MaterialModel }[] = [];
  private readonly boundaries: Point[][] = [];
  private readonly assignments: { point: Point; materialName: string }[] = [];
  private water: SlopeDefinition["waterTable"] | null = null;
  private readonly udls: NonNullable<SlopeDefinition["udls"]> = [];
  private limits: SlopeDefinition["analysisLimits"] | null = null;

  /** "ltr" when the slope slides to the right (the crest on the left), "rtl" when to the left. */
  constructor(orientation: SlopeOrientation = "ltr") {
    this.orientation = orientation;
  }

  /** The outline of the model, a closed polygon of (x, y) points (m). */
  set exterior(points: Point[]) {
    if (points.length < 3) throw new Error(`exterior needs at least 3 points, got ${points.length}`);
    for (const [i, p] of points.entries()) {
      finite(p[0], `exterior point ${i + 1} x`);
      finite(p[1], `exterior point ${i + 1} y`);
    }
    if (area(points) === 0) throw new Error("exterior encloses no area");
    this.outline = points.map(([x, y]) => [x, y]);
  }

  get exterior(): Point[] {
    if (!this.outline) throw new Error("Set the exterior first");
    return this.outline.map(([x, y]) => [x, y]);
  }

  private tolerance(): number {
    const xs = this.exterior.map((p) => p[0]);
    const ys = this.exterior.map((p) => p[1]);
    return ON_EDGE * Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), 1);
  }

  private withinX(x: number, what: string): void {
    const xs = this.exterior.map((p) => p[0]);
    const lo = Math.min(...xs);
    const hi = Math.max(...xs);
    const tol = this.tolerance();
    if (x < lo - tol || x > hi + tol) throw new Error(`${what} x = ${x} is outside the model (x from ${lo} to ${hi})`);
  }

  private onOrOutside(p: Point): boolean {
    const ext = this.exterior;
    const tol = this.tolerance();
    const onEdge = ext.some((a, i) => distanceToSegment(p, a, ext[(i + 1) % ext.length]) <= tol);
    return onEdge || !inside(p, ext);
  }

  /** A line between two materials, from the exterior to the exterior: both ends on the outline or beyond it. */
  addInteriorBoundary(points: Point[]): void {
    if (points.length < 2) throw new Error(`interior boundary needs at least 2 points, got ${points.length}`);
    for (const [end, p] of [
      ["start", points[0]],
      ["end", points[points.length - 1]],
    ] as const) {
      if (!this.onOrOutside(p)) {
        throw new Error(`The interior boundary's ${end} (${p[0]}, ${p[1]}) is inside the model; extend it to the exterior.`);
      }
    }
    this.boundaries.push(points.map(([x, y]) => [x, y]));
  }

  /** A material; returns the name, for `assign`. */
  addMaterial(name: string, strength: Strength): string {
    if (!name.trim()) throw new Error("A material needs a name");
    if (this.materials.some((m) => m.name === name)) throw new Error(`A material named "${name}" exists already`);
    this.materials.push({ name, model: materialModel(strength) });
    return name;
  }

  /** Gives the region that holds the point `at` this material. Assign every region of the model. */
  assign(material: string, at: Point): void {
    if (!this.materials.some((m) => m.name === material)) {
      const names = this.materials.map((m) => `"${m.name}"`).join(", ") || "none yet";
      throw new Error(`No material named "${material}" (materials: ${names})`);
    }
    if (this.onOrOutside(at)) throw new Error(`The point (${at[0]}, ${at[1]}) is not inside the exterior`);
    this.assignments.push({ point: [at[0], at[1]], materialName: material });
  }

  /**
   * The piezometric line (m), from left to right across the model. With
   * `freeWater` (the default) water above the ground acts on it, as in a
   * lake or a ditch; without, the line is cut at the ground.
   */
  addPiezometricLine(points: Point[], freeWater = true): void {
    if (this.water) throw new Error("The model has a piezometric line already");
    if (points.length < 2) throw new Error(`piezometric line needs at least 2 points, got ${points.length}`);
    for (let i = 1; i < points.length; i++) {
      if (points[i][0] < points[i - 1][0]) throw new Error(`The piezometric line must run from left to right (x goes back at ${points[i][0]})`);
    }
    for (const [i, p] of points.entries()) this.withinX(p[0], `Piezometric line point ${i + 1}`);
    this.water = { mode: "custom", value: points.map(([x, y]) => [x, y]), freeWater };
  }

  /** A level ground-water table at the elevation `level` (m), cut at the ground (no free water). */
  /** A horizontal water level; `freeWater`: water above the ground stands on it (ponded), else the level is cut at the ground. */
  setWaterLevel(level: number, freeWater = false): void {
    if (this.water) throw new Error("The model has a piezometric line already");
    this.water = { mode: "height", value: finite(level, "level"), freeWater };
  }

  /** A distributed load `q` (kPa) on the ground from x1 to x2 (m), vertical. */
  addDistributedLoad([x1, x2]: Point, q: number): void {
    if (x1 >= x2) throw new Error(`A distributed load needs x1 < x2, not ${x1} and ${x2}`);
    this.withinX(x1, "Distributed load x1");
    this.withinX(x2, "Distributed load x2");
    this.udls.push({ magnitude: positive(q, "q"), x1, x2 });
  }

  /** Where slip surfaces may enter and exit the ground: entry = [x1, x2] and exit = [x1, x2], in m. */
  searchLimits(entry: Point, exit: Point): void {
    for (const [what, r] of [
      ["entry", entry],
      ["exit", exit],
    ] as const) {
      if (r[0] > r[1]) throw new Error(`${what} must go from left to right: x1 ${r[0]} is greater than x2 ${r[1]}`);
      this.withinX(r[0], `${what} x1`);
      this.withinX(r[1], `${what} x2`);
    }
    this.limits = { entryLeftX: entry[0], entryRightX: entry[1], exitLeftX: exit[0], exitRightX: exit[1] };
  }

  /** The engine's `SlopeDefinition`. */
  definition(): SlopeDefinition {
    if (!this.materials.length) throw new Error("The model has no materials");
    const d: SlopeDefinition = {
      orientation: this.orientation,
      coordinates: this.exterior,
      materials: this.materials.map((m) => ({ name: m.name, model: { ...m.model } })),
    };
    if (this.boundaries.length) d.materialBoundaries = this.boundaries.map((b) => ({ coordinates: b.map(([x, y]) => [x, y]) }));
    if (this.assignments.length) d.regionAssignments = this.assignments.map((a) => ({ point: [a.point[0], a.point[1]], materialName: a.materialName }));
    if (this.water) d.waterTable = { ...this.water };
    if (this.udls.length) d.udls = this.udls.map((u) => ({ ...u }));
    if (this.limits) d.analysisLimits = { ...this.limits };
    return d;
  }

  /** The analysis document, with the given options over the app's. */
  toDocument(options: Partial<AnalysisOptions> = {}): AnalysisDocument {
    return {
      format: DOCUMENT_FORMAT,
      formatVersion: DOCUMENT_FORMAT_VERSION,
      definition: this.definition(),
      options: { ...APP_OPTIONS, ...options },
    };
  }
}
