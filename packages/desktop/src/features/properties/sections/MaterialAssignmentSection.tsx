import { useMemo } from "react";
import { useAppStore } from "../../../store/app-store";
import { computeRegions, regionCentroid } from "../../../utils/regions";
import { Section } from "../../../components/ui/Section";

export function MaterialAssignmentSection() {
  const materials = useAppStore((s) => s.materials);
  const materialBoundaries = useAppStore((s) => s.materialBoundaries);
  const regionMaterials = useAppStore((s) => s.regionMaterials);
  const setRegionMaterial = useAppStore((s) => s.setRegionMaterial);
  const coordinates = useAppStore((s) => s.coordinates);
  const selectedRegionKey = useAppStore((s) => s.selectedRegionKey);
  const setSelectedRegionKey = useAppStore((s) => s.setSelectedRegionKey);

  const defaultMatId = materials[0]?.id ?? "";

  const regions = useMemo(
    () =>
      computeRegions(
        coordinates,
        materialBoundaries,
        regionMaterials,
        defaultMatId,
      ).map((r, i) => {
        const [cx, cy] = regionCentroid(r.px, r.py);
        return { ...r, index: i + 1, cx, cy };
      }),
    [coordinates, materialBoundaries, regionMaterials, defaultMatId],
  );

  return (
    <Section title="Material Assignment">
      {regions.length === 0 ? (
        <div
          className="text-[11px]"
          style={{ color: "var(--color-vsc-text-muted)" }}
        >
          Define exterior boundary points first.
        </div>
      ) : (
        <div className="space-y-2">
          <div
            className="text-[11px] mb-1"
            style={{ color: "var(--color-vsc-text-muted)" }}
          >
            Click a region on the canvas to select it.
          </div>
          {regions.map((r) => {
            const currentMatId = regionMaterials[r.regionKey] ?? defaultMatId;
            const currentMat = materials.find((m) => m.id === currentMatId);
            const isSelected = selectedRegionKey === r.regionKey;
            return (
              <div
                key={r.regionKey}
                className="p-2 rounded-md flex items-center gap-2 cursor-pointer transition-colors"
                style={{
                  background: isSelected
                    ? "var(--color-vsc-selected-bg)"
                    : "var(--color-vsc-surface-tint)",
                  border: isSelected
                    ? "1px solid var(--color-vsc-accent)"
                    : "1px solid var(--color-vsc-border)",
                }}
                onClick={() =>
                  setSelectedRegionKey(isSelected ? null : r.regionKey)
                }
              >
                <div
                  className="w-3.5 h-3.5 rounded-sm shrink-0"
                  style={{
                    background: currentMat?.color ?? "#888",
                    border: "1px solid var(--color-vsc-swatch-border)",
                  }}
                />
                <div className="flex-1 min-w-0">
                  <div
                    className="text-[11px] font-medium"
                    style={{ color: "var(--color-vsc-text-bright)" }}
                  >
                    Region {r.index}
                  </div>
                  <div
                    className="text-[10px]"
                    style={{ color: "var(--color-vsc-text-muted)" }}
                  >
                    ({r.cx.toFixed(1)}, {r.cy.toFixed(1)})
                  </div>
                </div>
                <select
                  value={currentMatId}
                  onChange={(e) => {
                    e.stopPropagation();
                    setRegionMaterial(r.regionKey, e.target.value);
                  }}
                  onClick={(e) => e.stopPropagation()}
                  className="text-[11px] px-1.5 py-0.5 rounded cursor-pointer"
                  style={{
                    background: "var(--color-vsc-input-bg)",
                    color: "var(--color-vsc-text)",
                    border: "1px solid var(--color-vsc-border)",
                  }}
                  aria-label={`Material for Region ${r.index}`}
                >
                  {materials.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </div>
            );
          })}
        </div>
      )}
    </Section>
  );
}
