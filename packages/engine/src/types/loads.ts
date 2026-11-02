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

  constructor(params: UdlParams) {
    this.direction = params.direction === "normal" ? "normal" : "vertical";
    this.magnitude = Math.abs(params.magnitude);
    this.x1 = Math.min(params.x1, params.x2);
    this.x2 = Math.max(params.x1, params.x2);
    this.length = this.x2 - this.x1;
    this.color = params.color ?? "red";
  }
}

/** Line load (point load per unit width) in kN/m. */
export interface LineLoadParams {
  /** Magnitude in kN/m. */
  magnitude: number;
  /** x-coordinate where the load is applied (m). */
  x: number;
  /** Display color (default: "blue"). */
  color?: string;
}

export class LineLoad {
  readonly magnitude: number;
  readonly x: number;
  readonly color: string;

  constructor(params: LineLoadParams) {
    this.magnitude = Math.abs(params.magnitude);
    this.x = params.x;
    this.color = params.color ?? "blue";
  }
}
