/**
 * What the templates share: the ground in horizontal layers under a level
 * ground surface, a drained fill (the excavation's road, the embankment),
 * the model's extent, and the checks of these, each problem with its
 * field. The values are characteristic: F is a factor of safety (design
 * values with partial factors are for the app and Python). No strength
 * has a default (B5).
 */
import type { AnalysisOptions } from "@cslope/engine";
import type { Definition, Point, Strength } from "./builder";
import { appMaterialColor, defaultLayerColor } from "./colors";
import type { ParameterDescription } from "./types";

/** A parameter's bounds (the tests draw values within them). */
export type ParameterDescriptionLike = Pick<ParameterDescription, "min" | "max" | "step" | "typical">;

/** A layer's material: the kind names the fields. */
export type LayerMaterial =
  | { kind: "undrained"; gamma: number; su: number }
  | {
      /** Su is `su` at the top of the layer and grows by `suRate` per meter below it (by elevation: the profile the clay had before the excavation). */
      kind: "undrained-increasing";
      gamma: number;
      su: number;
      suRate: number;
    }
  | {
      kind: "drained";
      /** The unit weight, above and below the water (kN/m³). */
      gamma: number;
      c: number;
      phi: number;
    }
  | { kind: "impenetrable"; gamma: number };

export type LayerKind = LayerMaterial["kind"];

export interface Layer {
  /** The name in the results; default "Layer n". */
  name?: string;
  /** The elevation of the layer's bottom (m). The last layer's bottom is the model's base, treated as firm ground (a note says when it is shallower than recommended). */
  bottomLevel: number;
  material: LayerMaterial;
  /** The color in the drawing and the app ("#a0522d", one of LAYER_COLORS); default: defaultLayerColor of its position. */
  color?: string;
}

/** A drained fill above the ground: the excavation's haul road, the embankment. */
export interface Fill {
  /** The unit weight, above and below the water (kN/m³). */
  gamma: number;
  c: number;
  phi: number;
}

/** A problem of a parameter set, with the field it is about. */
export interface FieldProblem {
  /**
   * The field: a key of the parameters ("excavationDepth"), of a layer
   * ("layers.0.su"), of a group ("road.width", the road's fill
   * "road.gamma", the embankment's "fill.c"); "layers" for the list.
   */
  field: string;
  /** The sentence the form shows under the field. */
  message: string;
  /** The sentence where the field is not at hand (a list of problems): "Layer 1: φ′ (°) must be …"; `message` when not set. */
  general?: string;
}

type BoundOptions = Pick<ParameterDescription, "minExclusive" | "maxExclusive" | "typical">;

export const p = (name: string, label: string, unit: string | null, min: number, max: number, step: number, description: string, options: BoundOptions = {}): ParameterDescription => ({
  name,
  label,
  unit,
  min,
  max,
  step,
  description,
  ...options,
});

/** A value with its unit: "500 kN/m³", "90°". */
const withUnit = (v: number, unit: string | null) => (unit ? `${v}${unit === "°" ? "" : " "}${unit}` : String(v));

/** A parameter's bounds in words: "from 0.5 to 20 m", "more than 0 and at most 500 kN/m³", "at least 0 kPa". */
export function boundsText(d: ParameterDescription): string {
  if (!d.minExclusive && !d.maxExclusive && Number.isFinite(d.max)) return `from ${d.min} to ${withUnit(d.max, d.unit)}`;
  const low = `${d.minExclusive ? "more than" : "at least"} ${withUnit(d.min, d.unit)}`;
  if (!Number.isFinite(d.max)) return low;
  return `${low} and ${d.maxExclusive ? "less than" : "at most"} ${withUnit(d.max, d.unit)}`;
}

export const GROUND_LEVEL = p("groundLevel", "Ground level (m)", "m", -100, 1000, 0.1, "The elevation of the ground surface; the levels of the layers and the water are elevations too.");
export const SLOPE = p("slope", "Slope 1:n", null, 0.5, 5, 0.1, "n horizontal per 1 vertical: 1:2 is flatter than 1:1.");
export const WATER_LEVEL = p("waterLevel", "Ground-water level (m)", "m", -100, 1000, 0.1, "The elevation of the ground water, cut at the ground; leave out for a dry slope.");

/** A layer's fields. */
export const LAYER_PARAMETERS = {
  bottomLevel: p("bottomLevel", "Bottom level (m)", "m", -100, 1000, 0.1, "The elevation of the layer's bottom. A layer is at least 0.05 m thick."),
  // The bounds of the strengths and unit weights are the engine's (the app's Materials window takes the same).
  gamma: p("gamma", "γ (kN/m³)", "kN/m³", 0, 500, 0.1, "The unit weight, above and below the water.", { minExclusive: true, typical: [10, 25] }),
  su: p("su", "Su (kPa)", "kPa", 0, Infinity, 0.5, "The undrained shear strength; when it increases with depth, its value at the top of the layer.", { typical: [1, 500] }),
  suRate: p("suRate", "Su increase rate (kPa/m)", "kPa/m", 0, Infinity, 0.1, "The increase of Su per meter below the top of the layer (by elevation). Empty: Su constant.", { typical: [0, 10] }),
  c: p("c", "c′ (kPa)", "kPa", 0, Infinity, 0.5, "The effective cohesion. c′ and φ′ cannot both be 0.", { typical: [0, 100] }),
  phi: p("phi", "φ′ (°)", "°", 0, 90, 0.5, "The effective friction angle. c′ and φ′ cannot both be 0.", { maxExclusive: true, typical: [5, 45] }),
};

/** A fill's fields: a Mohr-Coulomb material (drained), as the app names it. */
export const FILL_PARAMETERS = {
  gamma: p("gamma", "Fill γ (kN/m³)", "kN/m³", 0, 500, 0.1, "The fill's unit weight, above and below the water. The fill is a Mohr-Coulomb material (drained).", { minExclusive: true, typical: [15, 24] }),
  c: p("c", "Fill c′ (kPa)", "kPa", 0, Infinity, 0.5, "The effective cohesion of the fill (Mohr-Coulomb). c′ and φ′ cannot both be 0.", { typical: [0, 20] }),
  phi: p("phi", "Fill φ′ (°)", "°", 0, 90, 0.5, "The effective friction angle of the fill (Mohr-Coulomb). c′ and φ′ cannot both be 0.", { maxExclusive: true, typical: [25, 45] }),
};

/**
 * The templates' options over the app's: the engine's automatic tension
 * crack, its depth from the soil at each surface's entry (2c/(γ√Ka) − q/γ;
 * 2Su/γ − q/γ in clay) and at a base steeper than 65°, so that a steep
 * entry relying on tension at the base (N′ < 0, a low m_α) is cut off
 * rather than counted. The page does not show the engine's warnings (its
 * users cannot act on them; the app does), so the model avoids what they
 * are about.
 */
export const TEMPLATE_OPTIONS = { tensionCrackAuto: true, tensionCrackAngle: 65 } satisfies Partial<AnalysisOptions>;

/** A layer is at least this thick, and no level comes closer than this to an excavation bottom (m). */
export const MIN_LAYER_THICKNESS = 0.05;

/**
 * Each side of a model reaches this many times the model's depth (its top
 * to its base), and at least 3 times the slope's height: a slip circle
 * through a deep soft layer reaches far, and an edge too close cuts it off
 * and raises F (the review found 1–4 %). A test widens every example 2×
 * and finds F unchanged.
 */
export const EXTENT_FACTOR = 1.5;

export function layerName(layer: Layer, index: number): string {
  return layer.name?.trim() || `Layer ${index + 1}`;
}

const within = (v: number, d: ParameterDescription) =>
  Number.isFinite(v) && (d.minExclusive ? v > d.min : v >= d.min) && (d.maxExclusive ? v < d.max : v <= d.max);

/** Collects the problems of a parameter set. */
export class Problems {
  readonly list: FieldProblem[] = [];

  add(field: string, message: string, general?: string): void {
    this.list.push({ field, message, ...(general ? { general } : {}) });
  }

  /** A value out of its bounds, with `where` before the label ("Layer 1: "). */
  check(field: string, v: number, d: ParameterDescription, where = ""): void {
    // At the field the label is beside it: "Must be at least 0°…"; elsewhere with the layer and the label, without its unit.
    if (!within(v, d)) this.add(field, `Must be ${boundsText(d)}.`, `${where}${d.label.replace(/ \([^)]*\)$/, "")} must be ${boundsText(d)}.`);
  }

  /**
   * The layers: at least one, names used once, each at least 5 cm thick
   * below the ground or the layer above, and its material's values; a
   * level (other than the last layer's) within 5 cm of `avoid.level` (an
   * excavation's bottom) is refused, and a layer named as the fill's
   * material (`reserved`).
   */
  layers(layers: Layer[], ground: number, options: { avoid?: { level: number; text: string }; reserved?: { name: string; what: string } } = {}): void {
    const P = LAYER_PARAMETERS;
    if (!layers.length) this.add("layers", "The ground needs at least one layer.");
    const names = new Map<string, number>();
    const thin = MIN_LAYER_THICKNESS;
    let top = ground;
    for (const [i, layer] of layers.entries()) {
      const where = `Layer ${i + 1}: `;
      const f = (key: string) => `layers.${i}.${key}`;
      const name = layerName(layer, i);
      if (names.has(name)) this.add(f("name"), `${where}the name "${name}" is used twice.`);
      else names.set(name, i);
      this.check(f("bottomLevel"), layer.bottomLevel, P.bottomLevel, where);
      const isLast = i === layers.length - 1;
      if (Number.isFinite(layer.bottomLevel)) {
        // (1e-9 m: a level typed at exactly the least distance is accepted, 30.2 − 29.8 being 0.3999…)
        if (layer.bottomLevel > top - thin + 1e-9) {
          this.add(f("bottomLevel"), `${where}the bottom level ${layer.bottomLevel} must be at least ${thin} m below the ${i === 0 ? "ground" : "layer above"} (${top}).`);
        }
        const avoid = options.avoid;
        if (avoid && !isLast && Math.abs(layer.bottomLevel - avoid.level) < thin - 1e-9) {
          this.add(f("bottomLevel"), `${where}the bottom level ${layer.bottomLevel} is within ${thin} m of ${avoid.text}; move it.`);
        }
      }
      top = layer.bottomLevel;
      const m = layer.material;
      this.check(f("gamma"), m.gamma, P.gamma, where);
      if (m.kind === "undrained" || m.kind === "undrained-increasing") this.check(f("su"), m.su, P.su, where);
      if (m.kind === "undrained-increasing") this.check(f("suRate"), m.suRate, P.suRate, where);
      if (m.kind === "drained") {
        this.check(f("c"), m.c, P.c, where);
        this.check(f("phi"), m.phi, P.phi, where);
      }
    }
    const r = options.reserved;
    if (r && names.has(r.name)) this.add(`layers.${names.get(r.name)}.name`, `A layer is named "${r.name}", which is ${r.what}.`);
  }

  /** A fill's values, its fields under `group` ("road.gamma", "fill.c"). */
  fill(fill: Fill, group: string, where: string, P: typeof FILL_PARAMETERS = FILL_PARAMETERS): void {
    this.check(`${group}.gamma`, fill.gamma, P.gamma, where);
    this.check(`${group}.c`, fill.c, P.c, where);
    this.check(`${group}.phi`, fill.phi, P.phi, where);
  }
}

export const fmt = (v: number) => String(Math.round(v * 100) / 100);

/**
 * The note when the model's base (the last layer's bottom, treated as firm
 * ground) is above the recommended level: in a soil that goes on deeper, a
 * deeper base can give a lower F (in uniform clay under a flat slope F
 * keeps falling with depth). Null when the base is deep enough.
 */
export function shallowBaseNote(base: number, recommended: number): string | null {
  if (!(base > recommended + 1e-9)) return null;
  return `The model ends at the last layer's bottom (${fmt(base)} m), treated as firm ground. If the soil continues deeper, enter its real bottom: a deeper base can give a lower F.`;
}

function strengthOf(material: LayerMaterial, top: number): Strength {
  switch (material.kind) {
    case "undrained":
      return { su: material.su, gamma: material.gamma };
    case "undrained-increasing":
      return { su: material.su, suRate: material.suRate, suLevel: top, gamma: material.gamma };
    case "drained":
      return { c: material.c, phi: material.phi, gamma: material.gamma };
    case "impenetrable":
      return { impenetrable: true, gamma: material.gamma };
  }
}

/** A layer's color in the document: only when the app would not give its material (the layers' come first) the same one. */
export function documentColor(layer: Layer, index: number): string | undefined {
  const color = layer.color ?? defaultLayerColor(index);
  return color === appMaterialColor(index) ? undefined : color;
}

/**
 * The layers' materials, in order (Su growing from each layer's top), and
 * one region assignment per layer at x, between its top and its bottom
 * (the last one's at its own bottom, the model's base), each with its
 * color when the app would show another. Returns the materials' names.
 */
export function addLayers(d: Definition, layers: Layer[], ground: number, x: number): string[] {
  const names = layers.map((layer, i) => d.addMaterial(layerName(layer, i), strengthOf(layer.material, i === 0 ? ground : layers[i - 1].bottomLevel), documentColor(layer, i)));
  let top = ground;
  for (const [i, layer] of layers.entries()) {
    d.assign(names[i], [x, (top + layer.bottomLevel) / 2] as Point);
    top = layer.bottomLevel;
  }
  return names;
}
