/**
 * ResultSidebar — right sidebar for result view settings.
 *
 * Controls surface display mode, FOS filtering, and annotations.
 */

import { useAppStore } from "../../store/app-store";
import { Section } from "../../components/ui/Section";
import { Label } from "../../components/ui/Label";

// ── ResultSidebar ─────────────────────────────────────────────

export function ResultSidebar() {
  const result = useAppStore((s) => s.result);
  const rvs = useAppStore((s) => s.resultViewSettings);
  const removeAnnotation = useAppStore((s) => s.removeAnnotation);
  const selectedAnnotationIds = useAppStore((s) => s.selectedAnnotationIds);
  const setSelectedAnnotations = useAppStore((s) => s.setSelectedAnnotations);
  const toggleAnnotationSelection = useAppStore(
    (s) => s.toggleAnnotationSelection,
  );

  return (
    <div
      className="h-full overflow-y-auto"
      style={{
        background: "var(--color-vsc-panel)",
        color: "var(--color-vsc-text)",
        borderLeft: "1px solid var(--color-vsc-border)",
      }}
    >
      {/* ── Summary ────────────────────────────────────── */}
      <Section title="Summary" defaultOpen sectionKey="result:Summary">
        {result ? (
          <div className="space-y-1 text-[12px]">
            <div className="flex justify-between">
              <Label>Min FOS</Label>
              <span
                className="font-bold tabular-nums"
                style={{
                  color:
                    result.minFOS < 1.0
                      ? "var(--color-vsc-error)"
                      : result.minFOS < 1.5
                        ? "var(--color-vsc-warning)"
                        : "var(--color-vsc-success)",
                }}
              >
                {result.minFOS.toFixed(3)}
              </span>
            </div>
            <div className="flex justify-between">
              <Label>Max FOS</Label>
              <span className="tabular-nums">{result.maxFOS.toFixed(3)}</span>
            </div>
            <div className="flex justify-between">
              <Label>Method</Label>
              <span>{result.method}</span>
            </div>
            <div className="flex justify-between">
              <Label>Surfaces</Label>
              <span className="tabular-nums">{result.allSurfaces.length}</span>
            </div>
            <div className="flex justify-between">
              <Label>Elapsed</Label>
              <span className="tabular-nums">
                {result.elapsedMs.toFixed(0)} ms
              </span>
            </div>
            {typeof result.criticalPushingMoment === "number" && (
              <div className="flex justify-between">
                <Label>Pushing Moment</Label>
                <span className="tabular-nums">
                  {result.criticalPushingMoment.toFixed(3)} kN m
                </span>
              </div>
            )}
            {typeof result.criticalResistingMoment === "number" && (
              <div className="flex justify-between">
                <Label>Resisting Moment</Label>
                <span className="tabular-nums">
                  {result.criticalResistingMoment.toFixed(3)} kN m
                </span>
              </div>
            )}
            {typeof result.criticalSlipVolume === "number" && (
              <div className="flex justify-between">
                <Label>Slip Volume</Label>
                <span className="tabular-nums">
                  {result.criticalSlipVolume.toFixed(3)} m^3/m
                </span>
              </div>
            )}
            {result.criticalSurface && (
              <div
                className="mt-2 p-2 rounded text-[11px]"
                style={{ background: "var(--color-vsc-list-hover)" }}
              >
                <p
                  className="font-medium mb-1"
                  style={{ color: "var(--color-vsc-text-bright)" }}
                >
                  Critical Surface
                </p>
                <p>
                  Centre: ({result.criticalSurface.cx.toFixed(2)},{" "}
                  {result.criticalSurface.cy.toFixed(2)})
                </p>
                <p>Radius: {result.criticalSurface.radius.toFixed(2)} m</p>
              </div>
            )}
          </div>
        ) : (
          <p
            className="text-[12px]"
            style={{ color: "var(--color-vsc-text-muted)" }}
          >
            No results yet.
          </p>
        )}
      </Section>

      {/* ── Annotations ────────────────────────────────── */}
      <Section title="Annotations" sectionKey="result:Annotations">
        <div className="space-y-2">
          {rvs.annotations.length === 0 && (
            <p
              className="text-[11px]"
              style={{ color: "var(--color-vsc-text-muted)" }}
            >
              No annotations yet.
            </p>
          )}

          {rvs.annotations.map((anno) => {
            const isSelected = selectedAnnotationIds.includes(anno.id);
            return (
              <div
                key={anno.id}
                className="flex items-center gap-2 p-1.5 rounded cursor-pointer select-none"
                style={{
                  background: isSelected
                    ? "var(--color-vsc-list-active)"
                    : "var(--color-vsc-list-hover)",
                  outline: isSelected
                    ? "1px solid var(--color-vsc-focus-border)"
                    : "none",
                }}
                onClick={(e) => {
                  if (e.ctrlKey || e.metaKey) {
                    toggleAnnotationSelection(anno.id, true);
                  } else {
                    setSelectedAnnotations([anno.id]);
                  }
                }}
              >
                <span
                  className="text-[11px] flex-1 min-w-0 truncate"
                  style={{ color: "var(--color-vsc-text)" }}
                >
                  {anno.type === "color-bar"
                    ? "Color Bar"
                    : anno.type === "material-table"
                      ? "Material Table"
                      : "Text"}
                </span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    removeAnnotation(anno.id);
                  }}
                  className="text-[11px] px-1.5 py-0.5 rounded cursor-pointer"
                  style={{
                    color: "var(--color-vsc-error)",
                    background: "transparent",
                    border: "none",
                  }}
                  title="Remove annotation"
                >
                  ×
                </button>
              </div>
            );
          })}
        </div>
      </Section>
    </div>
  );
}
