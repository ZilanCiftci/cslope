import { useMemo } from "react";
import { useAppStore } from "../../../store/app-store";
import { Section } from "../../../components/ui/Section";
import {
  MATERIAL_MODEL_LABELS,
  validateMaterialModel,
  type MaterialModel,
  type MaterialModelKind,
} from "@cslope/engine";
import {
  MohrCoulombFields,
  UndrainedFields,
  HighStrengthFields,
  ImpenetrableFields,
  SpatialMCFields,
  AnisotropicFields,
  SfDepthFields,
  SfDatumFields,
  createDefaultModel,
} from "./material-forms";

/** All valid model kinds for the dropdown, in display order. */
const MODEL_KINDS: MaterialModelKind[] = [
  "mohr-coulomb",
  "undrained",
  "high-strength",
  "impenetrable",
  "spatial-mohr-coulomb",
  "anisotropic-function",
  "s-f-depth",
  "s-f-datum",
];

export function MaterialsSection() {
  const materials = useAppStore((s) => s.materials);
  const updateMaterial = useAppStore((s) => s.updateMaterial);
  const addMaterial = useAppStore((s) => s.addMaterial);
  const removeMaterial = useAppStore((s) => s.removeMaterial);

  /** Resolve the effective MaterialModel for a row. */
  const getModel = (mat: (typeof materials)[number]): MaterialModel =>
    mat.model;

  /** Update the model field. */
  const setModel = (matId: string, model: MaterialModel) => {
    updateMaterial(matId, { model });
  };

  /** Patch a subset of the current material's model. */
  const patchModel = (
    matId: string,
    currentModel: MaterialModel,
    patch: Partial<MaterialModel>,
  ) => {
    const merged = { ...currentModel, ...patch } as MaterialModel;
    setModel(matId, merged);
  };

  /** Switch model kind — reset to defaults but keep unitWeight. */
  const switchKind = (
    matId: string,
    currentModel: MaterialModel,
    newKind: MaterialModelKind,
  ) => {
    const newModel = createDefaultModel(newKind, currentModel.unitWeight);
    setModel(matId, newModel);
  };

  return (
    <Section title="Materials">
      {materials.map((mat) => {
        const model = getModel(mat);
        return (
          <div
            key={mat.id}
            className="p-2.5 rounded-md space-y-2"
            style={{
              background: "var(--color-vsc-surface-tint)",
              border: "1px solid var(--color-vsc-border)",
            }}
          >
            {/* Header: colour picker + name + remove */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={mat.color}
                  onChange={(e) =>
                    updateMaterial(mat.id, { color: e.target.value })
                  }
                  className="w-5 h-5 border-0 cursor-pointer bg-transparent rounded"
                  aria-label={`${mat.name} colour`}
                />
                <input
                  type="text"
                  value={mat.name}
                  onChange={(e) =>
                    updateMaterial(mat.id, { name: e.target.value })
                  }
                  className="bg-transparent border-none text-[12px] font-medium w-24 outline-none"
                  style={{ color: "var(--color-vsc-text-bright)" }}
                  aria-label="Material name"
                />
              </div>
              {materials.length > 1 && (
                <button
                  onClick={() => removeMaterial(mat.id)}
                  className="w-5 h-5 flex items-center justify-center rounded hover:bg-red-500/20 hover:text-red-400 cursor-pointer transition-colors"
                  style={{
                    color: "var(--color-vsc-text-muted)",
                    fontSize: "10px",
                  }}
                  aria-label={`Remove ${mat.name}`}
                >
                  ✕
                </button>
              )}
            </div>

            {/* Model kind selector */}
            <select
              value={model.kind}
              onChange={(e) =>
                switchKind(mat.id, model, e.target.value as MaterialModelKind)
              }
              className="w-full text-[11px] rounded px-1.5 py-1 border outline-none"
              style={{
                background: "var(--color-vsc-input-bg)",
                color: "var(--color-vsc-text)",
                borderColor: "var(--color-vsc-border)",
              }}
              aria-label="Model type"
            >
              {MODEL_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {MATERIAL_MODEL_LABELS[kind]}
                </option>
              ))}
            </select>

            {/* Dynamic model fields */}
            <ModelFields
              model={model}
              onChange={(patch) => patchModel(mat.id, model, patch)}
            />

            {/* Inline validation errors */}
            <ValidationErrors model={model} />
          </div>
        );
      })}
      <button
        onClick={addMaterial}
        className="text-[11px] mt-1 cursor-pointer hover:underline font-medium"
        style={{ color: "var(--color-vsc-accent)" }}
      >
        + Add Material
      </button>
    </Section>
  );
}

/** Renders the appropriate field component for the given model kind. */
function ModelFields({
  model,
  onChange,
}: {
  model: MaterialModel;
  onChange: (patch: Partial<MaterialModel>) => void;
}) {
  switch (model.kind) {
    case "mohr-coulomb":
      return (
        <MohrCoulombFields
          model={model}
          onChange={onChange as (p: Partial<typeof model>) => void}
        />
      );
    case "undrained":
      return (
        <UndrainedFields
          model={model}
          onChange={onChange as (p: Partial<typeof model>) => void}
        />
      );
    case "high-strength":
      return (
        <HighStrengthFields
          model={model}
          onChange={onChange as (p: Partial<typeof model>) => void}
        />
      );
    case "impenetrable":
      return (
        <ImpenetrableFields
          model={model}
          onChange={onChange as (p: Partial<typeof model>) => void}
        />
      );
    case "spatial-mohr-coulomb":
      return (
        <SpatialMCFields
          model={model}
          onChange={onChange as (p: Partial<typeof model>) => void}
        />
      );
    case "anisotropic-function":
      return (
        <AnisotropicFields
          model={model}
          onChange={onChange as (p: Partial<typeof model>) => void}
        />
      );
    case "s-f-depth":
      return (
        <SfDepthFields
          model={model}
          onChange={onChange as (p: Partial<typeof model>) => void}
        />
      );
    case "s-f-datum":
      return (
        <SfDatumFields
          model={model}
          onChange={onChange as (p: Partial<typeof model>) => void}
        />
      );
  }
}

/** Shows validation errors for the current model, if any. */
function ValidationErrors({ model }: { model: MaterialModel }) {
  const errors = useMemo(() => validateMaterialModel(model), [model]);
  if (errors.length === 0) return null;

  return (
    <ul
      className="text-[10px] list-none p-1.5 rounded space-y-0.5"
      style={{
        color: "var(--color-vsc-error, #f44747)",
        background:
          "color-mix(in srgb, var(--color-vsc-error, #f44747) 8%, transparent)",
        border:
          "1px solid color-mix(in srgb, var(--color-vsc-error, #f44747) 30%, transparent)",
      }}
      role="alert"
      aria-label="Validation errors"
    >
      {errors.map((err) => (
        <li key={err}>⚠ {err}</li>
      ))}
    </ul>
  );
}
