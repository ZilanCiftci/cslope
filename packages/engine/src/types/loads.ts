/**
 * Load type definitions for slope stability analysis.
 *
 * Implemented by the Rust engine (packages/engine-rs) through WebAssembly (see facade/internal.ts).
 */
import { wasm } from "../facade/internal";

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

/** A distributed load, normalised by the engine (a plain data object). */
export class Udl {
  readonly magnitude: number;
  readonly x1: number;
  readonly x2: number;
  readonly length: number;
  readonly color: string;
  readonly direction: UdlDirection;
  readonly excessPorePressure: readonly UdlExcessPorePressure[];

  constructor(params: UdlParams) {
    const u = wasm().udl_new(params) as Udl;
    this.magnitude = u.magnitude;
    this.x1 = u.x1;
    this.x2 = u.x2;
    this.length = u.length;
    this.color = u.color;
    this.direction = u.direction;
    this.excessPorePressure = u.excessPorePressure;
  }
}

/** A line load, normalised by the engine (a plain data object). */
export class LineLoad {
  readonly magnitude: number;
  readonly x: number;
  /** Inclination from the downward vertical (°), positive towards +x. */
  readonly angle: number;
  /** Elevation of the load point (undefined: the ground at x). */
  readonly y: number | undefined;
  readonly color: string;

  constructor(params: LineLoadParams) {
    const l = wasm().line_load_new(params) as LineLoad;
    this.magnitude = l.magnitude;
    this.x = l.x;
    this.angle = l.angle;
    this.y = l.y;
    this.color = l.color;
  }
}
