/** Facade shim of math/loads.ts (see facade/internal.ts). */
import { wasm } from "../internal";
import type { LineLoadData, UdlData } from "../../math/loads";

export type { LineLoadData, UdlData } from "../../math/loads";

export function calculateAllLoads(widths: number[], centerXs: number[], udls: UdlData[], linLoads: LineLoadData[]): [number[], number[]] {
  return wasm().calculate_all_loads(widths, centerXs, udls, linLoads);
}
