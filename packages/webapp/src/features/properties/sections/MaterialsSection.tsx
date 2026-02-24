import { useAppStore } from "../../../store/app-store";
import { Section } from "../../../components/ui/Section";
import { Label } from "../../../components/ui/Label";

export function MaterialsSection() {
  const materials = useAppStore((s) => s.materials);
  const updateMaterial = useAppStore((s) => s.updateMaterial);
  const addMaterial = useAppStore((s) => s.addMaterial);
  const removeMaterial = useAppStore((s) => s.removeMaterial);

  return (
    <Section title="Materials">
      {materials.map((mat) => (
        <div
          key={mat.id}
          className="p-2.5 rounded-md space-y-2"
          style={{
            background: "var(--color-vsc-surface-tint)",
            border: "1px solid var(--color-vsc-border)",
          }}
        >
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
          <div className="grid grid-cols-3 gap-2">
            <label className="flex flex-col gap-0.5">
              <Label>γ (kN/m³)</Label>
              <input
                type="number"
                step="0.5"
                value={mat.unitWeight}
                onChange={(e) =>
                  updateMaterial(mat.id, {
                    unitWeight: parseFloat(e.target.value) || 0,
                  })
                }
              />
            </label>
            <label className="flex flex-col gap-0.5">
              <Label>φ (°)</Label>
              <input
                type="number"
                step="1"
                value={mat.frictionAngle}
                onChange={(e) =>
                  updateMaterial(mat.id, {
                    frictionAngle: parseFloat(e.target.value) || 0,
                  })
                }
              />
            </label>
            <label className="flex flex-col gap-0.5">
              <Label>c (kPa)</Label>
              <input
                type="number"
                step="0.5"
                value={mat.cohesion}
                onChange={(e) =>
                  updateMaterial(mat.id, {
                    cohesion: parseFloat(e.target.value) || 0,
                  })
                }
              />
            </label>
          </div>
        </div>
      ))}
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
