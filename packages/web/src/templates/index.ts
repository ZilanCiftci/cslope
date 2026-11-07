/** The templates the page offers, in order. */
import type { Template } from "./types";
import { excavationTemplate } from "./excavation";
import { embankmentTemplate } from "./embankment";

export type { Template, ParameterDescription, ParameterDescriptions } from "./types";
export { excavationTemplate } from "./excavation";
export { embankmentTemplate } from "./embankment";
export type { ExcavationParams, Road } from "./excavation";
export type { EmbankmentParams } from "./embankment";
export type { FieldProblem, Fill, Layer, LayerMaterial, LayerKind } from "./common";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const TEMPLATES: Template<any>[] = [excavationTemplate, embankmentTemplate];
