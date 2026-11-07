/**
 * A template's form, rendered from its spec (specs.ts) and its parameter
 * descriptions: one field per parameter, with its unit in the label, its
 * description as the tooltip and its problem under it. The template's
 * groups (Geometry, Water, Working road, Embankment) around the Layers,
 * then Safety.
 */
import { useEffect, useId, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ParameterDescription } from "@/templates/types";
import { DESIGN_PARAMETERS, LAYER_PARAMETERS } from "@/templates/common";
import { emptyLayer, emptyText, LAYER_FIELDS, nextBottomLevel, LAYER_KINDS, withGroup, type Draft, type LayerDraft } from "./draft";
import { descOf, type AnySpec, type GroupSpec } from "./specs";

export interface FormProps {
  /** The template's spec: its groups and fields. */
  spec: AnySpec;
  draft: Draft;
  onChange: (draft: Draft) => void;
  /** The problem of each field, by key ("layers.0.su"). */
  errors: Map<string, string>;
  /** Sentences on what the model does that the fields do not say. */
  notes: string[];
}

const inputClass = "h-8 w-full rounded-md border border-input bg-background px-2 text-sm tabular placeholder:text-muted-foreground/80 aria-[invalid=true]:border-destructive";

/** The text of a problem: red in both themes, readable on the page's background. */
export function ErrorText({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <p id={id} className="mt-1 text-xs text-destructive dark:text-signal">
      {children}
    </p>
  );
}

function Field({ label, title, error, hint, children, id }: { label: string; title?: string; error?: string; hint?: string; children: ReactNode; id: string }) {
  return (
    // Three rows of the form's grid (label, input, problem), so that the
    // inputs of a row line up when one label wraps to two lines.
    <div className="row-span-3 grid min-w-0 grid-rows-subgrid gap-0 pb-2">
      <label htmlFor={id} title={title} className="mb-1 block self-end text-xs text-muted-foreground">
        {label}
      </label>
      {children}
      <div>
        {error && <ErrorText id={`${id}-error`}>{error}</ErrorText>}
        {hint && !error && (
          <p id={`${id}-hint`} className="mt-1 text-[11px] leading-snug text-muted-foreground">
            {hint}
          </p>
        )}
        {/* The whole description, for screen readers (the label's tooltip shows it with a mouse). */}
        {title && (
          <span id={`${id}-desc`} className="sr-only">
            {title}
          </span>
        )}
      </div>
    </div>
  );
}

interface NumberFieldProps {
  field: string;
  desc: ParameterDescription;
  value: string;
  onChange: (value: string) => void;
  errors: Map<string, string>;
}

/**
 * Short hints shown under the fields whose meaning is not plain from the
 * label (the whole description is the label's tooltip and is read by
 * screen readers).
 */
const HINTS: Record<string, string> = {
  slope: "Horizontal per 1 vertical.",
  waterLevel: "An elevation; empty for a dry slope.",
  bottomLevel: "An elevation, not a depth.",
  suRate: "Per meter below the layer's top.",
  distanceFromCrest: "To the near edge of the road's top.",
  etaCu: "γcu = 1.5 / η.",
  etaDrained: "γc′ = γφ′ = 1.3 / η.",
  variableLoadBase: "γQ = this factor × γd.",
};

/** The ids an input is described by: its problem or hint, and its description. */
const describedBy = (id: string, error: unknown, hint: unknown, title: unknown) =>
  [error ? `${id}-error` : hint ? `${id}-hint` : null, title ? `${id}-desc` : null].filter(Boolean).join(" ") || undefined;

function NumberField({ field, desc, value, onChange, errors }: NumberFieldProps) {
  const id = useId();
  const error = errors.get(field);
  const key = field.slice(field.lastIndexOf(".") + 1);
  const empty = emptyText(field);
  const hint = HINTS[key];
  return (
    <Field id={id} label={desc.label} title={desc.description} error={error} hint={hint}>
      <input
        id={id}
        name={field}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        spellCheck={false}
        className={inputClass}
        value={value}
        placeholder={empty ?? "Required"}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, error, hint, desc.description)}
        onChange={(e) => onChange(e.target.value)}
      />
    </Field>
  );
}

function Group({ title, children, className }: { title: string; children: ReactNode; className?: string }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className={cn("border-t pt-4", className)}>
      <h2 id={id} className="mb-3 text-[10px] font-bold uppercase tracking-[0.08em] text-muted-foreground">
        {title}
      </h2>
      {children}
    </section>
  );
}

/** A row of exclusive choices: toggle buttons with aria-pressed. With `wrap`, a long label wraps within its button (on a phone). */
export function Choices<T extends string>({
  label,
  labelledBy,
  options,
  value,
  onChange,
  wrap,
}: {
  /** The group's name; or `labelledBy`, the id of a visible label. */
  label?: string;
  labelledBy?: string;
  options: { value: T; label: string }[];
  value: T | "";
  onChange: (v: T) => void;
  wrap?: boolean;
}) {
  return (
    <div role="group" aria-label={labelledBy ? undefined : label} aria-labelledby={labelledBy} className="inline-flex rounded-md border border-input p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "rounded-sm px-3 text-sm text-muted-foreground hover:text-foreground aria-pressed:bg-primary aria-pressed:text-primary-foreground",
            wrap ? "min-h-7 py-1 leading-snug" : "h-7",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

const grid = "grid grid-cols-2 gap-x-3";

/** The id of a layer's name field, which gets the focus when the layer is added or the one after it removed. */
const nameIdOf = (layer: LayerDraft) => `${layer.key}-name`;

interface LayerFieldsProps {
  layer: LayerDraft;
  index: number;
  count: number;
  /** The template's description of a layer's bottom level. */
  bottomLevel: ParameterDescription;
  onChange: (l: LayerDraft) => void;
  onRemove: () => void;
  errors: Map<string, string>;
}

function LayerFields({ layer, index, count, bottomLevel, onChange, onRemove, errors }: LayerFieldsProps) {
  const nameId = nameIdOf(layer);
  const kindId = useId();
  const f = (k: string) => `layers.${index}.${k}`;
  const last = index === count - 1;
  const nameError = errors.get(f("name"));
  return (
    <li className="rounded-md border p-3">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-medium">Layer {index + 1}</h3>
        {count > 1 && (
          <button type="button" onClick={onRemove} aria-label={`Remove layer ${index + 1}`} title="Remove the layer" className="grid h-6 w-6 place-items-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground">
            <X className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden="true" />
          </button>
        )}
      </div>
      <div className={grid}>
        <Field id={nameId} label="Name" error={nameError}>
          <input
            id={nameId}
            type="text"
            maxLength={40}
            className={inputClass}
            value={layer.name}
            placeholder={`Layer ${index + 1}`}
            aria-invalid={nameError ? true : undefined}
            aria-describedby={nameError ? `${nameId}-error` : undefined}
            onChange={(e) => onChange({ ...layer, name: e.target.value })}
          />
        </Field>
        <Field id={kindId} label="Kind" title="Su constant and Su increasing (with depth) are undrained; drained has c′ and φ′; rock is impenetrable. The kind sets the fields.">
          <select id={kindId} aria-describedby={`${kindId}-desc`} className={inputClass} value={layer.kind} onChange={(e) => onChange({ ...layer, kind: e.target.value as LayerDraft["kind"] })}>
            {LAYER_KINDS.map((k) => (
              <option key={k.kind} value={k.kind}>
                {k.label}
              </option>
            ))}
          </select>
        </Field>
        <NumberField
          field={f("bottomLevel")}
          desc={last ? { ...bottomLevel, description: `${bottomLevel.description} The last layer goes on down to the model's base when that is deeper.` } : bottomLevel}
          value={layer.bottomLevel}
          onChange={(v) => onChange({ ...layer, bottomLevel: v })}
          errors={errors}
        />
        {LAYER_FIELDS[layer.kind].map((k) => (
          <NumberField key={k} field={f(k)} desc={LAYER_PARAMETERS[k]} value={layer[k]} onChange={(v) => onChange({ ...layer, [k]: v })} errors={errors} />
        ))}
      </div>
    </li>
  );
}

/** One of the template's groups; an optional one behind a checkbox. */
function TemplateGroup({ spec, group, draft, onChange, errors }: { spec: AnySpec; group: GroupSpec; draft: Draft; onChange: (d: Draft) => void; errors: Map<string, string> }) {
  const toggleId = useId();
  const on = !group.toggle || draft.on.includes(group.id);
  const fields = (
    <div className={cn(grid, group.toggle && "mt-3")}>
      {group.keys.map((k) => (
        <NumberField key={k} field={k} desc={descOf(spec, k)} value={draft.fields[k] ?? ""} onChange={(v) => onChange({ ...draft, fields: { ...draft.fields, [k]: v } })} errors={errors} />
      ))}
    </div>
  );
  return (
    <Group title={group.title} className={group.id === spec.before[0]?.id ? "border-t-0 pt-0" : undefined}>
      {group.toggle && (
        <div className="flex items-center gap-2">
          <input id={toggleId} type="checkbox" className="h-4 w-4 accent-primary" checked={on} onChange={(e) => onChange(withGroup(draft, group.id, e.target.checked))} />
          <label htmlFor={toggleId} className="text-sm" title={group.toggle.title}>
            {group.toggle.label}
          </label>
        </div>
      )}
      {on && fields}
    </Group>
  );
}

export function Form({ spec, draft, onChange, errors, notes }: FormProps) {
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => onChange({ ...draft, [key]: value });
  const setLayer = (i: number, layer: LayerDraft) => set("layers", draft.layers.map((l, j) => (j === i ? layer : l)));
  // After adding or removing a layer, the focus goes to a layer's name (not lost on the page).
  const focus = useRef<string | null>(null);
  useEffect(() => {
    if (!focus.current) return;
    document.getElementById(focus.current)?.focus();
    focus.current = null;
  });
  const setFocus = (id: string) => {
    focus.current = id;
  };
  const addLayer = () => {
    const layer = emptyLayer(nextBottomLevel(draft.layers));
    set("layers", [...draft.layers, layer]);
    setFocus(nameIdOf(layer));
  };
  const removeLayer = (i: number) => {
    const layers = draft.layers.filter((_, j) => j !== i);
    set("layers", layers);
    setFocus(nameIdOf(layers[Math.max(0, i - 1)]));
  };
  const layersError = errors.get("layers");
  const bottomLevel = (spec.template.params.layer as Record<string, ParameterDescription>).bottomLevel;
  const groups = (list: GroupSpec[]) => list.map((g) => <TemplateGroup key={g.id} spec={spec} group={g} draft={draft} onChange={onChange} errors={errors} />);

  return (
    <form aria-label="Parameters" className="space-y-4" onSubmit={(e) => e.preventDefault()} noValidate>
      {groups(spec.before)}

      <Group title="Layers">
        <p className="mb-2 text-xs text-muted-foreground">From the top down; the first starts at the ground.</p>
        <ol className="space-y-2">
          {draft.layers.map((layer, i) => (
            <LayerFields
              key={layer.key}
              layer={layer}
              index={i}
              count={draft.layers.length}
              bottomLevel={bottomLevel}
              onChange={(l) => setLayer(i, l)}
              onRemove={() => removeLayer(i)}
              errors={errors}
            />
          ))}
        </ol>
        {layersError && <ErrorText>{layersError}</ErrorText>}
        {draft.layers.length < 12 && (
          <button type="button" onClick={addLayer} className="mt-2 text-sm text-primary underline-offset-4 hover:underline">
            + Add layer
          </button>
        )}
      </Group>

      {groups(spec.after)}

      <Group title="Safety">
        <Choices
          label="Values"
          value={draft.basis}
          onChange={(b) => set("basis", b)}
          options={[
            { value: "characteristic", label: "Characteristic values" },
            { value: "design", label: "Design values" },
          ]}
        />
        <p className="mt-2 text-xs text-muted-foreground">
          {draft.basis === "design"
            ? "F is an over-design factor: on design values, with the Swedish partial factors of the safety class and η."
            : "F is a factor of safety: on characteristic values, without partial factors."}
        </p>
        {draft.basis === "design" && (
          <div className="mt-3 space-y-2">
            <div>
              <p className="mb-1 text-xs text-muted-foreground">
                Safety class
              </p>
              <Choices
                label="Safety class"
                value={draft.safetyClass as "1" | "2" | "3" | ""}
                onChange={(c) => set("safetyClass", c)}
                options={[
                  { value: "1", label: "1" },
                  { value: "2", label: "2" },
                  { value: "3", label: "3" },
                ]}
              />
              {errors.get("values.safetyClass") && <ErrorText>{errors.get("values.safetyClass")}</ErrorText>}
            </div>
            <div className={grid}>
              {(["etaCu", "etaDrained", "variableLoadBase"] as const).map((k) => (
                <NumberField key={k} field={`values.${k}`} desc={DESIGN_PARAMETERS[k]} value={draft[k]} onChange={(v) => set(k, v)} errors={errors} />
              ))}
            </div>
          </div>
        )}
      </Group>

      {notes.length > 0 && (
        <ul className="space-y-1 border-t pt-3 text-xs text-muted-foreground">
          {notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
    </form>
  );
}
