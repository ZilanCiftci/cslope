/** Facade shim of types/loads.ts (see facade/internal.ts). */
import { wasm } from "../internal";
import type { LineLoadParams, UdlDirection, UdlExcessPorePressure, UdlParams } from "../../types/loads";

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
  readonly angle: number;
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
