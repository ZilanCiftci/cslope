import type { ParameterDef } from "../../store/types";
import { resolveParameters } from "../../utils/expression";
import {
  ANNOTATION_TAGS,
  formatNumber,
  type AnnotationTagContext,
} from "./resolveAnnotationText";

/** One entry of the menu: a tag to insert, what it is and its current value. */
export interface VariableItem {
  /** Inserted text, with the `#`. */
  insert: string;
  description: string;
  /** The current value, when the model has one. */
  preview: string | null;
  /** Listed under the project information heading. */
  group?: "project";
}

/** The menu's entries: every built-in tag, then the model's parameters. */
export function variableItems(
  ctx: AnnotationTagContext,
  parameters: ParameterDef[] = [],
): VariableItem[] {
  const { resolved } = resolveParameters(parameters);
  const has = (name: string) =>
    Object.prototype.hasOwnProperty.call(resolved, name);
  const items: VariableItem[] = ANNOTATION_TAGS.map((t) => ({
    insert: `#${t.tag}`,
    description: t.description,
    // A parameter of the same name wins on the sheet.
    preview: has(t.tag) ? formatNumber(resolved[t.tag]) : t.value(ctx),
    ...(t.group ? { group: t.group } : {}),
  }));
  const listed = new Set(items.map((it) => it.insert));
  for (const p of parameters) {
    // Only names a `#` tag can reach, each once.
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(p.name)) continue;
    if (listed.has(`#${p.name}`)) continue;
    listed.add(`#${p.name}`);
    items.push({
      insert: `#${p.name}`,
      description: "Parameter",
      preview: has(p.name) ? formatNumber(resolved[p.name]) : null,
    });
  }
  return items;
}

/**
 * `insert` in place of text[start, end), with the caret after it. A space
 * follows when the next character would otherwise extend the tag's name.
 */
export function insertAtCaret(
  text: string,
  start: number,
  end: number,
  insert: string,
): { text: string; caret: number } {
  const s = Math.max(0, Math.min(start, text.length));
  const e = Math.max(s, Math.min(end, text.length));
  const after = text.slice(e);
  const sep = /^[a-zA-Z0-9_]/.test(after) ? " " : "";
  return {
    text: text.slice(0, s) + insert + sep + after,
    caret: s + insert.length + sep.length,
  };
}
