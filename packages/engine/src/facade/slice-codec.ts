/**
 * Slices and planes in bulk (not a shim): the layout of
 * crates/cslope-wasm/src/api/wire.rs. The numbers of all slices travel as
 * one Float64Array, SLICE_STRIDE per slice; the structured fields as a
 * sparse list; a plane's own fields with the number of its slices.
 */
import type { Slice } from "../types/geometry";
import type { SearchPlane } from "../model/slope";

/** The numbers every slice has, in the engine's order. */
const NUMBERS = [
  "x", "xLeft", "xRight", "y0Top", "y1Top", "yTop", "y0Bottom", "y1Bottom", "yBottom",
  "width", "height", "area", "alpha", "baseLength", "weight", "dx", "e", "R", "udl", "ll",
  "cohesion", "cohesionUndrained", "frictionAngle", "phi", "U",
] as const;
/** Optional numbers (bit i of the mask). */
const OPTIONAL = ["normalArm", "cohesionUndrainedPart", "suction", "suctionStrength", "uWater", "waterLoad", "hForce", "extraMoment", "yCentroid"] as const;
/** Optional flags (bit 9 + i). */
const FLAGS = ["circular", "undrainedGoverns", "isCombined", "skipSurface", "impenetrable"] as const;
/** Structured fields (the sparse list). */
const EXTRAS = ["reinforcementActive", "reinforcementPassive", "reinforcementForces", "hoekBrown", "strengthModel", "shearNormal"] as const;

const N = NUMBERS.length;
export const SLICE_STRIDE = N + 3 + OPTIONAL.length + FLAGS.length;

/** Slices as the engine sends and reads them; materials as table indices. */
export interface SlicesWire {
  data: Float64Array;
  extras: [number, Record<string, unknown>][];
}

/** Planes as the engine sends and reads them. */
export interface PlanesWire {
  planes: (Omit<SearchPlane, "slices"> & { sliceCount?: number })[];
  slices: SlicesWire;
}

type Raw = Record<string, unknown>;

/** Slices (`baseMaterial` an index or null) from the wire. */
export function decodeSlices(w: SlicesWire, start = 0, count = w.data.length / SLICE_STRIDE, extraAt?: Map<number, Raw>): Raw[] {
  const d = w.data;
  const extras = extraAt ?? new Map(w.extras);
  const out = new Array<Raw>(count);
  for (let k = 0; k < count; k++) {
    const i = start + k;
    const o = i * SLICE_STRIDE;
    const m = d[o + N + 1];
    // (a literal, in NUMBERS' order: objects of one shape, made fast)
    const s: Raw = {
      x: d[o],
      xLeft: d[o + 1],
      xRight: d[o + 2],
      y0Top: d[o + 3],
      y1Top: d[o + 4],
      yTop: d[o + 5],
      y0Bottom: d[o + 6],
      y1Bottom: d[o + 7],
      yBottom: d[o + 8],
      width: d[o + 9],
      height: d[o + 10],
      area: d[o + 11],
      alpha: d[o + 12],
      baseLength: d[o + 13],
      weight: d[o + 14],
      dx: d[o + 15],
      e: d[o + 16],
      R: d[o + 17],
      udl: d[o + 18],
      ll: d[o + 19],
      cohesion: d[o + 20],
      cohesionUndrained: d[o + 21],
      frictionAngle: d[o + 22],
      phi: d[o + 23],
      U: d[o + 24],
      isValid: d[o + N] !== 0,
      baseMaterial: m >= 0 ? m : null,
    };
    const mask = d[o + N + 2];
    const base = o + N + 3;
    for (let f = 0; f < OPTIONAL.length; f++) if (mask & (1 << f)) s[OPTIONAL[f]] = d[base + f];
    for (let f = 0; f < FLAGS.length; f++) if (mask & (1 << (OPTIONAL.length + f))) s[FLAGS[f]] = d[base + OPTIONAL.length + f] !== 0;
    const e = extras.get(i);
    if (e) Object.assign(s, e);
    out[k] = s;
  }
  return out;
}

/** Slices for the engine; `material` gives a slice's table index (or null). */
export function encodeSlices(slices: readonly Raw[], material: (m: unknown) => number | null, into?: { data: number[]; extras: [number, Raw][] }): SlicesWire {
  const acc = into ?? { data: [], extras: [] };
  for (const s of slices) {
    const i = acc.data.length / SLICE_STRIDE;
    for (let f = 0; f < N; f++) {
      const v = s[NUMBERS[f]];
      acc.data.push(typeof v === "number" ? v : NaN);
    }
    acc.data.push(s.isValid ? 1 : 0);
    const m = s.baseMaterial ? material(s.baseMaterial) : null;
    acc.data.push(m ?? -1);
    let mask = 0;
    const values: number[] = [];
    for (let f = 0; f < OPTIONAL.length; f++) {
      const v = s[OPTIONAL[f]];
      if (v !== undefined) mask |= 1 << f;
      values.push(typeof v === "number" ? v : v === undefined ? 0 : NaN);
    }
    for (let f = 0; f < FLAGS.length; f++) {
      const v = s[FLAGS[f]];
      if (v !== undefined) mask |= 1 << (OPTIONAL.length + f);
      values.push(v ? 1 : 0);
    }
    acc.data.push(mask, ...values);
    let extra: Raw | undefined;
    for (const k of EXTRAS) {
      if (s[k] !== undefined) (extra ??= {})[k] = s[k];
    }
    if (extra) acc.extras.push([i, extra]);
  }
  return into ? (undefined as unknown as SlicesWire) : { data: Float64Array.from(acc.data), extras: acc.extras };
}

/** The slices of a plane whose analysis dropped them (the engine evaluates them on request). */
export const LAZY = Symbol("slices on request");

/** Planes (slices with material indices) from the wire. */
export function decodePlanes(w: PlanesWire): (SearchPlane & { slices: Raw[] | null })[] {
  const extras = new Map(w.slices.extras);
  let at = 0;
  return w.planes.map((p) => {
    const { sliceCount, lazySlices, ...rest } = p as typeof p & { lazySlices?: boolean };
    const plane = rest as Raw;
    if (lazySlices) {
      // (the caller gives it a getter: Slope._planes)
      plane.slices = LAZY;
    } else if (sliceCount === undefined) {
      plane.slices = null;
    } else {
      plane.slices = decodeSlices(w.slices, at, sliceCount, extras);
      at += sliceCount;
    }
    return plane as unknown as SearchPlane & { slices: Raw[] | null };
  });
}

/** Planes for the engine. */
export function encodePlanes(planes: readonly SearchPlane[], material: (m: unknown) => number | null): PlanesWire {
  const acc = { data: [] as number[], extras: [] as [number, Raw][] };
  const metas = planes.map((p) => {
    const { slices, ...rest } = p;
    const meta = rest as Raw;
    if (slices) {
      meta.sliceCount = slices.length;
      encodeSlices(slices as unknown as Raw[], material, acc);
    }
    return meta as PlanesWire["planes"][number];
  });
  return { planes: metas, slices: { data: Float64Array.from(acc.data), extras: acc.extras } };
}

export type { Slice };
