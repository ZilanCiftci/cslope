/**
 * Core Slope model for slope stability analysis.
 */

import type {
  AnalysisLimits,
  IntersliceFunctionType,
  PorePressureHead,
  SearchMethod,
  PartialFactors,
  AnalysisMethod,
  AnalysisOptions,
  GeometryWithMaterial,
  Slice,
} from "../types/index";
import {
  DEFAULT_ANALYSIS_OPTIONS,
  Material,
  Udl,
  LineLoad,
} from "../types/index";
import {
  SLICES_RANGE,
  ITERATIONS_RANGE,
  REFINED_ITERATIONS_RANGE,
} from "../types/constants";
import {
  getYAtX,
  getCircleLineIntersections,
  isPointInPolygon,
} from "../math/index";
import {
  getSurfaceLine,
  splitPolygonByPolylineDetailed,
  polygonizeRegionsDetailed,
  keyholeRing,
  clipLineToSurface,
  createGeometryWithMaterial,
} from "./geometry-ops";
import { getDomainX, mirrorX } from "./canonical";
import { compositeFloor, type CompositeFloor } from "./composite";
import type { Waternet } from "./waternet";
import type { Pile, Reinforcement } from "../types/reinforcement";
import { buildEnvelope, buildPileProfile, type PileProfile, type ReinforcementEnvelope } from "./reinforcement";

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
}

/** A water line as given, with its clipping rule. */
interface WaterLineInput {
  wx: number[];
  wy: number[];
  followBoundary: boolean;
}

/**
 * A water line needs two finite points (it is then continued
 * horizontally beyond its ends; two points at one x make a vertical
 * step). With fewer, slices in a material assigned to it would silently
 * get no pore pressure; commercial programs likewise give no FOS where a water
 * table does not span the slip surface.
 */
function checkWaterLine(coordinates: [number, number][]): void {
  const finite = coordinates.filter(
    (c) => Array.isArray(c) && Number.isFinite(c[0]) && Number.isFinite(c[1]),
  );
  if (finite.length !== coordinates.length) {
    throw new Error("Water table points must be finite numbers.");
  }
  const xs = finite.map((c) => c[0]);
  // Two points at one x (a vertical step) are a valid line: it is
  // extended horizontally to the model edges from both ends.
  void xs;
  if (finite.length < 2) {
    throw new Error("A water table needs at least two points.");
  }
}

/** Smallest useful inner iteration limit for the FOS solvers. */
const MIN_MAX_ITERATIONS = 6;
/** Default smallest sliding mass, as a fraction of the model area. */
const AUTO_MIN_SLIP_AREA = 1e-2;

// ── Slope Class ───────────────────────────────────────────────────

export class Slope {
  // ── Material / geometry state ─────────────────────────────────
  private _materials: Material[] = [];
  private _materialGeometries: GeometryWithMaterial[] = [];
  private _externalBoundaryPx: number[] = [];
  private _externalBoundaryPy: number[] = [];
  private _externalLength = 0;

  // ── Surface line (numpy-equivalent arrays) ────────────────────
  private _surfaceLineX: number[] | null = null;
  private _surfaceLineY: number[] | null = null;

  // ── Water table ───────────────────────────────────────────────
  private _waterRL: boolean = false;
  private _waterRLXY: { x: number[]; y: number[] } | null = null;
  /**
   * Additional water tables by id.  Materials assigned to one of these use
   * it for pore pressure instead of the default water table.
   */
  private _extraWaterLines = new Map<
    string,
    { x: number[]; y: number[] } | null
  >();
  private _materialWaterTable = new Map<Material, string>();
  /**
   * Water lines as given (before extension to the model edges and
   * clipping), so that they are built again for a new external boundary:
   * a line must always span the whole model, or slices beyond its ends
   * would silently get no pore pressure.
   */
  private _waterInput: WaterLineInput | null = null;
  private _extraWaterInputs = new Map<string, WaterLineInput>();

  // ── Loads ─────────────────────────────────────────────────────
  private _udls: Udl[] = [];
  private _lls: LineLoad[] = [];
  private _reinforcements: Reinforcement[] = [];
  private _reinforcementEnvelopes: ReinforcementEnvelope[] | null = null;
  private _piles: Pile[] = [];
  private _pileProfiles: (PileProfile | null)[] | null = null;

  // ── Analysis options ──────────────────────────────────────────
  private _slices: number;
  private _iterations: number;
  private _refinedIterations: number;
  private _minFailureDistance: number;
  private _tolerance: number;
  private _maxIterations: number;
  private _method: AnalysisMethod;
  private _janbuCorrection: boolean;
  private _intersliceFunction: IntersliceFunctionType;
  private _porePressureHead: PorePressureHead;
  private _tensionCrackDepth: number;
  private _tensionCrackWater: number;
  private _tensionCrackAuto: boolean;
  private _tensionCrackAngle: number;
  private _compositeSurfaces = true;
  private _compositeBase = false;
  private _drawdownBefore: Slope | null = null;
  private _waternet: Waternet | null = null;
  private _earlierStage: Slope | null = null;
  /** The analysis options given so far (for the model before drawdown). */
  private _optionsGiven: Partial<AnalysisOptions> = {};
  private _seismicHorizontal = 0;
  private _seismicVertical = 0;
  private _compositeFloorCache: { geometries: readonly GeometryWithMaterial[]; base: boolean; floor: CompositeFloor | null } | null = null;
  private _partialFactors: PartialFactors | null = null;
  private _nonCircularOptimization = false;
  private _searchMethod: SearchMethod = "circular";
  private _blockActiveAngle: [number, number] | null = null;
  private _blockPassiveAngle: [number, number] | null = null;
  /** Block search objects: one point, a line (two) or a window (three or more). */
  private _blockSearchObjects: [number, number][][] = [];
  private _minSlipDepth = 0;
  /** Null: automatic (see minSlipArea). */
  private _minSlipArea: number | null = null;
  private _intersliceDataPoints: [number, number][];
  /**
   * The model was mirrored into canonical (left-to-right) coordinates, so
   * model-space analysis options such as the interslice data points must be
   * mirrored as well.
   */
  private _mirrored = false;
  /** The model's x extent, [xMin, xMax], from the external boundary (toModelX). */
  private _domainX: [number, number] | null = null;

  // ── Analysis limits ───────────────────────────────────────────
  private _limits: [number, number, number, number] = [0, 0, 0, 0];

  // ── Search planes ─────────────────────────────────────────────
  private _search: SearchPlane[] = [];
  private _individualPlanes: SearchPlane[] = [];
  private _customPlanesOnly = false;
  private _fixedSlices: number[] | null = null;
  private _splitFailureCount = 0;
  private _danglingBoundaries: number[] = [];

  // ── Cache for y-intersections ─────────────────────────────────
  private _externalYCache = new Map<number, number>();
  private _waterYCache = new Map<number, number>();

  constructor() {
    const d = DEFAULT_ANALYSIS_OPTIONS;
    this._slices = d.slices;
    this._iterations = d.iterations;
    this._refinedIterations = d.refinedIterations;
    this._minFailureDistance = d.minFailureDist;
    this._tolerance = d.tolerance;
    this._maxIterations = d.maxIterations;
    this._method = d.method;
    this._janbuCorrection = d.janbuCorrection ?? false;
    this._intersliceFunction = d.intersliceFunction ?? "half-sine";
    this._intersliceDataPoints = [...(d.intersliceDataPoints ?? [])];
    this._porePressureHead = d.porePressureHead ?? "vertical";
    this._tensionCrackDepth = d.tensionCrackDepth ?? 0;
    this._tensionCrackWater = d.tensionCrackWater ?? 0;
    this._tensionCrackAuto = d.tensionCrackAuto ?? false;
    this._tensionCrackAngle = d.tensionCrackAngle ?? 0;
    this._compositeSurfaces = d.compositeSurfaces ?? true;
    this._compositeBase = d.compositeBase ?? false;
    this._seismicHorizontal = d.seismicHorizontal ?? 0;
    this._seismicVertical = d.seismicVertical ?? 0;
  }

  // ────────────────────────────────────────────────────────────────
  // Public getters (read-only access to internal state)
  // ────────────────────────────────────────────────────────────────

  get materialGeometries(): readonly GeometryWithMaterial[] {
    return this._materialGeometries;
  }

  get surfaceLineXY(): { x: number[]; y: number[] } | null {
    if (!this._surfaceLineX || !this._surfaceLineY) return null;
    return { x: this._surfaceLineX, y: this._surfaceLineY };
  }

  /** Vertices of the external boundary polygon. */
  get externalBoundaryXY(): { x: readonly number[]; y: readonly number[] } {
    return { x: this._externalBoundaryPx, y: this._externalBoundaryPy };
  }

  get waterRLXY(): { x: number[]; y: number[] } | null {
    return this._waterRLXY;
  }

  get hasWaterTable(): boolean {
    return this._waterRL;
  }

  /** True when at least one material uses its own water table. */
  get hasMaterialWaterTables(): boolean {
    return this._materialWaterTable.size > 0;
  }

  /**
   * Water lines that can govern pore pressure (the default line and any
   * line assigned to a material), used as slice break points.
   */
  get allWaterLines(): { x: number[]; y: number[] }[] {
    const lines: { x: number[]; y: number[] }[] = [];
    if (this._waterRL && this._waterRLXY) lines.push(this._waterRLXY);
    for (const id of new Set(this._materialWaterTable.values())) {
      const line = this._extraWaterLines.get(id);
      if (line) lines.push(line);
    }
    return lines;
  }

  /**
   * Water line that governs pore pressure at the base of a slice in the
   * given material: the material's own water table when it has one,
   * otherwise the default water table.  Null means no pore pressure.
   */
  getWaterLineForMaterial(
    material: Material | null,
  ): { x: number[]; y: number[] } | null {
    const id = material ? this._materialWaterTable.get(material) : undefined;
    if (id !== undefined && this._extraWaterLines.has(id)) {
      return this._extraWaterLines.get(id) ?? null;
    }
    return this._waterRL ? this._waterRLXY : null;
  }

  get udls(): readonly Udl[] {
    return this._udls;
  }

  get reinforcements(): readonly Reinforcement[] {
    return this._reinforcements;
  }

  get piles(): readonly Pile[] {
    return this._piles;
  }

  /** Ito & Matsui pressure profiles of the piles (built on first use). */
  get pileProfiles(): readonly (PileProfile | null)[] {
    this._pileProfiles ??= this._piles.map((p) => buildPileProfile(this, p));
    return this._pileProfiles;
  }

  /** Capacity envelopes of the reinforcement (built on first use). */
  get reinforcementEnvelopes(): readonly ReinforcementEnvelope[] {
    this._reinforcementEnvelopes ??= this._reinforcements.map((r) => buildEnvelope(this, r));
    return this._reinforcementEnvelopes;
  }

  get lineLoads(): readonly LineLoad[] {
    return this._lls;
  }

  get sliceCount(): number {
    return this._slices;
  }

  get iterations(): number {
    return this._iterations;
  }

  get tolerance(): number {
    return this._tolerance;
  }

  get refinedIterations(): number {
    return this._refinedIterations;
  }

  get maxIterations(): number {
    return this._maxIterations;
  }

  get method(): AnalysisMethod {
    return this._method;
  }

  get limits(): Readonly<[number, number, number, number]> {
    return this._limits;
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
    const [entryLeftX, entryRightX, exitLeftX, exitRightX] = this._limits;
    const xs = this._surfaceLineX;
    if (!xs || xs.length < 2) return this._limits;
    const x0 = Math.min(...xs), x1 = Math.max(...xs);
    const w = 1e-5 * (x1 - x0);
    const tol = 1e-9 * (x1 - x0);
    const atCorner = (x: number) => x > x0 && x < x1 && xs.some((v) => Math.abs(v - x) <= tol);
    const entryPoint = entryRightX - entryLeftX <= tol && atCorner(entryLeftX);
    return [
      entryPoint ? Math.max(x0, entryLeftX - w) : entryLeftX,
      entryPoint ? Math.min(x1, entryRightX + w) : entryRightX,
      atCorner(exitLeftX) ? Math.max(x0, exitLeftX - w) : exitLeftX,
      exitRightX,
    ];
  }

  get minFailureDistance(): number {
    return this._minFailureDistance;
  }

  get fixedSlices(): number[] | null {
    return this._fixedSlices;
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
    return this._search;
  }

  /** The custom surfaces analysed, in canonical space (see `search`). */
  get individualPlanes(): readonly SearchPlane[] {
    return this._individualPlanes;
  }

  get customPlanesOnly(): boolean {
    return this._customPlanesOnly;
  }

  set customPlanesOnly(value: boolean) {
    this._customPlanesOnly = value;
  }

  get janbuCorrection(): boolean {
    return this._janbuCorrection;
  }

  get porePressureHead(): PorePressureHead {
    return this._porePressureHead;
  }

  get tensionCrackDepth(): number {
    return this._tensionCrackDepth;
  }

  get tensionCrackWater(): number {
    return this._tensionCrackWater;
  }

  /** Limiting base inclination of a tension crack (°; 0: none). */
  get tensionCrackAngle(): number {
    return this._tensionCrackAngle;
  }

  /** Whether circles follow the top of impenetrable material (composite surfaces). */
  get compositeSurfaces(): boolean {
    return this._compositeSurfaces;
  }

  /** An earlier stage (SlopeDefinition.earlierStage); null: none. */
  get earlierStage(): Slope | null {
    return this._earlierStage;
  }

  setEarlierStage(s: Slope | null): void {
    this._earlierStage = s;
    this._resetResults?.();
  }

  /** Pore pressure from head lines and reference lines (model/waternet.ts); null: the water lines. */
  get waternet(): Waternet | null {
    return this._waternet;
  }

  setWaternet(wn: Waternet | null): void {
    this._waternet = wn;
    this._resetResults?.();
  }

  /**
   * Rapid drawdown: the model with the water before drawdown
   * (model/drawdown.ts); null without a drawdown analysis.
   */
  get drawdownBefore(): Slope | null {
    return this._drawdownBefore;
  }

  /** Set the model before drawdown (build-slope.ts); it takes this slope's analysis options from now on. */
  setDrawdownBefore(before: Slope | null): void {
    this._drawdownBefore = before;
    if (before) before.updateAnalysisOptions({ ...this._optionsGiven, seismicHorizontal: 0, seismicVertical: 0 });
  }

  /** Pseudostatic horizontal seismic coefficient kh (toward the sliding direction). */
  get seismicHorizontal(): number {
    return this._seismicHorizontal;
  }

  /** Pseudostatic vertical seismic coefficient kv (positive downward). */
  get seismicVertical(): number {
    return this._seismicVertical;
  }

  /** Whether composite circles also follow the bare base of the model. */
  get compositeBase(): boolean {
    return this._compositeBase;
  }

  /** The floor composite circles follow (model/composite.ts), for the current geometry. */
  get compositeFloor(): CompositeFloor | null {
    const geometries = this._materialGeometries;
    if (this._compositeFloorCache?.geometries !== geometries || this._compositeFloorCache.base !== this._compositeBase) {
      this._compositeFloorCache = {
        geometries,
        base: this._compositeBase,
        floor: compositeFloor(this.externalBoundaryXY, geometries, this._compositeBase),
      };
    }
    return this._compositeFloorCache.floor;
  }

  get tensionCrackAuto(): boolean {
    return this._tensionCrackAuto;
  }

  get partialFactors(): PartialFactors | null {
    return this._partialFactors;
  }

  get nonCircularOptimization(): boolean {
    return this._nonCircularOptimization;
  }

  get searchMethod(): SearchMethod {
    return this._searchMethod;
  }

  get blockActiveAngle(): Readonly<[number, number]> | null {
    return this._blockActiveAngle;
  }

  get blockPassiveAngle(): Readonly<[number, number]> | null {
    return this._blockPassiveAngle;
  }

  get blockSearchObjects(): readonly (readonly [number, number][])[] {
    return this._blockSearchObjects;
  }

  /**
   * Set the block search objects. Each is one point (a fixed point), two
   * (a line) or three or more (a window, a polygon), with finite
   * coordinates; a window needs an area.
   */
  setBlockSearchObjects(objects: readonly (readonly [number, number][])[]): void {
    const checked = objects.map((points, i) => {
      if (points.length === 0 || !points.every((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]))) {
        throw new Error(`Block search object ${i + 1} needs at least one point with finite coordinates.`);
      }
      if (points.length === 2 && points[0][0] === points[1][0] && points[0][1] === points[1][1]) {
        throw new Error(`Block search object ${i + 1}: the two ends of the line coincide.`);
      }
      if (points.length >= 3) {
        let area = 0;
        for (let k = 0, j = points.length - 1; k < points.length; j = k++) {
          area += points[j][0] * points[k][1] - points[k][0] * points[j][1];
        }
        if (!(Math.abs(area) > 1e-12)) throw new Error(`Block search object ${i + 1}: the window has no area.`);
      }
      return points.map(([x, y]) => [x, y] as [number, number]);
    });
    this._blockSearchObjects = checked;
    this._resetResults();
  }

  /**
   * Smallest sliding mass that is analysed (m²): the set value, or by
   * default 1 % of the squared ground relief (1 m² for a 10 m slope).
   * Scaled by the relief rather than the model area so that deep models
   * do not filter out the shallow surfaces that govern in friction soil.
   *
   * The automatic default has no basis in the literature: it is a
   * practical filter against micro-surfaces, whose FOS in cohesive soil
   * grows without bound, and it can hide a real local failure (a low cut
   * at the toe of a high slope). It is kept because changing it moves
   * verified results; instead the surfaces it leaves out are counted and
   * reported (AnalysisResult.discardedBySize), and it can be set to 0.
   */
  get minSlipArea(): number {
    return this._minSlipArea ?? AUTO_MIN_SLIP_AREA * this.groundRelief ** 2;
  }

  /** Height difference of the ground surface (model height if not set). */
  get groundRelief(): number {
    const ys = this._surfaceLineY;
    return ys?.length ? Math.max(...ys) - Math.min(...ys) : this.modelHeight;
  }

  /** Cross-section area of the model (inside the external boundary). */
  get modelArea(): number {
    const px = this._externalBoundaryPx;
    const py = this._externalBoundaryPy;
    let a = 0;
    for (let i = 0; i < px.length; i++) {
      const j = (i + 1) % px.length;
      a += px[i] * py[j] - px[j] * py[i];
    }
    return Math.abs(a) / 2;
  }

  /** Height of the model (extent of the external boundary in y). */
  get modelHeight(): number {
    const ys = this._externalBoundaryPy;
    return ys.length ? Math.max(...ys) - Math.min(...ys) : 0;
  }

  get minSlipDepth(): number {
    return this._minSlipDepth;
  }

  get intersliceFunction(): IntersliceFunctionType {
    return this._intersliceFunction;
  }

  /**
   * Interslice function points in canonical coordinates. The user enters
   * them with x = 0 at the LEFT end of the slip surface in model space,
   * whatever the sliding direction (as is usual), so for a mirrored
   * (right-to-left) model they are mirrored here: x → 1 − x.
   */
  get intersliceDataPoints(): [number, number][] {
    if (!this._mirrored) return this._intersliceDataPoints;
    return this._intersliceDataPoints
      .map(([x, f]) => [1 - x, f] as [number, number])
      .reverse();
  }

  /** True when the model was mirrored from a right-to-left model space. */
  get mirrored(): boolean {
    return this._mirrored;
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
    if (!this._mirrored) return x;
    if (!this._domainX) throw new Error("toModelX: the slope has no external boundary");
    return mirrorX(x, this._domainX[0], this._domainX[1]);
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
    this._mirrored = mirrored;
    this._resetResults();
  }

  get splitFailureCount(): number {
    return this._splitFailureCount;
  }

  get splitFailed(): boolean {
    return this._splitFailureCount > 0;
  }

  /**
   * Indices of the material boundaries (as given to setMaterialBoundaries)
   * with an end inside a region, off the outline and every other boundary
   * even after snapping: they do not split that region.
   */
  get danglingBoundaries(): readonly number[] {
    return this._danglingBoundaries;
  }

  // ────────────────────────────────────────────────────────────────
  // Mutable setters for the solver (used by search/solver code)
  // ────────────────────────────────────────────────────────────────

  setSearchResults(planes: SearchPlane[]): void {
    this._search = planes;
  }

  setSearchPlanes(planes: SearchPlane[]): void {
    this._search = planes;
  }

  addIndividualPlanes(planes: SearchPlane[]): void {
    this._individualPlanes.push(...planes);
    this._resetResults();
  }

  // ────────────────────────────────────────────────────────────────
  // Model setup methods
  // ────────────────────────────────────────────────────────────────

  /**
   * Register a material so it is available as the default when
   * `setExternalBoundary` is called.  Must be called *before*
   * `setExternalBoundary` to have effect.
   */
  addMaterial(material: Material): void {
    if (!this._materials.includes(material)) {
      this._materials.push(material);
    }
  }

  /**
   * Set the external boundary polygon for the slope model.
   *
   * @param coordinates Array of [x, y] tuples defining the boundary.
   *   Should form a closed polygon with the last point equal to the first.
   */
  setExternalBoundary(coordinates: [number, number][]): void {
    if (!coordinates || coordinates.length < 3) {
      throw new Error("Coordinates must have at least 3 points");
    }

    const px = coordinates.map((c) => c[0]);
    const py = coordinates.map((c) => c[1]);

    // Ensure closed
    if (
      Math.abs(px[0] - px[px.length - 1]) > 1e-12 ||
      Math.abs(py[0] - py[py.length - 1]) > 1e-12
    ) {
      px.push(px[0]);
      py.push(py[0]);
    }

    this._externalBoundaryPx = px;
    this._externalBoundaryPy = py;
    // the extent canonical.ts mirrors about (toModelX)
    this._domainX = getDomainX(coordinates);

    // Create initial material geometry with first material (or undefined)
    const material =
      this._materials.length > 0 ? this._materials[0] : new Material();
    this._materialGeometries = [createGeometryWithMaterial(px, py, material)];

    // Extract surface line
    const surface = getSurfaceLine(px, py);
    this._surfaceLineX = surface.x;
    this._surfaceLineY = surface.y;

    // Compute external length
    const surfXMin = Math.min(...surface.x);
    const surfXMax = Math.max(...surface.x);
    this._externalLength = surfXMax - surfXMin;

    // Water lines given before the boundary are extended to its edges now.
    if (this._waterInput) {
      const { wx, wy, followBoundary } = this._waterInput;
      this._waterRLXY = this._buildWaterLine(wx, wy, followBoundary);
      this._waterRL = this._waterRLXY !== null;
      this._waterYCache.clear();
    }
    for (const [id, { wx, wy, followBoundary }] of this._extraWaterInputs) {
      this._extraWaterLines.set(id, this._buildWaterLine(wx, wy, followBoundary));
    }

    // Update min failure distance
    this.updateAnalysisOptions({ minFailureDist: 0 });

    // Reset limits to search entire slope
    this.removeAnalysisLimits();

    // Reset results
    this._splitFailureCount = 0;
    this._danglingBoundaries = [];
    this._resetResults();
  }

  /**
   * Set a material boundary line that splits existing material geometries.
   *
   * @param coordinates Array of [x, y] tuples defining the boundary line.
   */
  /**
   * Replace the material geometry by the slope cut by all boundary
   * polylines at once (see polygonizeRegions); every face starts with the
   * first material and is assigned later by point.
   */
  setMaterialBoundaries(lines: [number, number][][]): void {
    if (this._materialGeometries.length === 0) {
      throw new Error("External boundary must be set before boundaries");
    }
    const material = this._materialGeometries[0].material;
    const { faces, failed, danglingBoundaries } = polygonizeRegionsDetailed(
      this._externalBoundaryPx,
      this._externalBoundaryPy,
      lines,
    );
    // An unsplit slope would be analysed as the first material throughout:
    // a wrong result, not a degraded one.
    if (failed) {
      this._splitFailureCount += 1;
      throw new Error(
        "The material boundaries could not be split into regions. Check boundaries that touch or nearly touch the outline or each other.",
      );
    }
    this._danglingBoundaries = danglingBoundaries;
    this._materialGeometries = faces.map((face) => {
      const ring = keyholeRing(face.outer, face.holes);
      return createGeometryWithMaterial(
        ring.map((c) => c[0]),
        ring.map((c) => c[1]),
        material,
      );
    });
    this._resetResults(); // σ′v, pile pressures and results depend on the materials
  }

  /** Split by a boundary polyline; returns true when any piece was split. */
  setMaterialBoundary(coordinates: [number, number][]): boolean {
    if (!coordinates || coordinates.length < 2) {
      throw new Error("Material boundary needs at least 2 coordinate points");
    }

    const lx = coordinates.map((c) => c[0]);
    const ly = coordinates.map((c) => c[1]);

    const newGeometries: GeometryWithMaterial[] = [];
    let changed = false;
    for (const mg of this._materialGeometries) {
      const split = splitPolygonByPolylineDetailed(mg.px, mg.py, lx, ly);
      if (split.splitFailed) this._splitFailureCount += 1;
      const pieces = split.pieces;
      if (pieces.length > 1) changed = true;
      for (const piece of pieces) {
        newGeometries.push(
          createGeometryWithMaterial(piece.px, piece.py, mg.material),
        );
      }
    }
    this._materialGeometries = newGeometries;
    this._resetResults(); // σ′v, pile pressures and results depend on the materials
    return changed;
  }

  /**
   * Assign a material to the region containing the given coordinate.
   *
   * @param coord The [x, y] coordinate within the target region.
   * @param material The Material instance to assign.
   */
  assignMaterial(coord: [number, number], material: Material): void {
    if (!(material instanceof Material)) {
      throw new Error(
        "assignMaterial only accepts instances of the Material class",
      );
    }

    if (!this._materials.includes(material)) {
      this._materials.push(material);
    }

    for (const mg of this._materialGeometries) {
      if (isPointInPolygon(coord[0], coord[1], mg.px, mg.py)) {
        mg.material = material;
        this._resetResults(); // σ′v, pile pressures and results depend on the materials
        return;
      }
    }
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
    const followBoundary =
      "followBoundary" in options ? (options.followBoundary ?? true) : true;

    let waterHeight: number | undefined;
    let waterCoords: [number, number][] | undefined;

    if ("depth" in options) {
      if (this._externalBoundaryPy.length === 0) {
        throw new Error(
          "External boundary must be set before using depth parameter",
        );
      }
      const maxY = Math.max(...this._externalBoundaryPy);
      waterHeight = maxY - options.depth;
    } else if ("height" in options) {
      waterHeight = options.height;
    } else if ("coordinates" in options) {
      waterCoords = options.coordinates;
    }

    let wx: number[] | undefined;
    let wy: number[] | undefined;
    if (waterHeight !== undefined) {
      if (this._externalBoundaryPx.length === 0) {
        throw new Error(
          "External boundary must be set before setting water table",
        );
      }
      const minX = Math.min(...this._externalBoundaryPx);
      const maxX = Math.max(...this._externalBoundaryPx);
      wx = [minX, maxX];
      wy = [waterHeight, waterHeight];
    } else if (waterCoords) {
      checkWaterLine(waterCoords);
      wx = waterCoords.map((c) => c[0]);
      wy = waterCoords.map((c) => c[1]);
    }

    // Built first: a line that cannot be built leaves no input behind.
    const line = wx && wy ? this._buildWaterLine(wx, wy, followBoundary) : null;
    this._waterInput = wx && wy ? { wx, wy, followBoundary } : null;
    this._waterRLXY = line;
    this._waterRL = this._waterRLXY !== null;

    this._waterYCache.clear();
    this._resetResults();
  }

  /**
   * Add (or replace) an additional water table that materials can be
   * assigned to with `assignMaterialWaterTable`.
   */
  setWaterTableById(
    id: string,
    coordinates: [number, number][],
    followBoundary = true,
  ): void {
    checkWaterLine(coordinates);
    const wx = coordinates.map((c) => c[0]);
    const wy = coordinates.map((c) => c[1]);
    const line = this._buildWaterLine(wx, wy, followBoundary);
    this._extraWaterInputs.set(id, { wx, wy, followBoundary });
    this._extraWaterLines.set(id, line);
    this._resetResults();
  }

  /** Make a material use the water table added with the given id. */
  assignMaterialWaterTable(material: Material, id: string): void {
    this._materialWaterTable.set(material, id);
    this._resetResults();
  }

  /**
   * Water line used for pore pressure.  With `followBoundary` it never
   * rises above the ground surface (no ponding).
   */
  private _buildWaterLine(
    wx: number[],
    wy: number[],
    followBoundary: boolean,
  ): { x: number[]; y: number[] } | null {
    if (wx.length < 2) return null;
    // A line entered right to left (e.g. mirrored for a right-to-left
    // model) is reversed first: the sort below is stable, so the points of
    // a vertical step keep their order along the line.
    if (wx[0] > wx[wx.length - 1]) {
      wx = [...wx].reverse();
      wy = [...wy].reverse();
    }
    // Beyond its end points a piezometric line continues horizontally to
    // the model edges (as is common practice); previously slices past
    // the ends of a short line got no pore pressure at all.
    if (this._externalBoundaryPx.length >= 3) {
      const order = wx.map((_, i) => i).sort((a, b) => wx[a] - wx[b]);
      const xs = order.map((i) => wx[i]);
      const ys = order.map((i) => wy[i]);
      const xMin = Math.min(...this._externalBoundaryPx);
      const xMax = Math.max(...this._externalBoundaryPx);
      if (xs[0] > xMin) {
        xs.unshift(xMin);
        ys.unshift(ys[0]);
      }
      if (xs[xs.length - 1] < xMax) {
        xs.push(xMax);
        ys.push(ys[ys.length - 1]);
      }
      wx = xs;
      wy = ys;
    }
    if (!followBoundary) return { x: wx, y: wy };
    if (!this._surfaceLineX || !this._surfaceLineY) {
      throw new Error(
        "External boundary must be set before setting water table",
      );
    }
    return clipLineToSurface(wx, wy, this._surfaceLineX, this._surfaceLineY);
  }

  /** Remove the water table from the model. */
  removeWaterTable(): void {
    this._waterRL = false;
    this._waterRLXY = null;
    this._waterInput = null;
    this._extraWaterInputs.clear();
    this._extraWaterLines.clear();
    this._materialWaterTable.clear();
    this._waterYCache.clear();
    this._resetResults();
  }

  /**
   * Set one or more uniformly distributed loads (UDL).
   *
   * @param udls Udl instances to add.
   */
  setUdls(...udls: Udl[]): void {
    for (const udl of udls) {
      if (udl instanceof Udl && udl.magnitude > 0) {
        this._udls.push(udl);
      }
    }
    this._resetResults();
  }

  /** Remove all UDLs. */
  removeUdls(): void {
    this._udls = [];
    this._resetResults();
  }

  /**
   * Set one or more line loads.
   *
   * @param lineLoads LineLoad instances.
   */
  setLineLoads(...lineLoads: LineLoad[]): void {
    this._lls = [];
    for (const ll of lineLoads) {
      if (ll instanceof LineLoad && ll.magnitude > 0) {
        this._lls.push(ll);
      }
    }
    this._resetResults();
  }

  /**
   * Set the reinforcement (anchors, tiebacks, nails, geosynthetics).
   */
  setReinforcements(reinforcements: readonly Reinforcement[]): void {
    for (const r of reinforcements) {
      const nums = [r.x1, r.y1, r.x2, r.y2, r.tensileCapacity];
      if (!nums.every(Number.isFinite)) {
        throw new Error("Reinforcement needs finite end points and tensile capacity.");
      }
      const bad = (v: number | undefined) => v !== undefined && !(Number.isFinite(v) && v >= 0);
      if (r.tensileCapacity < 0 || bad(r.end1Capacity) || bad(r.end2Capacity)) {
        throw new Error("Reinforcement capacities must be ≥ 0.");
      }
      if (r.spacing !== undefined && !(Number.isFinite(r.spacing) && r.spacing > 0)) {
        throw new Error("Reinforcement spacing must be > 0.");
      }
      const p = r.pullout;
      if (p?.kind === "bond" && (!(Number.isFinite(p.strength) && p.strength >= 0) || bad(p.bondedLength))) {
        throw new Error("Reinforcement bond strength and bonded length must be ≥ 0.");
      }
      if (p?.kind === "development" && (bad(p.length1) || bad(p.length2) || p.length1 === undefined || p.length2 === undefined)) {
        throw new Error("Reinforcement development lengths must be ≥ 0.");
      }
      if (
        p?.kind === "interface" &&
        (!(Number.isFinite(p.adhesion) && p.adhesion >= 0 && Number.isFinite(p.frictionAngle) && p.frictionAngle >= 0 && p.frictionAngle < 90) ||
          (p.coverage !== undefined && !(Number.isFinite(p.coverage) && p.coverage > 0)))
      ) {
        throw new Error("Reinforcement adhesion must be ≥ 0, interface friction angle 0–90° and coverage > 0.");
      }
    }
    // All kept (zero length or capacity carries nothing), so that a force's
    // index is the element's position in the input.
    this._reinforcements = [...reinforcements];
    this._reinforcementEnvelopes = null;
    this._resetResults();
  }

  /** Set the pile rows and sheet pile walls. */
  setPiles(piles: readonly Pile[]): void {
    for (const p of piles) {
      if (![p.x1, p.y1, p.x2, p.y2].every(Number.isFinite)) {
        throw new Error("A pile needs finite head and tip coordinates.");
      }
      const bad = (v: number | undefined, positive = false) =>
        v !== undefined && !(Number.isFinite(v) && (positive ? v > 0 : v >= 0));
      if (bad(p.force) || bad(p.shearCapacity) || bad(p.momentCapacity) || bad(p.spacing, true) || bad(p.diameter, true)) {
        throw new Error("Pile force and capacities must be ≥ 0, spacing and diameter > 0.");
      }
      if (bad(p.bendingStiffness, true) || bad(p.axialStiffness, true)) {
        throw new Error("Pile bending and axial stiffness must be > 0.");
      }
      if (p.angle !== undefined && !(Number.isFinite(p.angle) && Math.abs(p.angle) < 90)) {
        throw new Error("Pile force angle must be between −90° and 90°.");
      }
      if (p.direction !== undefined && !["angle", "tangent", "perpendicular"].includes(p.direction)) {
        throw new Error("Pile force direction must be 'angle', 'tangent' or 'perpendicular'.");
      }
      if (p.force === undefined) {
        if (p.diameter === undefined) {
          throw new Error("A pile needs a shear force, or a diameter for Ito & Matsui.");
        }
        if (Math.abs(p.x2 - p.x1) > 1e-6) {
          throw new Error("Ito & Matsui needs a vertical pile; give the shear force of an inclined pile.");
        }
        if (!((p.spacing ?? 1) > p.diameter)) {
          throw new Error("Ito & Matsui needs a spacing larger than the pile diameter (soil between the piles).");
        }
      }
    }
    this._piles = [...piles];
    this._resetResults();
  }

  /** Remove all line loads. */
  removeLineLoads(): void {
    this._lls = [];
    this._resetResults();
  }

  /**
   * Update analysis options.
   *
   * @param opts Partial analysis options to update.
   */
  updateAnalysisOptions(opts: Partial<AnalysisOptions> = {}): void {
    this._optionsGiven = { ...this._optionsGiven, ...opts };
    // (the state before drawdown is static: no seismic load)
    this._drawdownBefore?.updateAnalysisOptions({ ...opts, seismicHorizontal: 0, seismicVertical: 0 });
    // A NaN count or tolerance passed the clamps below unchanged and gave a
    // different analysis (or none) without an error.
    for (const key of ["slices", "iterations", "refinedIterations", "maxIterations", "tolerance", "minFailureDist"] as const) {
      const v = opts[key];
      if (v !== undefined && !Number.isFinite(v)) throw new Error(`Analysis option ${key} must be a finite number.`);
    }
    if (opts.tolerance !== undefined && !(opts.tolerance > 0)) throw new Error("Analysis option tolerance must be positive.");
    if (opts.method !== undefined) {
      if (!["Bishop", "Janbu", "Morgenstern-Price"].includes(opts.method)) {
        throw new Error(
          "Method must be one of 'Bishop', 'Janbu', or 'Morgenstern-Price'",
        );
      }
      this._method = opts.method;
    }
    if (opts.slices !== undefined) {
      this._slices = Math.max(
        SLICES_RANGE.min,
        Math.min(SLICES_RANGE.max, Math.round(opts.slices)),
      );
    }
    if (opts.iterations !== undefined) {
      this._iterations = Math.max(
        ITERATIONS_RANGE.min,
        Math.min(ITERATIONS_RANGE.max, opts.iterations),
      );
    }
    if (opts.refinedIterations !== undefined) {
      this._refinedIterations = Math.max(
        REFINED_ITERATIONS_RANGE.min,
        Math.min(REFINED_ITERATIONS_RANGE.max, opts.refinedIterations),
      );
    }
    if (opts.minFailureDist !== undefined) {
      this._minFailureDistance = Math.min(
        opts.minFailureDist,
        this._externalLength * 0.9,
      );
    }
    if (opts.tolerance !== undefined) {
      this._tolerance = opts.tolerance;
    }
    if (opts.maxIterations !== undefined) {
      // The solvers require more than 3 inner iterations before accepting
      // convergence; fewer would discard every surface.
      this._maxIterations = Math.max(MIN_MAX_ITERATIONS, opts.maxIterations);
    }
    if (opts.janbuCorrection !== undefined) {
      this._janbuCorrection = opts.janbuCorrection;
    }
    if (opts.porePressureHead !== undefined) {
      if (!["phreatic-correction", "vertical"].includes(opts.porePressureHead)) {
        throw new Error(
          "porePressureHead must be 'phreatic-correction' or 'vertical'",
        );
      }
      this._porePressureHead = opts.porePressureHead;
    }
    if (opts.tensionCrackDepth !== undefined) {
      if (!Number.isFinite(opts.tensionCrackDepth) || opts.tensionCrackDepth < 0) {
        throw new Error("tensionCrackDepth must be a number ≥ 0");
      }
      this._tensionCrackDepth = opts.tensionCrackDepth;
    }
    if (opts.tensionCrackAuto !== undefined) {
      this._tensionCrackAuto = opts.tensionCrackAuto;
    }
    if (opts.compositeSurfaces !== undefined) this._compositeSurfaces = opts.compositeSurfaces;
    if (opts.compositeBase !== undefined) this._compositeBase = opts.compositeBase;
    for (const k of ["seismicHorizontal", "seismicVertical"] as const) {
      const v = opts[k];
      if (v === undefined) continue;
      if (!Number.isFinite(v) || Math.abs(v) > 1) throw new Error(`${k} must be a number between −1 and 1`);
      if (k === "seismicHorizontal") this._seismicHorizontal = v;
      else this._seismicVertical = v;
    }
    if (opts.tensionCrackAngle !== undefined) {
      if (!Number.isFinite(opts.tensionCrackAngle) || opts.tensionCrackAngle < 0 || opts.tensionCrackAngle >= 90) {
        throw new Error("tensionCrackAngle must be ≥ 0 and less than 90°");
      }
      this._tensionCrackAngle = opts.tensionCrackAngle;
    }
    if (opts.tensionCrackWater !== undefined) {
      if (
        !Number.isFinite(opts.tensionCrackWater) ||
        opts.tensionCrackWater < 0 ||
        opts.tensionCrackWater > 1
      ) {
        throw new Error("tensionCrackWater must be between 0 and 1");
      }
      this._tensionCrackWater = opts.tensionCrackWater;
    }
    if (opts.nonCircularOptimization !== undefined) {
      this._nonCircularOptimization = opts.nonCircularOptimization;
    }
    if (opts.searchMethod !== undefined) {
      if (opts.searchMethod !== "circular" && opts.searchMethod !== "block") {
        throw new Error("searchMethod must be 'circular' or 'block'");
      }
      this._searchMethod = opts.searchMethod;
    }
    const angleRange = (name: string, r: [number, number] | null): [number, number] | null => {
      if (r === null) return null;
      const [lo, hi] = r;
      if (!(Number.isFinite(lo) && Number.isFinite(hi) && lo > 0 && hi < 90 && lo <= hi)) {
        throw new Error(`${name} must be a range [min, max] with 0° < min ≤ max < 90°`);
      }
      return [lo, hi];
    };
    if (opts.blockActiveAngle !== undefined) {
      this._blockActiveAngle = angleRange("blockActiveAngle", opts.blockActiveAngle);
    }
    if (opts.blockPassiveAngle !== undefined) {
      this._blockPassiveAngle = angleRange("blockPassiveAngle", opts.blockPassiveAngle);
    }
    if (opts.minSlipDepth !== undefined) {
      if (!Number.isFinite(opts.minSlipDepth) || opts.minSlipDepth < 0) {
        throw new Error("minSlipDepth must be a number ≥ 0");
      }
      this._minSlipDepth = opts.minSlipDepth;
    }
    if (opts.minSlipArea !== undefined) {
      if (
        opts.minSlipArea !== null &&
        (!Number.isFinite(opts.minSlipArea) || opts.minSlipArea < 0)
      ) {
        throw new Error("minSlipArea must be a number ≥ 0 or null");
      }
      this._minSlipArea = opts.minSlipArea;
    }
    if (opts.partialFactors !== undefined) {
      const f = opts.partialFactors;
      if (
        f &&
        ![f.cu, f.cohesion, f.tanPhi, f.variableLoad].every(
          (v) => Number.isFinite(v) && v > 0,
        )
      ) {
        throw new Error("Partial factors must be positive numbers");
      }
      this._partialFactors = f ? { ...f } : null;
    }
    if (opts.intersliceFunction !== undefined) {
      if (
        ![
          "constant",
          "half-sine",
          "clipped-sine",
          "trapezoidal",
          "data-point-specified",
        ].includes(opts.intersliceFunction)
      ) {
        throw new Error(
          "intersliceFunction must be one of 'constant', 'half-sine', 'clipped-sine', 'trapezoidal', or 'data-point-specified'",
        );
      }
      this._intersliceFunction = opts.intersliceFunction;
    }
    if (opts.intersliceDataPoints !== undefined) {
      this._intersliceDataPoints = opts.intersliceDataPoints.filter(
        (p): p is [number, number] =>
          Array.isArray(p) && p.length >= 2 && isFinite(p[0]) && isFinite(p[1]),
      );
    }
    this._resetResults();
  }

  /**
   * Set analysis limits for the search area.
   */
  setAnalysisLimits(limits: Partial<AnalysisLimits>): void {
    const entryLeftProvided = limits.entryLeftX !== undefined;
    const entryRightProvided = limits.entryRightX !== undefined;
    const exitLeftProvided = limits.exitLeftX !== undefined;
    const exitRightProvided = limits.exitRightX !== undefined;

    let entryLeftX = limits.entryLeftX ?? this._limits[0];
    let entryRightX = limits.entryRightX ?? this._limits[1];
    let exitLeftX = limits.exitLeftX ?? this._limits[2];
    let exitRightX = limits.exitRightX ?? this._limits[3];

    // If only one bound of a pair was provided, set the other to match
    if (entryLeftProvided && !entryRightProvided) entryRightX = entryLeftX;
    if (exitLeftProvided && !exitRightProvided) exitRightX = exitLeftX;

    // Ensure correct order
    if (entryLeftX > entryRightX)
      [entryLeftX, entryRightX] = [entryRightX, entryLeftX];
    if (exitLeftX > exitRightX)
      [exitLeftX, exitRightX] = [exitRightX, exitLeftX];

    this._limits = [entryLeftX, entryRightX, exitLeftX, exitRightX];
    this._resetResults();
  }

  /** Reset analysis limits to search the entire slope. */
  removeAnalysisLimits(): void {
    if (!this._surfaceLineX || !this._surfaceLineY) {
      throw new Error("Surface line is not defined");
    }
    const minX = Math.min(...this._surfaceLineX);
    const maxX = Math.max(...this._surfaceLineX);
    this.setAnalysisLimits({
      entryLeftX: minX,
      entryRightX: maxX,
      exitLeftX: minX,
      exitRightX: maxX,
    });
    this._resetResults();
  }

  /**
   * Specify fixed x-coordinates for slice boundaries.
   */
  addFixedSlices(x: number[]): void {
    this._fixedSlices = [...x];
    this._resetResults();
  }

  /** Clear all manually added individual failure surfaces. */
  removeIndividualPlanes(): void {
    this._individualPlanes = [];
    this._resetResults();
  }

  // ────────────────────────────────────────────────────────────────
  // Query methods
  // ────────────────────────────────────────────────────────────────

  /**
   * Get the y-coordinate of the slope surface at a given x.
   */
  getExternalYIntersection(x: number): number {
    const cached = this._externalYCache.get(x);
    if (cached !== undefined) return cached;
    if (!this._surfaceLineX || !this._surfaceLineY) {
      throw new Error("Surface line coordinates are not defined");
    }
    const y = getYAtX(this._surfaceLineX, this._surfaceLineY, x);
    this._externalYCache.set(x, y);
    return y;
  }

  /**
   * Check whether a point lies inside the external boundary polygon.
   */
  isInsideExternalBoundary(x: number, y: number): boolean {
    if (
      this._externalBoundaryPx.length < 3 ||
      this._externalBoundaryPy.length < 3
    ) {
      return false;
    }
    return isPointInPolygon(
      x,
      y,
      this._externalBoundaryPx,
      this._externalBoundaryPy,
    );
  }

  /**
   * Get the y-coordinate of the water table at a given x.
   */
  getWaterYIntersection(x: number): number {
    const cached = this._waterYCache.get(x);
    if (cached !== undefined) return cached;
    if (!this._waterRLXY) {
      throw new Error("Water table coordinates are not defined");
    }
    const y = getYAtX(this._waterRLXY.x, this._waterRLXY.y, x);
    this._waterYCache.set(x, y);
    return y;
  }

  /**
   * Get intersection points of a circle with the external boundary surface.
   * Returns sorted by x-coordinate.
   */
  getCircleExternalIntersection(
    cx: number,
    cy: number,
    radius: number,
  ): [number, number][] {
    if (!this._surfaceLineX || !this._surfaceLineY) {
      throw new Error("Surface line is not defined");
    }
    const intersections = getCircleLineIntersections(
      cx,
      cy,
      radius,
      this._surfaceLineX,
      this._surfaceLineY,
    );
    // Sort by x-coordinate.  A circle through a surface vertex is found on
    // both adjacent segments; drop the duplicate or the plane's entry and
    // exit collapse into one point and the plane is discarded.
    intersections.sort((a, b) => a[0] - b[0]);
    return intersections.filter(
      (p, i) =>
        i === 0 ||
        Math.abs(p[0] - intersections[i - 1][0]) > 1e-9 ||
        Math.abs(p[1] - intersections[i - 1][1]) > 1e-9,
    );
  }

  /**
   * Get the minimum factor of safety from the analysis results.
   */
  getMinFOS(): number {
    const valid = this._search.filter((plane) => plane.fos != null);
    if (valid.length === 0) {
      throw new Error("No analysis results available");
    }
    return valid[0].fos!;
  }

  /**
   * Get the maximum factor of safety from the analysis results.
   */
  getMaxFOS(): number {
    const valid = this._search.filter((plane) => plane.fos != null);
    if (valid.length === 0) {
      throw new Error("No analysis results available");
    }
    return valid[valid.length - 1].fos!;
  }

  /**
   * Get the critical failure surface circle properties.
   */
  getMinFOSCircle(): { cx: number; cy: number; radius: number } {
    if (this._search.length === 0) {
      throw new Error("No analysis results available");
    }
    const s = this._search[0];
    return { cx: s.cx, cy: s.cy, radius: s.radius };
  }

  /**
   * Get the entry and exit points of the critical failure surface.
   */
  getMinFOSEndPoints(): { entry: [number, number]; exit: [number, number] } {
    if (this._search.length === 0) {
      throw new Error("No analysis results available");
    }
    return { entry: this._search[0].lc, exit: this._search[0].rc };
  }

  // ────────────────────────────────────────────────────────────────
  // Internal
  // ────────────────────────────────────────────────────────────────

  /** Material models were changed in place (e.g. Monte Carlo samples): drop what depends on them. */
  materialsChanged(): void {
    this._resetResults();
  }

  private _resetResults(): void {
    this._search = [];
    // materials can change in place (assignMaterial): the floor with them
    this._compositeFloorCache = null;
    // Pullout from the overburden and the pile pressures depend on geometry,
    // materials, water and the partial factors.
    this._reinforcementEnvelopes = null;
    this._pileProfiles = null;
    this._externalYCache.clear();
    // Don't clear water cache here — water table doesn't change with results reset
  }

  toString(): string {
    return "Slope";
  }
}
