/**
 * Load type definitions for slope stability analysis.
 */

/** Uniformly distributed load (surface pressure) in kPa. */
export interface UdlParams {
  /** Magnitude in kPa. */
  magnitude: number;
  /** One x-endpoint (m). */
  x1: number;
  /** Other x-endpoint (m). */
  x2: number;
  /** Display color (default: "red"). */
  color?: string;
  /**
   * How the pressure acts: "vertical" (default), or "normal" to the ground
   * surface, as water or earth pressure against a slope. A normal pressure
   * p on ground inclined at β carries p per horizontal metre vertically and
   * p·tan β horizontally (into the ground), so the vertical part equals a
   * vertical load of the same magnitude.
   */
  direction?: UdlDirection;
  /**
   * The part of the load carried by excess pore pressure at slice bases in
   * the named materials: 1 − the degree of consolidation under the load
   * (0 drained, 1 undrained). A base under the load and below the water
   * (with pore pressure) gets ratio × q more. Not set: none (fully
   * consolidated).
   */
  excessPorePressure?: UdlExcessPorePressure[];
}

/** Excess pore pressure under a load in one material (see `UdlParams.excessPorePressure`). */
export interface UdlExcessPorePressure {
  /** Material name. */
  material: string;
  /** Part of the load (0–1). */
  ratio: number;
}

/** Direction of a distributed load (see `UdlParams.direction`). */
export type UdlDirection = "vertical" | "normal";

export class Udl {
  readonly magnitude: number;
  readonly x1: number;
  readonly x2: number;
  readonly length: number;
  readonly color: string;
  readonly direction: UdlDirection;
  readonly excessPorePressure: readonly UdlExcessPorePressure[];

  constructor(params: UdlParams) {
    this.direction = params.direction === "normal" ? "normal" : "vertical";
    this.magnitude = Math.abs(params.magnitude);
    this.x1 = Math.min(params.x1, params.x2);
    this.x2 = Math.max(params.x1, params.x2);
    this.length = this.x2 - this.x1;
    this.color = params.color ?? "red";
    this.excessPorePressure = (params.excessPorePressure ?? [])
      .filter((e) => Number.isFinite(e.ratio) && e.ratio > 0)
      .map((e) => ({ material: e.material, ratio: Math.min(1, e.ratio) }));
  }
}

/** Line load (point load per unit width) in kN/m. */
export interface LineLoadParams {
  /** Magnitude in kN/m. */
  magnitude: number;
  /** x-coordinate where the load is applied (m). */
  x: number;
  /**
   * Inclination of the load from the downward vertical (°), positive when
   * it points towards +x: 0 vertical, ±90 horizontal. Default 0. The
   * horizontal part acts at the ground at x.
   */
  angle?: number;
  /**
   * Elevation where the load acts (m), for the moment of its horizontal
   * part: a point on a wall face. Default: the ground at x.
   */
  y?: number;
  /** Display color (default: "blue"). */
  color?: string;
}

export class LineLoad {
  readonly magnitude: number;
  readonly x: number;
  /** Inclination from the downward vertical (°), positive towards +x. */
  readonly angle: number;
  /** Elevation of the load point (undefined: the ground at x). */
  readonly y: number | undefined;
  readonly color: string;

  constructor(params: LineLoadParams) {
    this.magnitude = Math.abs(params.magnitude);
    this.x = params.x;
    this.angle = Number.isFinite(params.angle) ? params.angle! : 0;
    this.y = Number.isFinite(params.y) ? params.y : undefined;
    this.color = params.color ?? "blue";
  }
}
