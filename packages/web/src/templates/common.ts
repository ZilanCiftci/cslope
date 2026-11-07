/**
 * What the templates share: the ground in horizontal layers under a level
 * ground surface, a drained fill (the excavation's road, the embankment),
 * characteristic or design values (B4), the model's extent, and the checks
 * of these, each problem with its field. No strength has a default (B5).
 */
import type { PartialFactors, SafetyClass } from "@cslope/engine";
import type { Definition, Point, Strength } from "./builder";
import { swedishPartialFactors } from "./partial-factors";
import type { ParameterDescription } from "./types";

/** A parameter's bounds (the tests draw values within them). */
export type ParameterDescriptionLike = Pick<ParameterDescription, "min" | "max" | "step">;

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
      gamma: number;
      /** The unit weight below the water (kN/m³); not set: `gamma`. */
      gammaSat?: number;
      c: number;
      phi: number;
    }
  | { kind: "impenetrable"; gamma: number };

export type LayerKind = LayerMaterial["kind"];

export interface Layer {
  /** The name in the results; default "Layer n". */
  name?: string;
  /** The elevation of the layer's bottom (m). The last layer goes on down to the model's base when that is deeper (a note says so). */
  bottomLevel: number;
  material: LayerMaterial;
}

/** A drained fill above the ground: the excavation's working road, the embankment. */
export interface Fill {
  gamma: number;
  /** The unit weight below the water (kN/m³); not set: `gamma`. */
  gammaSat?: number;
  c: number;
  phi: number;
}

/** Characteristic values (F a factor of safety) or design values (F an over-design factor). */
export type Values =
  | { basis: "characteristic" }
  | { basis: "design"; safetyClass: SafetyClass; etaCu: number; etaDrained: number; variableLoadBase: number };

/** A problem of a parameter set, with the field it is about. */
export interface FieldProblem {
  /**
   * The field: a key of the parameters ("excavationDepth"), of a layer
   * ("layers.0.su"), of a group ("road.width", the road's fill
   * "road.gamma", the embankment's "fill.c") or of the design values
   * ("values.etaCu"); "layers" for the list.
   */
  field: string;
  /** The sentence the form shows. */
  message: string;
}

export const p = (name: string, label: string, unit: string | null, min: number, max: number, step: number, description: string): ParameterDescription => ({
  name,
  label,
  unit,
  min,
  max,
  step,
  description,
});

export const GROUND_LEVEL = p("groundLevel", "Ground level (m)", "m", -100, 1000, 0.1, "The elevation of the ground surface; the levels of the layers and the water are elevations too.");
export const SLOPE = p("slope", "Slope 1:n", null, 0.5, 5, 0.1, "n horizontal per 1 vertical: 1:2 is flatter than 1:1.");
export const WATER_LEVEL = p("waterLevel", "Ground-water level (m)", "m", -100, 1000, 0.1, "The elevation of the ground water, cut at the ground; leave out for a dry slope.");

/** A layer's fields. */
export const LAYER_PARAMETERS = {
  bottomLevel: p("bottomLevel", "Bottom level (m)", "m", -100, 1000, 0.1, "The elevation of the layer's bottom. A layer is at least 0.05 m thick."),
  gamma: p("gamma", "Unit weight γ (kN/m³)", "kN/m³", 10, 25, 0.1, "Above the water, and below it for clay and rock."),
  gammaSat: p("gammaSat", "Saturated unit weight γsat (kN/m³)", "kN/m³", 10, 25, 0.1, "Below the water, for a drained layer; γ when left out."),
  su: p("su", "Su (kPa)", "kPa", 1, 500, 0.5, "The undrained shear strength; for a growing profile, its value at the top of the layer."),
  suRate: p("suRate", "Su increase (kPa/m)", "kPa/m", 0, 10, 0.1, "The growth of Su per meter below the top of the layer (by elevation)."),
  c: p("c", "c′ (kPa)", "kPa", 0, 100, 0.5, "The effective cohesion."),
  phi: p("phi", "φ′ (°)", "°", 5, 45, 0.5, "The effective friction angle."),
};

/** A fill's fields (drained). */
export const FILL_PARAMETERS = {
  gamma: p("gamma", "Fill unit weight γ (kN/m³)", "kN/m³", 15, 24, 0.1, "Above the water."),
  gammaSat: p("gammaSat", "Fill saturated unit weight γsat (kN/m³)", "kN/m³", 15, 24, 0.1, "Below the water; γ when left out."),
  c: p("c", "Fill c′ (kPa)", "kPa", 0, 20, 0.5, "The effective cohesion of the fill."),
  phi: p("phi", "Fill φ′ (°)", "°", 25, 45, 0.5, "The effective friction angle of the fill."),
};

/** The design values' fields. */
export const DESIGN_PARAMETERS = {
  etaCu: p("etaCu", "η undrained", null, 0.5, 1.2, 0.05, "The conversion factor on Su: γcu = 1.5 / η."),
  etaDrained: p("etaDrained", "η drained", null, 0.5, 1.2, 0.05, "The conversion factor on c′ and tan φ′: γc′ = γφ′ = 1.3 / η."),
  variableLoadBase: p("variableLoadBase", "γQ / γd", null, 1, 1.5, 0.1, "γQ = this factor × γd: variable loads Q_d = γQ γd Q_k, γd = 0.83, 0.91, 1.0 in safety class 1, 2, 3. The governing document decides γQ."),
};

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

const within = (v: number, d: ParameterDescription) => Number.isFinite(v) && v >= d.min && v <= d.max;

/** Collects the problems of a parameter set. */
export class Problems {
  readonly list: FieldProblem[] = [];

  add(field: string, message: string): void {
    this.list.push({ field, message });
  }

  /** A value out of its bounds, with `where` before the label ("Layer 1: "). */
  check(field: string, v: number, d: ParameterDescription, where = ""): void {
    if (!within(v, d)) this.add(field, `${where}${d.label} must be from ${d.min} to ${d.max}${d.unit ? ` ${d.unit}` : ""}.`);
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
        if (m.gammaSat !== undefined) this.check(f("gammaSat"), m.gammaSat, P.gammaSat, where);
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
    if (fill.gammaSat !== undefined) this.check(`${group}.gammaSat`, fill.gammaSat, P.gammaSat, where);
    this.check(`${group}.c`, fill.c, P.c, where);
    this.check(`${group}.phi`, fill.phi, P.phi, where);
  }

  /** The design values: the safety class and the factors. */
  values(values: Values): void {
    if (values.basis !== "design") return;
    if (![1, 2, 3].includes(values.safetyClass)) this.add("values.safetyClass", "The safety class must be 1, 2 or 3.");
    this.check("values.etaCu", values.etaCu, DESIGN_PARAMETERS.etaCu);
    this.check("values.etaDrained", values.etaDrained, DESIGN_PARAMETERS.etaDrained);
    this.check("values.variableLoadBase", values.variableLoadBase, DESIGN_PARAMETERS.variableLoadBase);
  }
}

export const fmt = (v: number) => String(Math.round(v * 100) / 100);

/** The note when the last layer goes on below its bottom level, down to the model's base; null when it does not. */
export function lastLayerNote(layers: Layer[], base: number, why: string): string | null {
  const i = layers.length - 1;
  const last = layers[i];
  if (!last || !(last.bottomLevel > base)) return null;
  return `${layerName(last, i)} goes on below its bottom level ${fmt(last.bottomLevel)} m, down to ${fmt(base)} m, ${why}: the model needs that depth.`;
}

function strengthOf(material: LayerMaterial, top: number): Strength {
  switch (material.kind) {
    case "undrained":
      return { su: material.su, gamma: material.gamma };
    case "undrained-increasing":
      return { su: material.su, suRate: material.suRate, suLevel: top, gamma: material.gamma };
    case "drained":
      return { c: material.c, phi: material.phi, gamma: material.gamma, gammaSat: material.gammaSat };
    case "impenetrable":
      return { impenetrable: true, gamma: material.gamma };
  }
}

/**
 * The layers' materials, in order (Su growing from each layer's top), and
 * one region assignment per layer at x, between its top and its bottom
 * (the last one's at the model's base). Returns the materials' names.
 */
export function addLayers(d: Definition, layers: Layer[], ground: number, base: number, x: number): string[] {
  const names = layers.map((layer, i) => d.addMaterial(layerName(layer, i), strengthOf(layer.material, i === 0 ? ground : layers[i - 1].bottomLevel)));
  let top = ground;
  for (const [i, layer] of layers.entries()) {
    const bottom = i === layers.length - 1 ? base : layer.bottomLevel;
    d.assign(names[i], [x, (top + bottom) / 2] as Point);
    top = layer.bottomLevel;
  }
  return names;
}

/** The partial factors of a parameter set, or null on characteristic values. */
export function partialFactorsOf(values: Values): PartialFactors | null {
  if (values.basis !== "design") return null;
  const { safetyClass, etaCu, etaDrained, variableLoadBase } = values;
  return swedishPartialFactors({ safetyClass, etaCu, etaDrained, variableLoadBase });
}
