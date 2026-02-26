/**
 * Core Slope model for slope stability analysis.
 */

import type {
  AnalysisLimits,
  IntersliceFunctionType,
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
  splitPolygonByPolyline,
  createGeometryWithMaterial,
} from "./geometry-ops";

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
  fos: number;
  /** Slices for this surface (set after analysis). */
  slices: Slice[] | null;
  /** Lambda-FS-FForce array for Morgenstern-Price. */
  lffArray?: [number, number, number][];
}

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

  // ── Loads ─────────────────────────────────────────────────────
  private _udls: Udl[] = [];
  private _lls: LineLoad[] = [];

  // ── Analysis options ──────────────────────────────────────────
  private _slices: number;
  private _iterations: number;
  private _refinedIterations: number;
  private _minFailureDistance: number;
  private _tolerance: number;
  private _maxIterations: number;
  private _method: AnalysisMethod;
  private _limitToRunBishops: number;
  private _limitToRunJanbu: number;
  private _limitToRunMorgenstern: number;
  private _intersliceFunction: IntersliceFunctionType;
  private _intersliceDataPoints: [number, number][];

  // ── Analysis limits ───────────────────────────────────────────
  private _limits: [number, number, number, number] = [0, 0, 0, 0];

  // ── Search planes ─────────────────────────────────────────────
  private _search: SearchPlane[] = [];
  private _individualPlanes: SearchPlane[] = [];
  private _fixedSlices: number[] | null = null;

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
    this._limitToRunBishops = d.limitBishop;
    this._limitToRunJanbu = d.limitJanbu;
    this._limitToRunMorgenstern = d.limitMorgensternPrice;
    this._intersliceFunction = d.intersliceFunction ?? "half-sine";
    this._intersliceDataPoints = [...(d.intersliceDataPoints ?? [])];
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

  get waterRLXY(): { x: number[]; y: number[] } | null {
    return this._waterRLXY;
  }

  get hasWaterTable(): boolean {
    return this._waterRL;
  }

  get udls(): readonly Udl[] {
    return this._udls;
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

  get minFailureDistance(): number {
    return this._minFailureDistance;
  }

  get fixedSlices(): number[] | null {
    return this._fixedSlices;
  }

  get search(): readonly SearchPlane[] {
    return this._search;
  }

  get individualPlanes(): readonly SearchPlane[] {
    return this._individualPlanes;
  }

  get limitToRunBishops(): number {
    return this._limitToRunBishops;
  }

  get limitToRunJanbu(): number {
    return this._limitToRunJanbu;
  }

  get limitToRunMorgenstern(): number {
    return this._limitToRunMorgenstern;
  }

  get intersliceFunction(): IntersliceFunctionType {
    return this._intersliceFunction;
  }

  get intersliceDataPoints(): [number, number][] {
    return this._intersliceDataPoints;
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

    // Update min failure distance
    this.updateAnalysisOptions({ minFailureDist: 0 });

    // Reset limits to search entire slope
    this.removeAnalysisLimits();

    // Reset results
    this._resetResults();
  }

  /**
   * Set a material boundary line that splits existing material geometries.
   *
   * @param coordinates Array of [x, y] tuples defining the boundary line.
   */
  setMaterialBoundary(coordinates: [number, number][]): void {
    if (!coordinates || coordinates.length < 2) {
      throw new Error("Material boundary needs at least 2 coordinate points");
    }

    const lx = coordinates.map((c) => c[0]);
    const ly = coordinates.map((c) => c[1]);

    const newGeometries: GeometryWithMaterial[] = [];
    for (const mg of this._materialGeometries) {
      const pieces = splitPolygonByPolyline(mg.px, mg.py, lx, ly);
      for (const piece of pieces) {
        newGeometries.push(
          createGeometryWithMaterial(piece.px, piece.py, mg.material),
        );
      }
    }
    this._materialGeometries = newGeometries;
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

    if (waterHeight !== undefined) {
      if (this._externalBoundaryPx.length === 0) {
        throw new Error(
          "External boundary must be set before setting water table",
        );
      }
      const minX = Math.min(...this._externalBoundaryPx);
      const maxX = Math.max(...this._externalBoundaryPx);

      if (followBoundary) {
        // Split external boundary at water height and get upper surface
        const cutLx = [minX, maxX];
        const cutLy = [waterHeight, waterHeight];
        const pieces = splitPolygonByPolyline(
          this._externalBoundaryPx,
          this._externalBoundaryPy,
          cutLx,
          cutLy,
        );
        if (pieces.length >= 2) {
          // The upper piece is the one with higher average y
          const avgYs = pieces.map(
            (p) => p.py.reduce((s, v) => s + v, 0) / p.py.length,
          );
          const upperIdx = avgYs.indexOf(Math.max(...avgYs));
          const upper = pieces[upperIdx];
          const wl = getSurfaceLine(upper.px, upper.py);
          this._waterRL = true;
          this._waterRLXY = { x: wl.x, y: wl.y };
        }
      } else {
        this._waterRL = true;
        this._waterRLXY = { x: [minX, maxX], y: [waterHeight, waterHeight] };
      }
    } else if (waterCoords) {
      const wx = waterCoords.map((c) => c[0]);
      const wy = waterCoords.map((c) => c[1]);

      if (followBoundary) {
        const pieces = splitPolygonByPolyline(
          this._externalBoundaryPx,
          this._externalBoundaryPy,
          wx,
          wy,
        );
        if (pieces.length >= 2) {
          const avgYs = pieces.map(
            (p) => p.py.reduce((s, v) => s + v, 0) / p.py.length,
          );
          const upperIdx = avgYs.indexOf(Math.max(...avgYs));
          const upper = pieces[upperIdx];
          const wl = getSurfaceLine(upper.px, upper.py);
          this._waterRL = true;
          this._waterRLXY = { x: wl.x, y: wl.y };
        }
      } else {
        this._waterRL = true;
        this._waterRLXY = { x: wx, y: wy };
      }
    }

    this._waterYCache.clear();
    this._resetResults();
  }

  /** Remove the water table from the model. */
  removeWaterTable(): void {
    this._waterRL = false;
    this._waterRLXY = null;
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
        Math.min(SLICES_RANGE.max, opts.slices),
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
      this._maxIterations = opts.maxIterations;
    }
    if (opts.limitBishop !== undefined) {
      this._limitToRunBishops = opts.limitBishop;
    }
    if (opts.limitJanbu !== undefined) {
      this._limitToRunJanbu = opts.limitJanbu;
    }
    if (opts.limitMorgensternPrice !== undefined) {
      this._limitToRunMorgenstern = opts.limitMorgensternPrice;
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
    // Sort by x-coordinate
    intersections.sort((a, b) => a[0] - b[0]);
    return intersections;
  }

  /**
   * Get the minimum factor of safety from the analysis results.
   */
  getMinFOS(): number {
    if (this._search.length === 0) {
      throw new Error("No analysis results available");
    }
    return this._search[0].fos;
  }

  /**
   * Get the maximum factor of safety from the analysis results.
   */
  getMaxFOS(): number {
    if (this._search.length === 0) {
      throw new Error("No analysis results available");
    }
    return this._search[this._search.length - 1].fos;
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

  private _resetResults(): void {
    this._search = [];
    this._externalYCache.clear();
    // Don't clear water cache here — water table doesn't change with results reset
  }

  toString(): string {
    return "Slope";
  }
}
