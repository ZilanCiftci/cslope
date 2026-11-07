/**
 * What a template is: parameters with their bounds, which the form
 * renders from, and `toDocument`, which turns a parameter set into the
 * engine's analysis document. Pure TypeScript: no DOM, only the engine's
 * types, so that the templates run under Bun in the tests.
 */
import type { AnalysisDocument } from "../engine/document";

/** A numeric parameter as the form shows it. */
export interface ParameterDescription {
  /** The key in the parameter set. */
  name: string;
  /** The label, with the unit in parentheses: "Excavation depth H (m)". */
  label: string;
  /** The unit, or null for a pure number. */
  unit: string | null;
  min: number;
  max: number;
  /** The step of the field, which is also the precision shown. */
  step: number;
  /** What it is, in one or two sentences (a tooltip). */
  description: string;
}

/** The parameters of a template: scalars, and groups of them (a layer, a road). */
export type ParameterDescriptions = Record<string, ParameterDescription | Record<string, ParameterDescription>>;

export interface Template<P> {
  /** A stable id, the key of the template in the page's address. */
  id: string;
  /** The title, sentence case. */
  title: string;
  /** One or two sentences on what the template models. */
  description: string;
  params: ParameterDescriptions;
  /**
   * What stops a parameter set from being built (a level out of order, a
   * missing strength), as sentences for the form; empty when it can be.
   */
  problems(params: P): string[];
  /** The same problems, each with the field it is about (a key path such as "layers.0.su"). */
  fieldProblems(params: P): { field: string; message: string }[];
  /**
   * What the model does that the parameters do not say (a layer extended,
   * a bottom widened), as sentences the form shows beside them; they do
   * not stop the analysis.
   */
  notes(params: P): string[];
  /** The analysis document of a parameter set `problems` accepts. */
  toDocument(params: P): AnalysisDocument;
}
