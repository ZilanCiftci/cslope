import { useAppStore } from "../../../store/app-store";
import { Section } from "../../../components/ui/Section";
import { Label } from "../../../components/ui/Label";

interface CustomSearchPlanesSectionProps {
  plain?: boolean;
}

export function CustomSearchPlanesSection({
  plain = false,
}: CustomSearchPlanesSectionProps) {
  const planes = useAppStore((s) => s.customSearchPlanes);
  const customPlanesOnly = useAppStore((s) => s.customPlanesOnly);
  const addPlane = useAppStore((s) => s.addCustomSearchPlane);
  const updatePlane = useAppStore((s) => s.updateCustomSearchPlane);
  const removePlane = useAppStore((s) => s.removeCustomSearchPlane);
  const setCustomPlanesOnly = useAppStore((s) => s.setCustomPlanesOnly);

  const content = (
    <>
      <div
        className="text-[10px] mb-1.5"
        style={{ color: "var(--color-vsc-text-muted)" }}
      >
        Define specific circular failure surfaces to analyse.
      </div>
      {planes.length > 0 && (
        <label className="flex items-center gap-2 text-[12px] mb-1.5">
          <input
            type="checkbox"
            checked={customPlanesOnly}
            onChange={(e) => setCustomPlanesOnly(e.target.checked)}
            className="accent-blue-500"
          />
          Custom planes only (skip random search)
        </label>
      )}
      {planes.map((p) => {
        const radiusInvalid = p.radius <= 0;
        return (
          <div key={p.id} className="flex items-end gap-1 text-[12px]">
            <label className="flex flex-col">
              <Label>cx</Label>
              <input
                type="number"
                step="0.5"
                value={p.cx}
                onChange={(e) =>
                  updatePlane(p.id, { cx: parseFloat(e.target.value) || 0 })
                }
                className="w-16"
                aria-label="Circle centre X"
              />
            </label>
            <label className="flex flex-col">
              <Label>cy</Label>
              <input
                type="number"
                step="0.5"
                value={p.cy}
                onChange={(e) =>
                  updatePlane(p.id, { cy: parseFloat(e.target.value) || 0 })
                }
                className="w-16"
                aria-label="Circle centre Y"
              />
            </label>
            <label className="flex flex-col">
              <Label>R</Label>
              <input
                type="number"
                step="0.5"
                min="0.1"
                value={p.radius}
                onChange={(e) =>
                  updatePlane(p.id, {
                    radius: parseFloat(e.target.value) || 0,
                  })
                }
                onBlur={(e) => {
                  const v = parseFloat(e.target.value);
                  if (!Number.isFinite(v) || v <= 0) {
                    updatePlane(p.id, { radius: 0.1 });
                  }
                }}
                aria-invalid={radiusInvalid}
                style={
                  radiusInvalid
                    ? { borderColor: "var(--color-vsc-error)" }
                    : undefined
                }
                className="w-16"
                aria-label="Circle radius"
              />
            </label>
            <button
              onClick={() => removePlane(p.id)}
              className="w-5 h-5 flex items-center justify-center rounded hover:bg-red-500/20 hover:text-red-400 cursor-pointer transition-colors"
              style={{ color: "var(--color-vsc-text-muted)", fontSize: "10px" }}
              aria-label="Remove search plane"
            >
              ✕
            </button>
          </div>
        );
      })}
      <button
        onClick={addPlane}
        className="text-[11px] mt-1 cursor-pointer hover:underline font-medium"
        style={{ color: "var(--color-vsc-accent)" }}
      >
        + Add Search Plane
      </button>
    </>
  );

  if (plain) {
    return <div className="space-y-2.5">{content}</div>;
  }

  return <Section title="Custom Search Planes">{content}</Section>;
}
