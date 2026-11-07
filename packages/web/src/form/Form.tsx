/**
 * The excavation template's form, rendered from its parameter
 * descriptions (EXCAVATION_PARAMETERS): one field per parameter, with its
 * unit in the label, its description as the tooltip and its problem under
 * it. Groups: Geometry, Layers, Water, Working road, Safety.
 */
import { useId, type ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ParameterDescription } from "@/templates/types";
import { EXCAVATION_PARAMETERS as P } from "@/templates/excavation";
import { emptyLayer, LAYER_FIELDS, LAYER_KINDS, newRoad, OPTIONAL_FIELDS, type Draft, type LayerDraft, type RoadDraft } from "./draft";

export interface FormProps {
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

function Field({ label, title, error, children, id }: { label: string; title?: string; error?: string; children: ReactNode; id: string }) {
  return (
    // Three rows of the form's grid (label, input, problem), so that the
    // inputs of a row line up when one label wraps to two lines.
    <div className="row-span-3 grid min-w-0 grid-rows-subgrid gap-0 pb-2">
      <label htmlFor={id} title={title} className="mb-1 block self-end text-xs text-muted-foreground">
        {label}
      </label>
      {children}
      <div>{error && <ErrorText id={`${id}-error`}>{error}</ErrorText>}</div>
    </div>
  );
}

interface NumberFieldProps {
  field: string;
  desc: ParameterDescription;
  value: string;
  onChange: (value: string) => void;
  errors: Map<string, string>;
  /** The placeholder of an optional field: what empty means. */
  empty?: string;
}

function NumberField({ field, desc, value, onChange, errors, empty }: NumberFieldProps) {
  const id = useId();
  const error = errors.get(field);
  const optional = OPTIONAL_FIELDS.has(field.slice(field.lastIndexOf(".") + 1));
  return (
    <Field id={id} label={desc.label} title={desc.description} error={error}>
      <input
        id={id}
        name={field}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        spellCheck={false}
        className={inputClass}
        value={value}
        placeholder={optional ? empty : "Required"}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
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

/** A row of exclusive choices: toggle buttons with aria-pressed. */
function Choices<T extends string>({ label, options, value, onChange }: { label: string; options: { value: T; label: string }[]; value: T | ""; onChange: (v: T) => void }) {
  return (
    <div role="group" aria-label={label} className="inline-flex rounded-md border border-input p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className="h-7 rounded-sm px-3 text-sm text-muted-foreground hover:text-foreground aria-pressed:bg-primary aria-pressed:text-primary-foreground"
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

const grid = "grid grid-cols-2 gap-x-3";

function LayerFields({ layer, index, count, onChange, onRemove, errors }: { layer: LayerDraft; index: number; count: number; onChange: (l: LayerDraft) => void; onRemove: () => void; errors: Map<string, string> }) {
  const nameId = useId();
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
        <Field id={nameId} label="Name" title="The name in the drawing and the results; Layer n when left out." error={nameError}>
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
          <select id={kindId} className={inputClass} value={layer.kind} onChange={(e) => onChange({ ...layer, kind: e.target.value as LayerDraft["kind"] })}>
            {LAYER_KINDS.map((k) => (
              <option key={k.kind} value={k.kind}>
                {k.label}
              </option>
            ))}
          </select>
        </Field>
        <NumberField
          field={f("bottomLevel")}
          desc={last ? { ...P.layer.bottomLevel, description: `${P.layer.bottomLevel.description} The last layer goes on down to the model's base when that is deeper.` } : P.layer.bottomLevel}
          value={layer.bottomLevel}
          onChange={(v) => onChange({ ...layer, bottomLevel: v })}
          errors={errors}
        />
        {LAYER_FIELDS[layer.kind].map((k) => (
          <NumberField key={k} field={f(k)} desc={P.layer[k]} value={layer[k]} onChange={(v) => onChange({ ...layer, [k]: v })} errors={errors} empty="As γ" />
        ))}
      </div>
    </li>
  );
}

export function Form({ draft, onChange, errors, notes }: FormProps) {
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => onChange({ ...draft, [key]: value });
  const num = (key: "groundLevel" | "excavationDepth" | "slope" | "bottomWidth" | "tensionCrackDepth" | "waterLevel", empty?: string) => (
    <NumberField field={key} desc={P[key]} value={draft[key]} onChange={(v) => set(key, v)} errors={errors} empty={empty} />
  );
  const setLayer = (i: number, layer: LayerDraft) => set("layers", draft.layers.map((l, j) => (j === i ? layer : l)));
  const addLayer = () => {
    const last = Number(draft.layers[draft.layers.length - 1]?.bottomLevel.replace(",", "."));
    set("layers", [...draft.layers, emptyLayer(Number.isFinite(last) ? String(Math.round((last - 5) * 10) / 10) : "")]);
  };
  const road = draft.road;
  const setRoad = (key: keyof RoadDraft, value: string) => road && set("road", { ...road, [key]: value });
  const roadId = useId();
  const layersError = errors.get("layers");

  return (
    <form aria-label="Parameters" className="space-y-4" onSubmit={(e) => e.preventDefault()} noValidate>
      <Group title="Geometry" className="border-t-0 pt-0">
        <div className={grid}>
          {num("groundLevel")}
          {num("excavationDepth")}
          {num("slope")}
          {num("bottomWidth", "As needed")}
          {num("tensionCrackDepth", "None")}
        </div>
      </Group>

      <Group title="Layers">
        <p className="mb-2 text-xs text-muted-foreground">From the top down; the first starts at the ground.</p>
        <ol className="space-y-2">
          {draft.layers.map((layer, i) => (
            <LayerFields
              key={i}
              layer={layer}
              index={i}
              count={draft.layers.length}
              onChange={(l) => setLayer(i, l)}
              onRemove={() => set("layers", draft.layers.filter((_, j) => j !== i))}
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

      <Group title="Water">
        <div className={grid}>{num("waterLevel", "Dry")}</div>
      </Group>

      <Group title="Working road">
        <div className="flex items-center gap-2">
          <input id={roadId} type="checkbox" className="h-4 w-4 accent-primary" checked={road !== null} onChange={(e) => set("road", e.target.checked ? newRoad() : null)} />
          <label htmlFor={roadId} className="text-sm" title="A fill on the ground behind the crest, with its own material and an optional traffic load.">
            Working road behind the crest
          </label>
        </div>
        {road && (
          <div className={cn(grid, "mt-3")}>
            {(["distanceFromCrest", "width", "height", "gamma", "gammaSat", "c", "phi", "trafficLoad"] as const).map((k) => (
              <NumberField key={k} field={`road.${k}`} desc={P.road[k]} value={road[k]} onChange={(v) => setRoad(k, v)} errors={errors} empty={k === "trafficLoad" ? "None" : "As γ"} />
            ))}
          </div>
        )}
      </Group>

      <Group title="Safety">
        <Choices
          label="F as"
          value={draft.basis}
          onChange={(b) => set("basis", b)}
          options={[
            { value: "characteristic", label: "Factor of safety" },
            { value: "design", label: "Over-design factor" },
          ]}
        />
        <p className="mt-2 text-xs text-muted-foreground">
          {draft.basis === "design"
            ? "F on design values, with the Swedish partial factors of the safety class and η."
            : "F on characteristic values, without partial factors."}
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
                <NumberField key={k} field={`values.${k}`} desc={P.design[k]} value={draft[k]} onChange={(v) => set(k, v)} errors={errors} />
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
