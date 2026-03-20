/**
 * ResultSidebar — right sidebar for result view settings.
 *
 * Controls surface display mode, FOS filtering, annotations, and export.
 */

import { useAppStore } from "../../store/app-store";
import { exportVectorPdf } from "../pdf/pdf-export";
import { computePaperFrame, computeInnerFrame } from "../view/paper";
import { Section } from "../../components/ui/Section";
import { Label } from "../../components/ui/Label";

// ── ResultSidebar ─────────────────────────────────────────────

export function ResultSidebar() {
  const result = useAppStore((s) => s.result);
  const rvs = useAppStore((s) => s.resultViewSettings);
  const setRvs = useAppStore((s) => s.setResultViewSettings);
  const addAnnotation = useAppStore((s) => s.addAnnotation);
  const updateAnnotation = useAppStore((s) => s.updateAnnotation);
  const removeAnnotation = useAppStore((s) => s.removeAnnotation);

  const inputStyle: React.CSSProperties = {
    background: "var(--color-vsc-input-bg)",
    border: "1px solid var(--color-vsc-border)",
    color: "var(--color-vsc-text)",
    borderRadius: 4,
    padding: "3px 6px",
    fontSize: 12,
  };

  const btnStyle: React.CSSProperties = {
    background: "var(--color-vsc-list-hover)",
    border: "1px solid var(--color-vsc-border)",
    color: "var(--color-vsc-text)",
    borderRadius: 4,
    padding: "4px 8px",
    fontSize: 11,
    cursor: "pointer",
  };

  const getInnerFrameWorldBounds = (
    state: ReturnType<typeof useAppStore.getState>,
  ): { xMin: number; xMax: number; yMin: number; yMax: number } | undefined => {
    if (state.resultViewScale <= 0) return undefined;
    const canvas = document.querySelector<HTMLCanvasElement>(
      "[data-testid='slope-canvas']",
    );
    if (!canvas) return undefined;

    const rect = canvas.getBoundingClientRect();
    const { paperSize, landscape, zoom, offsetX, offsetY } =
      state.resultViewSettings.paperFrame;
    const pf = computePaperFrame(
      rect.width,
      rect.height,
      paperSize,
      landscape,
      zoom ?? 1,
      offsetX ?? 0,
      offsetY ?? 0,
    );
    const inner = computeInnerFrame(pf);

    const vs = state.resultViewScale;
    const [ox, oy] = state.resultViewOffset;

    const xMin = (inner.x - rect.width / 2) / vs - ox;
    const xMax = (inner.x + inner.w - rect.width / 2) / vs - ox;
    const yMax = -(inner.y - rect.height / 2) / vs - oy;
    const yMin = -(inner.y + inner.h - rect.height / 2) / vs - oy;

    return { xMin, xMax, yMin, yMax };
  };

  const handleExportPng = () => {
    const canvas = document.querySelector<HTMLCanvasElement>(
      "[data-testid='slope-canvas']",
    );
    if (!canvas) return;

    const dpr = window.devicePixelRatio || 1;
    const { paperFrame } = useAppStore.getState().resultViewSettings;
    const cssW = canvas.width / dpr;
    const cssH = canvas.height / dpr;
    const pf = computePaperFrame(
      cssW,
      cssH,
      paperFrame.paperSize,
      paperFrame.landscape,
      paperFrame.zoom ?? 1,
      paperFrame.offsetX ?? 0,
      paperFrame.offsetY ?? 0,
    );

    // Crop to the paper frame area (in device pixels)
    const sx = pf.x * dpr;
    const sy = pf.y * dpr;
    const sw = pf.w * dpr;
    const sh = pf.h * dpr;

    const exportCanvas = document.createElement("canvas");
    exportCanvas.width = sw;
    exportCanvas.height = sh;
    const ctx = exportCanvas.getContext("2d")!;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, sw, sh);
    ctx.drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);

    const link = document.createElement("a");
    link.download = "slope-analysis.png";
    link.href = exportCanvas.toDataURL("image/png");
    link.click();
  };

  const handleExportPdf = () => {
    const state = useAppStore.getState();
    if (!state.result) return;

    // Compute visible world bounds to match on-screen view in the PDF
    const vl = state.resultViewSettings.viewLock;
    let viewBounds:
      | { xMin: number; xMax: number; yMin: number; yMax: number }
      | undefined;
    if (vl) {
      viewBounds = {
        xMin: vl.bottomLeft[0],
        xMax: vl.topRight[0],
        yMin: vl.bottomLeft[1],
        yMax: vl.topRight[1],
      };
    } else {
      // Derive bounds from the visible inner paper frame (plot area), not full canvas.
      viewBounds = getInnerFrameWorldBounds(state);
    }

    exportVectorPdf({
      coordinates: state.coordinates,
      materials: state.materials,
      materialBoundaries: state.materialBoundaries,
      regionMaterials: state.regionMaterials,
      result: state.result,
      resultViewSettings: state.resultViewSettings,
      piezometricLine: state.piezometricLine,
      udls: state.udls,
      lineLoads: state.lineLoads,
      analysisLimits: state.analysisLimits,
      orientation: state.orientation,
      projectInfo: state.projectInfo,
      parameters: state.parameters,
      viewBounds,
    });
  };

  return (
    <div
      className="h-full overflow-y-auto"
      style={{
        background: "var(--color-vsc-panel)",
        color: "var(--color-vsc-text)",
        borderLeft: "1px solid var(--color-vsc-border)",
      }}
    >
      {/* Header */}
      <div
        className="px-4 py-2.5 text-[10px] font-bold uppercase tracking-widest select-none"
        style={{
          color: "var(--color-vsc-text-muted)",
          borderBottom: "1px solid var(--color-vsc-border)",
        }}
      >
        Result View
      </div>

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

      {/* ── View Templates ─────────────────────────────── */}
      <Section title="Templates" sectionKey="result:Templates">
        <div className="space-y-2">
          <button
            style={btnStyle}
            className="w-full"
            onClick={() => {
              const template = {
                version: 1,
                resultViewSettings: rvs,
              };
              const blob = new Blob([JSON.stringify(template, null, 2)], {
                type: "application/json",
              });
              const link = document.createElement("a");
              link.download = "view-template.json";
              link.href = URL.createObjectURL(blob);
              link.click();
              URL.revokeObjectURL(link.href);
            }}
          >
            Export View Template
          </button>
          <button
            style={btnStyle}
            className="w-full"
            onClick={() => {
              const input = document.createElement("input");
              input.type = "file";
              input.accept = ".json";
              input.onchange = () => {
                const file = input.files?.[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = () => {
                  try {
                    const data = JSON.parse(reader.result as string);
                    if (data?.resultViewSettings) {
                      setRvs(data.resultViewSettings);
                    }
                  } catch {
                    alert("Invalid template file.");
                  }
                };
                reader.readAsText(file);
              };
              input.click();
            }}
          >
            Import View Template
          </button>
        </div>
      </Section>

      {/* ── Annotations ────────────────────────────────── */}
      <Section title="Annotations" sectionKey="result:Annotations">
        <div className="space-y-2">
          <div className="flex flex-wrap gap-1">
            <button
              style={btnStyle}
              onClick={() => addAnnotation("text")}
              title="Add free text annotation"
            >
              + Text
            </button>
            <button
              style={btnStyle}
              onClick={() => addAnnotation("input-params")}
              title="Add input parameters block"
            >
              + Input
            </button>
            <button
              style={btnStyle}
              onClick={() => addAnnotation("output-params")}
              title="Add output results block"
            >
              + Output
            </button>
            <button
              style={btnStyle}
              onClick={() => addAnnotation("material-table")}
              title="Add material properties table"
            >
              + Materials
            </button>
            <button
              style={btnStyle}
              onClick={() => addAnnotation("color-bar")}
              title="Add FOS color bar legend"
            >
              + Color Bar
            </button>
          </div>

          <p
            className="text-[11px]"
            style={{ color: "var(--color-vsc-text-muted)" }}
          >
            Text supports tags like <code>#Title</code>, parameter tags like{" "}
            <code>#road_x1</code>, and expressions like{" "}
            <code>{"{{road_x1 + road_width}}"}</code>.
          </p>

          {rvs.annotations.length === 0 && (
            <p
              className="text-[11px]"
              style={{ color: "var(--color-vsc-text-muted)" }}
            >
              No annotations. Add text, parameters, or tables to the result
              view.
            </p>
          )}

          {rvs.annotations.map((anno) => (
            <div
              key={anno.id}
              className="flex items-center gap-2 p-1.5 rounded"
              style={{ background: "var(--color-vsc-list-hover)" }}
            >
              {anno.type !== "text" && (
                <span
                  className="text-[11px] flex-1 min-w-0 truncate"
                  style={{ color: "var(--color-vsc-text)" }}
                >
                  {anno.type === "input-params"
                    ? "Input Parameters"
                    : anno.type === "output-params"
                      ? "Output Results"
                      : "Material Table"}
                </span>
              )}
              {anno.type === "text" && (
                <textarea
                  value={anno.text ?? ""}
                  onChange={(e) =>
                    updateAnnotation(anno.id, { text: e.target.value })
                  }
                  className="flex-1 min-w-0"
                  style={{
                    ...inputStyle,
                    fontSize: 11,
                    padding: "4px",
                    resize: "vertical",
                    minHeight: 32,
                  }}
                  rows={2}
                  placeholder="Enter text, e.g. Crest = #road_x1 m"
                />
              )}
              <button
                onClick={() => removeAnnotation(anno.id)}
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
          ))}
        </div>
      </Section>

      {/* ── Export ──────────────────────────────────────── */}
      <Section title="Export" sectionKey="result:Export">
        <div className="space-y-2">
          <button
            onClick={handleExportPng}
            className="w-full flex items-center justify-center gap-2 py-2 rounded text-[12px] font-medium cursor-pointer"
            style={{
              background: "var(--color-vsc-accent)",
              color: "#fff",
              border: "none",
            }}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            Export PNG
          </button>
          <button
            onClick={handleExportPdf}
            className="w-full flex items-center justify-center gap-2 py-2 rounded text-[12px] font-medium cursor-pointer"
            style={{
              background: "var(--color-vsc-list-hover)",
              color: "var(--color-vsc-text-bright)",
              border: "1px solid var(--color-vsc-border)",
            }}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="16" y1="13" x2="8" y2="13" />
              <line x1="16" y1="17" x2="8" y2="17" />
            </svg>
            Export PDF
          </button>
        </div>
      </Section>
    </div>
  );
}
