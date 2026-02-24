/**
 * Load type definitions for slope stability analysis.
 */

/** Uniformly distributed load (surface pressure) in kPa. */
export interface UdlParams {
  /** Magnitude in kPa. */
  magnitude: number;
  /** Left x-coordinate (m). */
  x1: number;
  /** Right x-coordinate (m). */
  x2: number;
  /** Display color (default: "red"). */
  color?: string;
}

export class Udl {
  readonly magnitude: number;
  readonly x1: number;
  readonly x2: number;
  readonly length: number;
  readonly color: string;

  constructor(params: UdlParams) {
    this.magnitude = Math.abs(params.magnitude);
    this.x1 = params.x1;
    this.x2 = params.x2;
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
