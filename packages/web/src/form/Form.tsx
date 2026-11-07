/**
 * A template's form, rendered from its spec (specs.ts) and its parameter
 * descriptions: one field per parameter, with its unit in the label, its
 * description as the tooltip and its problem under it. The template's
 * groups (Geometry, Water, Haul road, Embankment) around the Layers,
 * then Safety.
 */
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight, CircleAlert, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ParameterDescription } from "@/templates/types";
import { DESIGN_PARAMETERS, LAYER_PARAMETERS } from "@/templates/common";
import { emptyLayer, emptyText, formState, LAYER_FIELDS, nextBottomLevel, LAYER_KINDS, parseNumber, strengthSummary, withGroup, type Draft, type LayerDraft } from "./draft";
import { descOf, type AnySpec, type GroupSpec } from "./specs";

export interface FormProps {
  /** The template's spec: its groups and fields. */
  spec: AnySpec;
  draft: Draft;
  onChange: (draft: Draft) => void;
  /** The problem of each field, by key ("layers.0.su"). */
  errors: Map<string, string>;
  /** The required fields that are empty, by key: a layer's header says so. */
  missing?: string[];
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
  bottomWidth: "Empty for a wide excavation; set for a trench with the same slope on both sides.",
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

/** The id of a layer's name field, which gets the focus when the layer is added. */
const nameIdOf = (layer: LayerDraft) => `${layer.key}-name`;
/** The id of a layer's header button, which gets the focus when the layer after it is removed. */
const headerIdOf = (layer: LayerDraft) => `${layer.key}-header`;

/** The fields of a layer, by key ("layers.0.su"), the name and the bottom level included. */
const layerKeys = (layer: LayerDraft, index: number) => ["name", "bottomLevel", ...LAYER_FIELDS[layer.kind]].map((k) => `layers.${index}.${k}`);

interface LayerFieldsProps {
  layer: LayerDraft;
  index: number;
  count: number;
  /** The template's description of a layer's bottom level. */
  bottomLevel: ParameterDescription;
  open: boolean;
  onToggle: () => void;
  onChange: (l: LayerDraft) => void;
  onRemove: () => void;
  errors: Map<string, string>;
  missing: ReadonlySet<string>;
}

/**
 * A layer as a row of the accordion: its header (always shown) names it,
 * its model, its bottom and its strength, and marks a problem or an empty
 * required field; its fields show when it is open.
 */
function LayerFields({ layer, index, count, bottomLevel, open, onToggle, onChange, onRemove, errors, missing }: LayerFieldsProps) {
  const nameId = nameIdOf(layer);
  const panelId = `${layer.key}-fields`;
  const kindId = useId();
  const f = (k: string) => `layers.${index}.${k}`;
  const last = index === count - 1;
  const nameError = errors.get(f("name"));
  const keys = layerKeys(layer, index);
  const problem = keys.some((k) => errors.has(k));
  const required = !problem && keys.some((k) => missing.has(k));
  const model = LAYER_KINDS.find((k) => k.kind === layer.kind)?.label ?? "";
  const bottom = layer.bottomLevel.trim();
  const details = [model, bottom && `bottom ${bottom} m`, strengthSummary(layer)].filter(Boolean).join(" · ");
  return (
    <li className="rounded-md border">
      <div className="flex items-start">
        <h3 className="min-w-0 flex-1 text-sm">
          <button
            id={headerIdOf(layer)}
            type="button"
            aria-expanded={open}
            aria-controls={panelId}
            onClick={onToggle}
            className="flex w-full min-w-0 items-start gap-2 rounded-md px-3 py-2 text-left hover:bg-accent/60"
          >
            {open ? (
              <ChevronDown className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" strokeWidth={1.75} aria-hidden="true" />
            ) : (
              <ChevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" strokeWidth={1.75} aria-hidden="true" />
            )}
            <span className="min-w-0 flex-1">
              <span className="flex items-baseline justify-between gap-2">
                <span className="truncate font-medium">{layer.name.trim() || `Layer ${index + 1}`}</span>
                {problem && (
                  <span className="flex shrink-0 items-center gap-1 text-xs text-destructive dark:text-signal">
                    <CircleAlert className="h-3.5 w-3.5 self-center" strokeWidth={1.75} aria-hidden="true" />
                    Problem
                  </span>
                )}
                {required && <span className="shrink-0 text-xs text-muted-foreground">Required</span>}
              </span>
              {details && <span className="mt-0.5 block text-xs text-muted-foreground">{details}</span>}
            </span>
          </button>
        </h3>
        {count > 1 && (
          <button type="button" onClick={onRemove} aria-label={`Remove layer ${index + 1}`} title="Remove the layer" className="mt-1.5 mr-1.5 grid h-6 w-6 shrink-0 place-items-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground">
            <X className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden="true" />
          </button>
        )}
      </div>
      {open && (
        <div id={panelId} role="group" aria-labelledby={headerIdOf(layer)} className={cn(grid, "px-3 pt-1 pb-1")}>
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
          <Field id={kindId} label="Material model" title="Undrained: Su, constant or increasing with depth. Mohr-Coulomb: c′ and φ′ (drained). Impenetrable (bedrock): no slip surface passes through it. The model sets the fields.">
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
            desc={last ? { ...bottomLevel, description: `${bottomLevel.description} The model ends at the last layer's bottom, treated as firm ground.` } : bottomLevel}
            value={layer.bottomLevel}
            onChange={(v) => onChange({ ...layer, bottomLevel: v })}
            errors={errors}
          />
          {LAYER_FIELDS[layer.kind].map((k) => (
            <NumberField key={k} field={f(k)} desc={LAYER_PARAMETERS[k]} value={layer[k]} onChange={(v) => onChange({ ...layer, [k]: v })} errors={errors} />
          ))}
        </div>
      )}
    </li>
  );
}

/**
 * Whether water above the ground stands as ponded (free) water: shown once
 * a level is entered; its hint says when the level is below all the ground,
 * where it does nothing.
 */
function PondedField({ spec, draft, params, onChange }: { spec: AnySpec; draft: Draft; params: unknown; onChange: (ponded: boolean) => void }) {
  const id = useId();
  const level = parseNumber(draft.fields.waterLevel ?? "");
  if (level === null || Number.isNaN(level)) return null;
  const ground = spec.lowestGround(params);
  const below = Number.isFinite(ground) && level <= ground;
  const hint = below ? `No effect at this level: it is below the ${spec.template.id === "excavation" ? "excavation bottom" : "ground"}.` : spec.pondedHint;
  return (
    <div className="mt-1">
      <div className="flex items-center gap-2">
        <input id={id} type="checkbox" className="h-4 w-4 accent-primary" checked={draft.ponded} aria-describedby={`${id}-hint`} onChange={(e) => onChange(e.target.checked)} />
        <label htmlFor={id} className="text-sm">
          Free water above ground (ponding)
        </label>
      </div>
      <p id={`${id}-hint`} className="mt-1 text-[11px] leading-snug text-muted-foreground">
        {hint}
      </p>
    </div>
  );
}

/** One of the template's groups; an optional one behind a checkbox. */
function TemplateGroup({ spec, group, draft, onChange, errors, children }: { spec: AnySpec; group: GroupSpec; draft: Draft; onChange: (d: Draft) => void; errors: Map<string, string>; children?: ReactNode }) {
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
      {children}
    </Group>
  );
}

export function Form({ spec, draft, onChange, errors, missing = [], notes }: FormProps) {
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => onChange({ ...draft, [key]: value });
  const params = useMemo(() => formState(draft).params, [draft]);
  const setLayer = (i: number, layer: LayerDraft) => set("layers", draft.layers.map((l, j) => (j === i ? layer : l)));
  // One layer open at a time: on a first visit the first, when it has empty required fields.
  const [openKey, setOpenKey] = useState<string | null>(() => {
    const first = draft.layers[0];
    return first && layerKeys(first, 0).some((k) => missing.includes(k)) ? first.key : null;
  });
  const missingSet = new Set(missing);
  // After adding a layer, the focus goes to its name; after removing one, to the header of the one before (not lost on the page).
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
    setOpenKey(layer.key);
    setFocus(nameIdOf(layer));
  };
  const removeLayer = (i: number) => {
    const layers = draft.layers.filter((_, j) => j !== i);
    set("layers", layers);
    setFocus(headerIdOf(layers[Math.max(0, i - 1)]));
  };
  const layersError = errors.get("layers");
  const bottomLevel = (spec.template.params.layer as Record<string, ParameterDescription>).bottomLevel;
  const groups = (list: GroupSpec[]) =>
    list.map((g) => (
      <TemplateGroup key={g.id} spec={spec} group={g} draft={draft} onChange={onChange} errors={errors}>
        {g.id === "water" && <PondedField spec={spec} draft={draft} params={params} onChange={(ponded) => set("ponded", ponded)} />}
      </TemplateGroup>
    ));

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
              open={openKey === layer.key}
              onToggle={() => setOpenKey(openKey === layer.key ? null : layer.key)}
              onChange={(l) => setLayer(i, l)}
              onRemove={() => removeLayer(i)}
              errors={errors}
              missing={missingSet}
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
