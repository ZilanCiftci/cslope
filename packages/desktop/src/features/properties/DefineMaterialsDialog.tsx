import { useState, useMemo } from "react";
import { useAppStore } from "../../store/app-store";
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
  LimeCementFields,
  createDefaultModel,
} from "./sections/material-forms";
import { PopupPanel } from "../../components/ui/PopupPanel";
import type { MaterialRow } from "../../store/types";
import { resolveParameters } from "../../utils/expression";

// ── Constants ──

const MODEL_KINDS: MaterialModelKind[] = [
  "mohr-coulomb",
  "undrained",
  "high-strength",
  "impenetrable",
  "spatial-mohr-coulomb",
  "anisotropic-function",
  "s-f-depth",
  "s-f-datum",
  "lime-cement-columns",
];

// ── Props ──

interface Props {
  onClose: () => void;
  mode?: "popup" | "window";
}

// ── Main dialog ──

export function DefineMaterialsDialog({ onClose, mode = "popup" }: Props) {
  const materials = useAppStore((s) => s.materials);
  const updateMaterial = useAppStore((s) => s.updateMaterial);
  const addMaterial = useAppStore((s) => s.addMaterial);
  const removeMaterial = useAppStore((s) => s.removeMaterial);
  const parameters = useAppStore((s) => s.parameters);

  const [selectedId, setSelectedId] = useState<string>(materials[0]?.id ?? "");
  // A material just switched to another model kind holds that kind's
  // defaults; its validation errors (e.g. no data points yet) are not shown
  // until the user edits any of its fields or selects another material.
  const [freshKindId, setFreshKindId] = useState<string | null>(null);

  const selected = materials.find((m) => m.id === selectedId) ?? materials[0];

  /** Select a material; leaving the one just switched shows its errors. */
  const selectMaterial = (id: string) => {
    if (id !== selected?.id) setFreshKindId(null);
    setSelectedId(id);
  };

  /** Edit a material's name or colour (an edit like any other). */
  const editMaterial = (id: string, patch: Partial<MaterialRow>) => {
    setFreshKindId((fresh) => (fresh === id ? null : fresh));
    updateMaterial(id, patch);
  };

  /** Resolve effective MaterialModel for a row. */
  const getModel = (mat: MaterialRow): MaterialModel => mat.model;

  /** Update the model field. */
  const setModel = (matId: string, model: MaterialModel) => {
    updateMaterial(matId, { model });
  };

  /** Patch model fields. */
  const patchModel = (
    matId: string,
    currentModel: MaterialModel,
    patch: Partial<MaterialModel>,
  ) => {
    const merged = { ...currentModel, ...patch } as MaterialModel;
    setFreshKindId(null);
    setModel(matId, merged);
  };

  /** Switch model kind — reset to defaults but keep unitWeight. */
  const switchKind = (
    matId: string,
    currentModel: MaterialModel,
    newKind: MaterialModelKind,
  ) => {
    const newModel = createDefaultModel(newKind, currentModel.unitWeight);
    if (currentModel.unitWeightSat !== undefined && newKind !== "impenetrable") {
      newModel.unitWeightSat = currentModel.unitWeightSat;
    }
    // Expressions belong to the old kind's fields; keep only γ, which
    // every kind has, or a stale expression would come back later.
    const mat = materials.find((m) => m.id === matId);
    const unitWeightExpr = mat?.modelExpressions?.unitWeight;
    updateMaterial(matId, {
      model: newModel,
      modelExpressions: unitWeightExpr ? { unitWeight: unitWeightExpr } : {},
    });
    setFreshKindId(matId);
  };

  const handleAdd = () => {
    addMaterial();
    // Select newly added material
    const newMats = useAppStore.getState().materials;
    const last = newMats[newMats.length - 1];
    if (last) selectMaterial(last.id);
  };

  const handleDelete = () => {
    if (materials.length <= 1 || !selected) return;
    // The shown material: selectedId can name a material that was replaced
    // (e.g. when the Materials window receives the main window's list).
    removeMaterial(selected.id);
    const remaining = useAppStore.getState().materials;
    if (remaining.length > 0) selectMaterial(remaining[0].id);
  };

  const model = selected ? getModel(selected) : undefined;
  const parameterValues = useMemo(
    () => resolveParameters(parameters).resolved,
    [parameters],
  );

  const patchModelExpression = (
    matId: string,
    field: string,
    expression: string | undefined,
  ) => {
    const material = materials.find((m) => m.id === matId);
    if (!material) return;

    setFreshKindId(null);
    const nextExpressions = { ...(material.modelExpressions ?? {}) };
    if (!expression || expression.trim().length === 0) {
      delete nextExpressions[field];
    } else {
      nextExpressions[field] = expression;
    }

    updateMaterial(matId, { modelExpressions: nextExpressions });
  };

  const body = (
    <>
      {/* Material list table + action buttons */}
      <div className="flex gap-3">
        <div
          className="flex-1 rounded border overflow-hidden"
          style={{ borderColor: "var(--color-vsc-border)" }}
        >
          <table className="w-full text-[11px]">
            <thead>
              <tr
                style={{
                  background: "var(--color-vsc-surface-tint)",
                  color: "var(--color-vsc-text-muted)",
                }}
              >
                <th className="text-left px-2 py-1.5 font-semibold">Name</th>
                <th className="text-left px-2 py-1.5 font-semibold">
                  Material model
                </th>
                <th className="text-center px-2 py-1.5 font-semibold w-12">
                  Color
                </th>
              </tr>
            </thead>
            <tbody>
              {materials.map((mat) => {
                const isSelected = mat.id === selected?.id;
                return (
                  <tr
                    key={mat.id}
                    onClick={() => selectMaterial(mat.id)}
                    className="cursor-pointer transition-colors"
                    style={{
                      background: isSelected
                        ? "var(--color-vsc-list-active)"
                        : "transparent",
                      color: isSelected
                        ? "var(--color-vsc-text-bright)"
                        : "var(--color-vsc-text)",
                    }}
                    onMouseEnter={(e) => {
                      if (!isSelected)
                        e.currentTarget.style.background =
                          "var(--color-vsc-list-hover)";
                    }}
                    onMouseLeave={(e) => {
                      if (!isSelected)
                        e.currentTarget.style.background = "transparent";
                    }}
                  >
                    <td className="px-2 py-1">
                      <input
                        type="text"
                        value={mat.name}
                        onChange={(e) =>
                          editMaterial(mat.id, { name: e.target.value })
                        }
                        onClick={(e) => e.stopPropagation()}
                        onFocus={() => selectMaterial(mat.id)}
                        className="w-full text-[11px]"
                        style={{ padding: "2px 6px", borderRadius: 4 }}
                        title="Material name (click to rename)"
                        aria-label="Material name"
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      {MATERIAL_MODEL_LABELS[getModel(mat).kind]}
                    </td>
                    <td className="px-2 py-1 text-center">
                      <input
                        type="color"
                        value={mat.color}
                        onChange={(e) =>
                          editMaterial(mat.id, { color: e.target.value })
                        }
                        onClick={(e) => e.stopPropagation()}
                        className="w-5 h-5 rounded border cursor-pointer bg-transparent p-0"
                        style={{ borderColor: "var(--color-vsc-border)" }}
                        aria-label={`Color for ${mat.name}`}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Action buttons */}
        <div className="flex flex-col gap-1.5">
          <DialogButton onClick={handleAdd}>Add</DialogButton>
          <DialogButton onClick={handleDelete} disabled={materials.length <= 1}>
            Delete
          </DialogButton>
        </div>
      </div>

      {/* ── Selected material detail ── */}
      {selected && model && (
        <div className="space-y-3">
          <div
            className="p-3 rounded space-y-3"
            style={{
              background: "var(--color-vsc-surface-tint)",
              border: "1px solid var(--color-vsc-border)",
            }}
          >
            {/* Model kind selector */}
            <div>
              <label className="block text-[10px] font-medium mb-1 opacity-70">
                Material model
              </label>
              <select
                value={model.kind}
                onChange={(e) =>
                  switchKind(
                    selected.id,
                    model,
                    e.target.value as MaterialModelKind,
                  )
                }
                className="w-full text-xs rounded px-2 py-1.5 border outline-none"
                style={{
                  background: "var(--color-vsc-input-bg)",
                  color: "var(--color-vsc-text)",
                  borderColor: "var(--color-vsc-border)",
                }}
              >
                {MODEL_KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {MATERIAL_MODEL_LABELS[kind]}
                  </option>
                ))}
              </select>
            </div>

            {/* Dynamic model fields */}
            <ModelFields
              model={model}
              onChange={(patch) => patchModel(selected.id, model, patch)}
              modelExpressions={selected.modelExpressions}
              parameterValues={parameterValues}
              onExpressionChange={(field, expression) =>
                patchModelExpression(selected.id, field, expression)
              }
            />

            {/* Inline validation errors */}
            {freshKindId !== selected.id && <ValidationErrors model={model} />}
          </div>
        </div>
      )}
    </>
  );

  if (mode === "window") {
    return (
      <div
        className="h-screen flex flex-col p-3"
        style={{
          background: "var(--color-vsc-bg)",
          color: "var(--color-vsc-text)",
        }}
      >
        <div className="pb-2">
          <h2 className="text-[12px] font-semibold">Define Materials</h2>
        </div>
        <div className="flex-1 overflow-y-auto space-y-3 pr-1">{body}</div>
        <div
          className="pt-3 mt-2 border-t"
          style={{ borderColor: "var(--color-vsc-border)" }}
        >
          <button
            onClick={onClose}
            className="w-full text-[11px] py-1 rounded cursor-pointer font-medium"
            style={{
              background: "var(--color-vsc-accent)",
              color: "#fff",
              border: "1px solid var(--color-vsc-accent)",
            }}
          >
            Close
          </button>
        </div>
      </div>
    );
  }

  return (
    <PopupPanel
      title="Define Materials"
      onClose={onClose}
      width={560}
      maxHeight="85vh"
      footer={
        <button
          onClick={onClose}
          className="flex-1 text-[11px] py-1 rounded cursor-pointer font-medium"
          style={{
            background: "var(--color-vsc-accent)",
            color: "#fff",
            border: "1px solid var(--color-vsc-accent)",
          }}
        >
          Close
        </button>
      }
    >
      {body}
    </PopupPanel>
  );
}

// ── Helpers ──

function DialogButton({
  onClick,
  disabled,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={disabled ? undefined : onClick}
      className="px-3 py-1.5 text-[11px] font-medium rounded border transition-colors cursor-pointer min-w-[64px]"
      style={{
        background: disabled ? "transparent" : "var(--color-vsc-surface-tint)",
        color: disabled
          ? "var(--color-vsc-text-muted)"
          : "var(--color-vsc-text)",
        borderColor: "var(--color-vsc-border)",
        opacity: disabled ? 0.5 : 1,
      }}
      aria-disabled={disabled}
    >
      {children}
    </button>
  );
}

/** Renders the appropriate field component for the given model kind. */
function ModelFields({
  model,
  onChange,
  modelExpressions,
  parameterValues,
  onExpressionChange,
}: {
  model: MaterialModel;
  onChange: (patch: Partial<MaterialModel>) => void;
  modelExpressions: MaterialRow["modelExpressions"] | undefined;
  parameterValues: Record<string, number>;
  onExpressionChange: (field: string, expression: string | undefined) => void;
}) {
  switch (model.kind) {
    case "mohr-coulomb":
      return (
        <MohrCoulombFields
          model={model}
          onChange={onChange as (p: Partial<typeof model>) => void}
          modelExpressions={modelExpressions}
          parameterValues={parameterValues}
          onExpressionChange={onExpressionChange}
        />
      );
    case "undrained":
      return (
        <UndrainedFields
          model={model}
          onChange={onChange as (p: Partial<typeof model>) => void}
          modelExpressions={modelExpressions}
          parameterValues={parameterValues}
          onExpressionChange={onExpressionChange}
        />
      );
    case "high-strength":
      return (
        <HighStrengthFields
          model={model}
          onChange={onChange as (p: Partial<typeof model>) => void}
          modelExpressions={modelExpressions}
          parameterValues={parameterValues}
          onExpressionChange={onExpressionChange}
        />
      );
    case "impenetrable":
      return (
        <ImpenetrableFields
          model={model}
          onChange={onChange as (p: Partial<typeof model>) => void}
          modelExpressions={modelExpressions}
          parameterValues={parameterValues}
          onExpressionChange={onExpressionChange}
        />
      );
    case "spatial-mohr-coulomb":
      return (
        <SpatialMCFields
          model={model}
          onChange={onChange as (p: Partial<typeof model>) => void}
          modelExpressions={modelExpressions}
          parameterValues={parameterValues}
          onExpressionChange={onExpressionChange}
        />
      );
    case "anisotropic-function":
      return (
        <AnisotropicFields
          model={model}
          onChange={onChange as (p: Partial<typeof model>) => void}
          modelExpressions={modelExpressions}
          parameterValues={parameterValues}
          onExpressionChange={onExpressionChange}
        />
      );
    case "s-f-depth":
      return (
        <SfDepthFields
          model={model}
          onChange={onChange as (p: Partial<typeof model>) => void}
          modelExpressions={modelExpressions}
          parameterValues={parameterValues}
          onExpressionChange={onExpressionChange}
        />
      );
    case "s-f-datum":
      return (
        <SfDatumFields
          model={model}
          onChange={onChange as (p: Partial<typeof model>) => void}
          modelExpressions={modelExpressions}
          parameterValues={parameterValues}
          onExpressionChange={onExpressionChange}
        />
      );
    case "lime-cement-columns":
      return (
        <LimeCementFields
          model={model}
          onChange={onChange as (p: Partial<typeof model>) => void}
          modelExpressions={modelExpressions}
          parameterValues={parameterValues}
          onExpressionChange={onExpressionChange}
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
