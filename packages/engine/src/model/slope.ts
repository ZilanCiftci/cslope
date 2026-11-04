/**
 * Core Slope model for slope stability analysis.
 *
 * Implemented by the Rust engine (packages/engine-rs) through WebAssembly (see facade/internal.ts and ARCHITECTURE.md
 * §3.3): the `Slope` is the engine's, behind a handle; this class keeps the
 * mutating TypeScript API over it.
 *
 * - Getters return copies (snapshot semantics), cached until the engine's
 *   slope changes (`slope_stamp`), so that reading a getter twice gives the
 *   same object, as in TypeScript.
 * - Materials keep their identity: the engine's table entries carry the key
 *   of their JavaScript object (facade/materials.ts).
 * - Loads, reinforcement, piles, the waternet and the child slopes set from
 *   JavaScript are given back as the objects set, as TypeScript keeps them.
 */
import { engineEpoch } from "../engine";
import type {
  AnalysisLimits,
  AnalysisMethod,
  AnalysisOptions,
  CustomPlaneRef,
  IntersliceFunctionType,
  PartialFactors,
  PorePressureHead,
  SearchMethod,
  SurfaceRejection,
} from "../types/analysis";
import type { GeometryWithMaterial, Slice } from "../types/geometry";
import type { Pile, Reinforcement } from "../types/reinforcement";
import { type CompositeFloor } from "./composite";
import type { PileProfile, ReinforcementEnvelope } from "./reinforcement";
import type { Waternet } from "./waternet";
import { wasm } from "../facade/internal";
import { materialByKey, materialFromEngine, materialWire, type MaterialEntry } from "../facade/materials";
import { decodePlanes, decodeSlices, encodePlanes, encodeSlices, LAZY, type PlanesWire, type SlicesWire } from "../facade/slice-codec";
import { Material } from "../types/material";
import { LineLoad, Udl } from "../types/loads";

// ── Types used internally ─────────────────────────────────────────

/** A candidate failure surface for analysis. */
export interface SearchPlane {
  /** Entry (left) intersection point [x, y]. */
  lc: [number, number];
  /** Exit (right) intersection point [x, y]. */
  rc: [number, number];
  /** Circle centre x. */
  cx: number;
  /** Circle centre y. */
  cy: number;
  /** Circle radius. */
  radius: number;
  /** Factor of safety (set after analysis). */
  fos: number | null;
  /** Slices for this surface (set after analysis). */
  slices: Slice[] | null;
  /**
   * A circle given directly (addSingleCircularPlane), not checked against
   * the model's boundary when added: evaluatePlanes rejects it when it
   * leaves the model where it is no composite surface.
   */
  unchecked?: true;
  /** Lambda-FS-FForce array for Morgenstern-Price. */
  lffArray?: [number, number, number, number][];
  /**
   * Whether the solver converged for this surface (for Morgenstern-Price:
   * a crossing Fm = Ff; false for a closest pair, see `closestPair`).
   */
  converged?: boolean;
  /**
   * Morgenstern-Price: the moment and force factors never met and the
   * closest pair was accepted (gap in `equilibriumGap`). The factor meets
   * moment equilibrium and force equilibrium only within the gap; the
   * surface is not converged but keeps its factor.
   */
  closestPair?: boolean;
  /**
   * Morgenstern-Price: |Fm − Ff| of a solution accepted as the closest
   * pair because the curves never crossed (no complete-equilibrium
   * solution exists on the surface). Absent when they crossed.
   */
  equilibriumGap?: number;
  /** A candidate of the non-circular optimisation. */
  optimised?: boolean;
  /**
   * Non-circular surface: polyline from entry to exit (x increasing).
   * (cx, cy) is then the axis point for moment equilibrium and `radius`
   * is 0.
   */
  points?: [number, number][];
  /**
   * Bottom of the tension crack [x, y] on the arc, where the surface was
   * cut off; the sliding mass starts here instead of at `lc`.
   */
  crack?: [number, number];
  /**
   * A composite circle (model/composite.ts): the surface as analysed, from
   * the entry (or crack) to the exit, following the floor where the circle
   * went below it. Absent for a plain circle.
   */
  composite?: [number, number][];
  /** Generated tangent to this material interface (search.ts). */
  tangentTo?: number;
  /**
   * Not analysed: shallower than the minimum slip depth or smaller than
   * the minimum slip area.
   */
  belowMinSize?: boolean;
  /**
   * The custom search plane of the definition this plane was added for
   * (buildSlope); carried through the analysis to the result.
   */
  customPlane?: CustomPlaneRef;
  /** Why the evaluation left the plane without a factor (evaluatePlanes). */
  rejection?: SurfaceRejection;
}

type Pt = [number, number];
type Xy = { x: number[]; y: number[] };

const finalizer = new FinalizationRegistry<{ handle: number; epoch: number }>((h) => {
  if (h.epoch === engineEpoch()) wasm().slope_free(h.handle);
});

const STALE = "The object was freed, or the engine was restarted after an internal error; build it again.";

/** Given by `Slope._wrap`: the constructor takes the handle instead of making a slope. */
let adopting: number | undefined;

function asUdl(u: Udl): Udl {
  return Object.assign(Object.create(Udl.prototype) as Udl, u);
}

function asLineLoad(l: LineLoad): LineLoad {
  return Object.assign(Object.create(LineLoad.prototype) as LineLoad, l);
}

export class Slope {
  /** @internal The engine's handle (valid for `_epoch`). */
  private readonly _handle: number;
  private readonly _epoch: number;
  private _seen = -1;
  private _cache = new Map<string, unknown>();
  private _table: MaterialEntry[] | null = null;
  // what JavaScript set, given back as set (null: read from the engine)
  private _udls: Udl[] | null = [];
  private _lls: LineLoad[] | null = [];
  private _reinforcements: Reinforcement[] | null = [];
  private _piles: Pile[] | null = [];
  private _waternet: { value: Waternet | null } | null = { value: null };
  private _earlierStage: { value: Slope | null } | null = { value: null };
  private _drawdownBefore: { value: Slope | null } | null = { value: null };

  constructor() {
    const given = adopting;
    adopting = undefined;
    this._handle = given ?? (wasm().slope_new() as number);
    this._epoch = engineEpoch();
    finalizer.register(this, { handle: this._handle, epoch: this._epoch }, this);
    if (given !== undefined) {
      this._udls = this._lls = this._reinforcements = this._piles = null;
      this._waternet = this._earlierStage = this._drawdownBefore = null;
    }
  }

  /** @internal A Slope over a handle the engine made (buildSlope, a child). */
  static _wrap(handle: number): Slope {
    adopting = handle;
    return new Slope();
  }

  /** @internal The handle, refused when the engine restarted since. */
  get _h(): number {
    if (this._epoch !== engineEpoch()) throw new Error(STALE);
    return this._handle;
  }

  /** Frees the engine's slope now (otherwise when this object is collected). */
  free(): void {
    finalizer.unregister(this);
    if (this._epoch === engineEpoch()) wasm().slope_free(this._handle);
  }

  // ── cache ──────────────────────────────────────────────────────

  private _fresh(): void {
    const stamp = wasm().slope_stamp(this._h) as number;
    if (stamp !== this._seen) {
      this._cache.clear();
      this._table = null;
      this._seen = stamp;
    }
  }

  private _get<T>(name: string, decode?: (v: unknown) => T): T {
    this._fresh();
    if (!this._cache.has(name)) {
      const raw = wasm().slope_get(this._h, name);
      this._cache.set(name, decode ? decode(raw) : raw);
    }
    return this._cache.get(name) as T;
  }

  /** A value computed once while the slope is unchanged. */
  private _memo<T>(name: string, compute: () => T): T {
    this._fresh();
    if (!this._cache.has(name)) this._cache.set(name, compute());
    return this._cache.get(name) as T;
  }

  // ── materials ──────────────────────────────────────────────────

  /** @internal The JavaScript object of table entry `i`. */
  _material(i: number): Material {
    this._fresh();
    this._table ??= wasm().slope_get(this._h, "materials") as MaterialEntry[];
    const e = this._table[i];
    if (e.key !== null) {
      const m = materialByKey(e.key);
      if (m) return m;
    }
    const m = materialFromEngine(e);
    e.key = m._key;
    wasm().slope_set_material_key(this._h, i, m._key);
    return m;
  }

  /** @internal The table index of a material (added to the table if new). */
  _materialIndex(m: Material): number {
    // (a material of the table is found without a call, which also works
    // while the engine runs an evaluate callback and the slope is in use)
    this._fresh();
    this._table ??= wasm().slope_get(this._h, "materials") as MaterialEntry[];
    const i = this._table.findIndex((e) => e.key === m._key);
    if (i >= 0) return i;
    this._table = null;
    return wasm().slope_material_index(this._h, materialWire(m)) as number;
  }

  /** @internal Gives every table entry its JavaScript object (before a callback runs). */
  _bindMaterials(): void {
    this._fresh();
    this._table ??= wasm().slope_get(this._h, "materials") as MaterialEntry[];
    for (let i = 0; i < this._table.length; i++) this._material(i);
  }

  /** @internal Slices from the engine, their materials as objects. */
  _slices(wire: SlicesWire): Slice[] {
    return this._bindSlices(decodeSlices(wire));
  }

  private _bindSlices(raw: Record<string, unknown>[], known = new Map<number, Material>()): Slice[] {
    for (const s of raw) {
      const i = s.baseMaterial as number | null;
      if (i === null) continue;
      let m = known.get(i);
      if (!m) known.set(i, (m = this._material(i)));
      s.baseMaterial = m;
    }
    return raw as unknown as Slice[];
  }

  /** @internal Planes from the engine. */
  _planes(wire: PlanesWire, list?: "search" | "individualPlanes"): SearchPlane[] {
    const planes = decodePlanes(wire);
    const known = new Map<number, Material>();
    planes.forEach((p, i) => {
      if ((p.slices as unknown) === LAZY) this._lazySlices(p, list!, i);
      else if (p.slices) this._bindSlices(p.slices, known);
    });
    return planes as SearchPlane[];
  }

  /**
   * The engine kept the critical slices only (memory): the other planes'
   * slices are evaluated again when read, while the slope is the one
   * analysed (the same surface gives the same slices), as TypeScript keeps
   * them. Reading them after the slope changed is an error.
   */
  private _lazySlices(plane: SearchPlane, list: "search" | "individualPlanes", index: number): void {
    const stamp = this._seen;
    let value: Slice[] | null | undefined;
    Object.defineProperty(plane, "slices", {
      enumerable: true,
      configurable: true,
      get: () => {
        if (value === undefined) {
          this._fresh();
          if (this._seen !== stamp) throw new Error("The slices of this surface were dropped by the engine, and the slope has changed since: read them before changing the slope.");
          const w = wasm().slope_plane_slices(this._h, list, index) as SlicesWire | null;
          value = w ? this._slices(w) : null;
        }
        return value;
      },
      set: (v: Slice[] | null) => {
        value = v;
      },
    });
  }

  /** The table index of a slice's material for the engine (null: not a Material). */
  private _indexer(): (m: unknown) => number | null {
    const seen = new Map<unknown, number | null>();
    return (m) => {
      let i = seen.get(m);
      if (i === undefined) {
        i = m instanceof Material ? this._materialIndex(m) : null;
        seen.set(m, i);
      }
      return i;
    };
  }

  /** @internal Slices for the engine (materials as indices). */
  _slicesOut(slices: readonly Slice[]): SlicesWire {
    return encodeSlices(slices as unknown as Record<string, unknown>[], this._indexer());
  }

  /** @internal Planes for the engine. */
  _planesOut(planes: readonly SearchPlane[]): PlanesWire {
    return encodePlanes(planes, this._indexer());
  }

  // ── getters ────────────────────────────────────────────────────

  get materialGeometries(): readonly GeometryWithMaterial[] {
    return this._get("materialGeometries", (v) => {
      const gs = v as (Omit<GeometryWithMaterial, "material"> & { material: unknown })[];
      for (const g of gs) g.material = this._material(g.material as number);
      return gs as GeometryWithMaterial[];
    });
  }

  get surfaceLineXY(): Xy | null {
    return this._get("surfaceLineXY");
  }

  /** Vertices of the external boundary polygon. */
  get externalBoundaryXY(): { x: readonly number[]; y: readonly number[] } {
    return this._get("externalBoundaryXY");
  }

  get waterRLXY(): Xy | null {
    return this._get("waterRLXY");
  }

  get hasWaterTable(): boolean {
    return this._get("hasWaterTable");
  }

  /** True when at least one material uses its own water table. */
  get hasMaterialWaterTables(): boolean {
    return this._get("hasMaterialWaterTables");
  }

  /**
   * Water lines that can govern pore pressure (the default line and any
   * line assigned to a material), used as slice break points.
   */
  get allWaterLines(): Xy[] {
    return this._get("allWaterLines");
  }

  /**
   * Water line that governs pore pressure at the base of a slice in the
   * given material: the material's own water table when it has one,
   * otherwise the default water table.  Null means no pore pressure.
   */
  getWaterLineForMaterial(material: Material | null): Xy | null {
    const r = wasm().slope_water_line_for_material(this._h, material instanceof Material ? materialWire(material) : null) as { default: boolean; line: Xy | null };
    if (r.default) return this.waterRLXY;
    if (!r.line) return null;
    // the same object for the same line while the slope is unchanged
    return this._memo(`waterLine:${JSON.stringify(r.line)}`, () => r.line);
  }

  get udls(): readonly Udl[] {
    if (this._udls) return this._udls;
    return this._get("udls", (v) => (v as Udl[]).map(asUdl));
  }

  get reinforcements(): readonly Reinforcement[] {
    return this._reinforcements ?? this._get("reinforcements");
  }

  get piles(): readonly Pile[] {
    return this._piles ?? this._get("piles");
  }

  /** Ito & Matsui pressure profiles of the piles (built on first use). */
  get pileProfiles(): readonly (PileProfile | null)[] {
    return this._get("pileProfiles", (v) =>
      (v as ({ z: number[]; F: number[]; Q: number[] } | null)[]).map((p) =>
        p ? { z: Float64Array.from(p.z), F: Float64Array.from(p.F), Q: Float64Array.from(p.Q) } : null,
      ),
    );
  }

  /** Capacity envelopes of the reinforcement (built on first use). */
  get reinforcementEnvelopes(): readonly ReinforcementEnvelope[] {
    return this._get("reinforcementEnvelopes", (v) =>
      (v as (Omit<ReinforcementEnvelope, "s" | "fromEnd1"> & { s: number[]; fromEnd1: number[] })[]).map((e) => ({
        ...e,
        s: Float64Array.from(e.s),
        fromEnd1: Float64Array.from(e.fromEnd1),
      })),
    );
  }

  get lineLoads(): readonly LineLoad[] {
    if (this._lls) return this._lls;
    return this._get("lineLoads", (v) => (v as LineLoad[]).map(asLineLoad));
  }

  get sliceCount(): number {
    return this._get("sliceCount");
  }

  get iterations(): number {
    return this._get("iterations");
  }

  get tolerance(): number {
    return this._get("tolerance");
  }

  get refinedIterations(): number {
    return this._get("refinedIterations");
  }

  get maxIterations(): number {
    return this._get("maxIterations");
  }

  get method(): AnalysisMethod {
    return this._get("method");
  }

  get limits(): Readonly<[number, number, number, number]> {
    return this._get("limits");
  }

  /**
   * The limits the search uses. The upslope end of the exit range, when it
   * is a corner of the ground (the toe), is moved upslope by 1e-5 of the
   * model's width: a circle exactly through the corner only touches it and
   * runs on in the soil, so a range starting at the toe, or being the toe
   * alone (as files from other programs give an exit at the toe), held no
   * circle exiting at it; the ones just above it on the face do. On two
   * public examples: 1.2514 against the file's 1.2535 (1.331 before), and
   * 1.1625 against 1.178 (1.238 before; 1.1773 on the file's own circle).
   * Ranges are in canonical (left-to-right) space; an entry range given as
   * a point on a corner is widened to both sides. Other ends are as given
   * (moving them as well moved the search's start on V005's plane face).
   */
  get searchLimits(): Readonly<[number, number, number, number]> {
    return this._get("searchLimits");
  }

  get minFailureDistance(): number {
    return this._get("minFailureDistance");
  }

  get fixedSlices(): number[] | null {
    return this._get("fixedSlices");
  }

  /**
   * The analysed surfaces, in canonical (left-to-right) space: for a
   * mirrored model (a right-to-left slope) every x is mirrored, x′ = xMin +
   * xMax − x, from the model space in which the definition and its custom
   * surfaces are given. `toModelX` and `toModelCircle` take them back;
   * `analyse` with `mapAnalysisResultToModelSpace` gives whole results in
   * model space.
   */
  get search(): readonly SearchPlane[] {
    return this._get("search", (v) => this._planes(v as PlanesWire, "search"));
  }

  /** The custom surfaces analysed, in canonical space (see `search`). */
  get individualPlanes(): readonly SearchPlane[] {
    return this._get("individualPlanes", (v) => this._planes(v as PlanesWire, "individualPlanes"));
  }

  get customPlanesOnly(): boolean {
    return this._get("customPlanesOnly");
  }

  set customPlanesOnly(value: boolean) {
    wasm().slope_set_custom_planes_only(this._h, value);
  }

  get janbuCorrection(): boolean {
    return this._get("janbuCorrection");
  }

  get porePressureHead(): PorePressureHead {
    return this._get("porePressureHead");
  }

  get tensionCrackDepth(): number {
    return this._get("tensionCrackDepth");
  }

  get tensionCrackWater(): number {
    return this._get("tensionCrackWater");
  }

  /** Limiting base inclination of a tension crack (°; 0: none). */
  get tensionCrackAngle(): number {
    return this._get("tensionCrackAngle");
  }

  /** Whether circles follow the top of impenetrable material (composite surfaces). */
  get compositeSurfaces(): boolean {
    return this._get("compositeSurfaces");
  }

  private _child(which: "earlierStage" | "drawdownBefore"): Slope | null {
    return this._memo(which, () => {
      const h = wasm().slope_child(this._h, which) as number | undefined;
      return h === undefined ? null : Slope._wrap(h);
    });
  }

  /** An earlier stage (SlopeDefinition.earlierStage); null: none. */
  get earlierStage(): Slope | null {
    return this._earlierStage ? this._earlierStage.value : this._child("earlierStage");
  }

  setEarlierStage(s: Slope | null): void {
    wasm().slope_set_earlier_stage(this._h, s ? s._h : undefined);
    this._earlierStage = { value: s };
  }

  /** Pore pressure from head lines and reference lines (model/waternet.ts); null: the water lines. */
  get waternet(): Waternet | null {
    return this._waternet ? this._waternet.value : this._get("waternet");
  }

  setWaternet(wn: Waternet | null): void {
    wasm().slope_set_waternet(this._h, wn);
    this._waternet = { value: wn };
  }

  /**
   * Rapid drawdown: the model with the water before drawdown
   * (model/drawdown.ts); null without a drawdown analysis.
   */
  get drawdownBefore(): Slope | null {
    return this._drawdownBefore ? this._drawdownBefore.value : this._child("drawdownBefore");
  }

  /** Set the model before drawdown (build-slope.ts); it takes this slope's analysis options from now on. */
  setDrawdownBefore(before: Slope | null): void {
    wasm().slope_set_drawdown_before(this._h, before ? before._h : undefined);
    this._drawdownBefore = before ? null : { value: null };
  }

  /** Pseudostatic horizontal seismic coefficient kh (toward the sliding direction). */
  get seismicHorizontal(): number {
    return this._get("seismicHorizontal");
  }

  /** Pseudostatic vertical seismic coefficient kv (positive downward). */
  get seismicVertical(): number {
    return this._get("seismicVertical");
  }

  /** Whether composite circles also follow the bare base of the model. */
  get compositeBase(): boolean {
    return this._get("compositeBase");
  }

  /** The floor composite circles follow (model/composite.ts), for the current geometry. */
  get compositeFloor(): CompositeFloor | null {
    return this._get("compositeFloor");
  }

  get tensionCrackAuto(): boolean {
    return this._get("tensionCrackAuto");
  }

  get partialFactors(): PartialFactors | null {
    return this._get("partialFactors");
  }

  get nonCircularOptimization(): boolean {
    return this._get("nonCircularOptimization");
  }

  get searchMethod(): SearchMethod {
    return this._get("searchMethod");
  }

  get blockActiveAngle(): Readonly<[number, number]> | null {
    return this._get("blockActiveAngle");
  }

  get blockPassiveAngle(): Readonly<[number, number]> | null {
    return this._get("blockPassiveAngle");
  }

  get blockSearchObjects(): readonly (readonly [number, number][])[] {
    return this._get("blockSearchObjects");
  }

  /**
   * Set the block search objects. Each is one point (a fixed point), two
   * (a line) or three or more (a window, a polygon), with finite
   * coordinates; a window needs an area.
   */
  setBlockSearchObjects(objects: readonly (readonly [number, number][])[]): void {
    wasm().slope_set_block_search_objects(this._h, objects);
  }

  /**
   * Smallest sliding mass that is analysed (m², cross-section area per
   * metre): the set value, by default 0 (no limit). `null` from older
   * projects (formerly automatic, 1 % of the squared ground relief) also
   * means 0. The surfaces a set limit leaves out are counted and reported
   * (AnalysisResult.discardedBySize).
   */
  get minSlipArea(): number {
    return this._get("minSlipArea");
  }

  /** Height difference of the ground surface (model height if not set). */
  get groundRelief(): number {
    return this._get("groundRelief");
  }

  /** Cross-section area of the model (inside the external boundary). */
  get modelArea(): number {
    return this._get("modelArea");
  }

  /** Height of the model (extent of the external boundary in y). */
  get modelHeight(): number {
    return this._get("modelHeight");
  }

  get minSlipDepth(): number {
    return this._get("minSlipDepth");
  }

  get intersliceFunction(): IntersliceFunctionType {
    return this._get("intersliceFunction");
  }

  /**
   * Interslice function points in canonical coordinates. The user enters
   * them with x = 0 at the LEFT end of the slip surface in model space,
   * whatever the sliding direction (as is usual), so for a mirrored
   * (right-to-left) model they are mirrored here: x → 1 − x.
   */
  get intersliceDataPoints(): [number, number][] {
    return this._get("intersliceDataPoints");
  }

  /** True when the model was mirrored from a right-to-left model space. */
  get mirrored(): boolean {
    return this._get("mirrored");
  }

  /**
   * An x of the analysis (canonical space: the surfaces in `search`, their
   * slices and points) in model space, where the definition and its custom
   * surfaces are given: unchanged unless the model was mirrored, then
   * mirrored about the middle of the model's extent, as
   * toCanonicalSlopeDefinition mirrored it (the slope must have been built
   * from that canonical definition, as `analyse` does). Mirroring is its own
   * inverse, so the same maps a model-space x into the analysis. For whole
   * results, `analyse` with `mapAnalysisResultToModelSpace` gives model space.
   */
  toModelX(x: number): number {
    return wasm().slope_to_model_x(this._h, x) as number;
  }

  /**
   * A circular surface of the analysis in model space, the form of
   * `customSearchPlanes`: analysing it as a custom surface gives the same
   * surface again. Not for non-circular surfaces (with `points`), whose
   * cx, cy and radius are only their moment axis.
   */
  toModelCircle(plane: Pick<SearchPlane, "cx" | "cy" | "radius"> & { points?: unknown }): { cx: number; cy: number; radius: number } {
    if (plane.points) throw new Error("toModelCircle: a non-circular surface is not a circle");
    return { cx: this.toModelX(plane.cx), cy: plane.cy, radius: plane.radius };
  }

  /**
   * Mark the model as mirrored from model space (a canonical definition of
   * a right-to-left slope, see toCanonicalSlopeDefinition).
   */
  setMirrored(mirrored: boolean): void {
    wasm().slope_set_mirrored(this._h, mirrored);
  }

  get splitFailureCount(): number {
    return this._get("splitFailureCount");
  }

  get splitFailed(): boolean {
    return this._get("splitFailed");
  }

  /**
   * Indices of the material boundaries (as given to setMaterialBoundaries)
   * with an end inside a region, off the outline and every other boundary
   * even after snapping: they do not split that region.
   */
  get danglingBoundaries(): readonly number[] {
    return this._get("danglingBoundaries");
  }

  // ── setters ────────────────────────────────────────────────────

  setSearchResults(planes: SearchPlane[]): void {
    wasm().slope_set_search_results(this._h, this._planesOut(planes));
  }

  setSearchPlanes(planes: SearchPlane[]): void {
    wasm().slope_set_search_planes(this._h, this._planesOut(planes));
  }

  addIndividualPlanes(planes: SearchPlane[]): void {
    wasm().slope_add_individual_planes(this._h, this._planesOut(planes));
  }

  /**
   * Register a material so it is available as the default when
   * `setExternalBoundary` is called.  Must be called *before*
   * `setExternalBoundary` to have effect.
   */
  addMaterial(material: Material): void {
    wasm().slope_add_material(this._h, materialWire(material));
  }

  /**
   * Set the external boundary polygon for the slope model.
   *
   * @param coordinates Array of [x, y] tuples defining the boundary.
   *   Should form a closed polygon with the last point equal to the first.
   */
  setExternalBoundary(coordinates: [number, number][]): void {
    wasm().slope_set_external_boundary(this._h, coordinates);
  }

  /**
   * Replace the material geometry by the slope cut by all boundary
   * polylines at once (see polygonizeRegions); every face starts with the
   * first material and is assigned later by point.
   */
  setMaterialBoundaries(lines: [number, number][][]): void {
    wasm().slope_set_material_boundaries(this._h, lines);
  }

  /** Split by a boundary polyline; returns true when any piece was split. */
  setMaterialBoundary(coordinates: [number, number][]): boolean {
    return wasm().slope_set_material_boundary(this._h, coordinates) as boolean;
  }

  /**
   * Assign a material to the region containing the given coordinate.
   *
   * @param coord The [x, y] coordinate within the target region.
   * @param material The Material instance to assign.
   */
  assignMaterial(coord: [number, number], material: Material): void {
    if (!(material instanceof Material)) {
      throw new Error("assignMaterial only accepts instances of the Material class");
    }
    wasm().slope_assign_material(this._h, coord, materialWire(material));
  }

  /**
   * Set the water table for the model.
   *
   * Supports three modes:
   * - `height`: horizontal water table at a given elevation.
   * - `depth`: water table at a depth below the surface maximum.
   * - `custom`: arbitrary water table profile (array of [x, y]).
   */
  setWaterTable(
    options:
      | { height: number; followBoundary?: boolean }
      | { depth: number; followBoundary?: boolean }
      | { coordinates: [number, number][]; followBoundary?: boolean },
  ): void {
    const mode = "depth" in options ? "depth" : "height" in options ? "height" : "custom";
    wasm().slope_set_water_table(this._h, { ...options, mode });
  }

  /**
   * Add (or replace) an additional water table that materials can be
   * assigned to with `assignMaterialWaterTable`.
   */
  setWaterTableById(id: string, coordinates: [number, number][], followBoundary = true): void {
    wasm().slope_set_water_table_by_id(this._h, id, coordinates, followBoundary);
  }

  /** Make a material use the water table added with the given id. */
  assignMaterialWaterTable(material: Material, id: string): void {
    wasm().slope_assign_material_water_table(this._h, materialWire(material), id);
  }

  /** Remove the water table from the model. */
  removeWaterTable(): void {
    wasm().slope_remove_water_table(this._h);
  }

  /**
   * Set one or more uniformly distributed loads (UDL).
   *
   * @param udls Udl instances to add.
   */
  setUdls(...udls: Udl[]): void {
    const kept = udls.filter((u) => u instanceof Udl);
    wasm().slope_set_udls(this._h, kept);
    if (this._udls) this._udls.push(...kept.filter((u) => u.magnitude > 0));
  }

  /** Remove all UDLs. */
  removeUdls(): void {
    wasm().slope_remove_udls(this._h);
    this._udls = [];
  }

  /**
   * Set one or more line loads.
   *
   * @param lineLoads LineLoad instances.
   */
  setLineLoads(...lineLoads: LineLoad[]): void {
    const kept = lineLoads.filter((l) => l instanceof LineLoad);
    wasm().slope_set_line_loads(this._h, kept);
    this._lls = kept.filter((l) => l.magnitude > 0);
  }

  /**
   * Set the reinforcement (anchors, tiebacks, nails, geosynthetics).
   */
  setReinforcements(reinforcements: readonly Reinforcement[]): void {
    wasm().slope_set_reinforcements(this._h, reinforcements);
    this._reinforcements = [...reinforcements];
  }

  /** Set the pile rows and sheet pile walls. */
  setPiles(piles: readonly Pile[]): void {
    wasm().slope_set_piles(this._h, piles);
    this._piles = [...piles];
  }

  /** Remove all line loads. */
  removeLineLoads(): void {
    wasm().slope_remove_line_loads(this._h);
    this._lls = [];
  }

  /**
   * Update analysis options.
   *
   * @param opts Partial analysis options to update.
   */
  updateAnalysisOptions(opts: Partial<AnalysisOptions> = {}): void {
    wasm().slope_update_analysis_options(this._h, opts);
  }

  /**
   * Set analysis limits for the search area.
   */
  setAnalysisLimits(limits: Partial<AnalysisLimits>): void {
    wasm().slope_set_analysis_limits(this._h, limits);
  }

  /** Reset analysis limits to search the entire slope. */
  removeAnalysisLimits(): void {
    wasm().slope_remove_analysis_limits(this._h);
  }

  /**
   * Specify fixed x-coordinates for slice boundaries.
   */
  addFixedSlices(x: number[]): void {
    wasm().slope_add_fixed_slices(this._h, x);
  }

  /** Clear all manually added individual failure surfaces. */
  removeIndividualPlanes(): void {
    wasm().slope_remove_individual_planes(this._h);
  }

  // ── queries ────────────────────────────────────────────────────

  /**
   * Get the y-coordinate of the slope surface at a given x.
   */
  getExternalYIntersection(x: number): number {
    return wasm().slope_get_external_y_intersection(this._h, x) as number;
  }

  /**
   * Check whether a point lies inside the external boundary polygon.
   */
  isInsideExternalBoundary(x: number, y: number): boolean {
    return wasm().slope_is_inside_external_boundary(this._h, x, y) as boolean;
  }

  /**
   * Get the y-coordinate of the water table at a given x.
   */
  getWaterYIntersection(x: number): number {
    return wasm().slope_get_water_y_intersection(this._h, x) as number;
  }

  /**
   * Get intersection points of a circle with the external boundary surface.
   * Returns sorted by x-coordinate.
   */
  getCircleExternalIntersection(cx: number, cy: number, radius: number): [number, number][] {
    return wasm().slope_get_circle_external_intersection(this._h, cx, cy, radius) as Pt[];
  }

  /**
   * Get the minimum factor of safety from the analysis results.
   */
  getMinFOS(): number {
    return wasm().slope_get_min_fos(this._h) as number;
  }

  /**
   * Get the maximum factor of safety from the analysis results.
   */
  getMaxFOS(): number {
    return wasm().slope_get_max_fos(this._h) as number;
  }

  /**
   * Get the critical failure surface circle properties.
   */
  getMinFOSCircle(): { cx: number; cy: number; radius: number } {
    return wasm().slope_get_min_fos_circle(this._h) as { cx: number; cy: number; radius: number };
  }

  /**
   * Get the entry and exit points of the critical failure surface.
   */
  getMinFOSEndPoints(): { entry: [number, number]; exit: [number, number] } {
    return wasm().slope_get_min_fos_end_points(this._h) as { entry: Pt; exit: Pt };
  }

  /** Material models were changed in place: the engine takes the current models. */
  materialsChanged(): void {
    this._fresh();
    const table = (this._table ??= wasm().slope_get(this._h, "materials") as MaterialEntry[]);
    const known = table.flatMap((e) => {
      const m = e.key === null ? undefined : materialByKey(e.key);
      return m ? [materialWire(m)] : [];
    });
    wasm().slope_materials_changed(this._h, known);
  }

  toString(): string {
    return "Slope";
  }
}
