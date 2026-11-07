/** The templates the page offers, in order. */
import type { Template } from "./types";
import { excavationTemplate } from "./excavation";

export type { Template, ParameterDescription, ParameterDescriptions } from "./types";
export { excavationTemplate } from "./excavation";
export type { ExcavationParams, Layer, LayerMaterial, LayerKind, Road, Values } from "./excavation";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const TEMPLATES: Template<any>[] = [excavationTemplate];
