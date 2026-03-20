import { useEffect, useRef, useState } from "react";
import { isElectron } from "../../utils/is-electron";
import { useAppStore, PAPER_DIMENSIONS } from "../../store/app-store";
import type {
  ResultViewSettings,
  SurfaceDisplayMode,
  PaperSize,
} from "../../store/types";
import { getPlotAspectRatio as getSharedPlotAspectRatio } from "../view/paper";

interface ViewSettingsStatePayload {
  resultViewSettings: ResultViewSettings;
  coordinates: [number, number][];
  resultViewScale: number;
  resultViewOffset: [number, number];
}

function GroupHeading({ children }: { children: React.ReactNode }) {
  return (
    <h3
      className="text-[10px] font-semibold uppercase tracking-wider mt-4 mb-2 pb-1"
      style={{
        color: "var(--color-vsc-text-secondary, var(--color-vsc-text))",
        opacity: 0.6,
        borderBottom: "1px solid var(--color-vsc-border)",
      }}
    >
      {children}
    </h3>
  );
}

function CheckboxItem({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label
      className="flex items-center gap-2 py-[5px] px-2 rounded cursor-pointer text-[12px] select-none"
      style={{ color: "var(--color-vsc-text)" }}
      onMouseEnter={(e) =>
        (e.currentTarget.style.background = "var(--color-vsc-list-hover)")
      }
      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="accent-blue-500"
      />
      {label}
    </label>
  );
}

function FieldRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-[5px] px-2">
      <span
        className="text-[12px] shrink-0"
        style={{ color: "var(--color-vsc-text)" }}
      >
        {label}
      </span>
      {children}
    </div>
  );
}

export function ViewSettingsDialogApp() {
  const rvs = useAppStore((s) => s.resultViewSettings);
  const setRvs = useAppStore((s) => s.setResultViewSettings);
  const coordinates = useAppStore((s) => s.coordinates);

  const [isHydrated, setIsHydrated] = useState(!isElectron);
  const suppressNextBroadcastRef = useRef(false);

  useEffect(() => {
    if (!isElectron) return;

    const applyState = (_event: unknown, next: ViewSettingsStatePayload) => {
      suppressNextBroadcastRef.current = true;
      useAppStore.setState({
        resultViewSettings: next.resultViewSettings,
        coordinates: next.coordinates,
        resultViewScale: next.resultViewScale,
        resultViewOffset: next.resultViewOffset,
      });
      setIsHydrated(true);
    };

    window.cslope.onViewSettingsState(applyState);
    window.cslope.onViewSettingsChanged(applyState);
    window.cslope.requestViewSettingsState();

    return () => {
      window.cslope.offViewSettingsState(applyState);
      window.cslope.offViewSettingsChanged(applyState);
    };
  }, []);

  useEffect(() => {
    if (!isElectron || !isHydrated) return;

    if (suppressNextBroadcastRef.current) {
      suppressNextBroadcastRef.current = false;
      return;
    }

    window.cslope.sendViewSettingsChanged({
      resultViewSettings: rvs,
      coordinates,
      resultViewScale: useAppStore.getState().resultViewScale,
      resultViewOffset: useAppStore.getState().resultViewOffset,
    });
  }, [rvs, coordinates, isHydrated]);

  const inputStyle: React.CSSProperties = {
    background: "var(--color-vsc-input-bg)",
    border: "1px solid var(--color-vsc-border)",
    color: "var(--color-vsc-text)",
    borderRadius: 4,
    padding: "3px 6px",
    fontSize: 12,
  };

  const selectStyle: React.CSSProperties = {
    ...inputStyle,
    cursor: "pointer",
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

  const getPlotAspectRatio = () => {
    const { paperSize, landscape } = rvs.paperFrame;
    return getSharedPlotAspectRatio(paperSize, landscape);
  };

  const setViewLockToModelBounds = () => {
    const state = useAppStore.getState();
    const coords = state.coordinates;
    const ar = getPlotAspectRatio();

    let bl: [number, number] = [-1, -1];
    let tr: [number, number] = [21, -1 + 22 / ar];
    if (coords.length >= 2) {
      const xs = coords.map((c) => c[0]);
      const ys = coords.map((c) => c[1]);
      const xMin = Math.min(...xs);
      const xMax = Math.max(...xs);
      const yMin = Math.min(...ys);

      const left = xMin - 1;
      const right = xMax + 1;
      const bottom = yMin - 1;
      const width = right - left;
      const height = width / ar;
      const top = bottom + height;

      bl = [left, bottom];
      tr = [right, top];
    }
    setRvs({
      viewLock: {
        bottomLeft: bl,
        topRight: tr,
      },
    });
  };

  const handleLockUpdate = (
    field: "bl_x" | "bl_y" | "tr_x" | "tr_y",
    val: number,
  ) => {
    if (!rvs.viewLock) return;
    const newVl = {
      bottomLeft: [...rvs.viewLock.bottomLeft] as [number, number],
      topRight: [...rvs.viewLock.topRight] as [number, number],
    };

    if (field === "bl_x") newVl.bottomLeft[0] = val;
    else if (field === "bl_y") newVl.bottomLeft[1] = val;
    else if (field === "tr_x") newVl.topRight[0] = val;
    else if (field === "tr_y") newVl.topRight[1] = val;

    const ar = getPlotAspectRatio();

    if (field === "tr_y") {
      // When Top Y changes, adjust Right X to keep aspect ratio
      const h = newVl.topRight[1] - newVl.bottomLeft[1];
      const newW = h * ar;
      newVl.topRight[0] = newVl.bottomLeft[0] + newW;
    } else {
      // For Left X, Bottom Y, Right X: adjust Top Y to keep aspect ratio
      const w = newVl.topRight[0] - newVl.bottomLeft[0];
      const newH = w / ar;
      newVl.topRight[1] = newVl.bottomLeft[1] + newH;
    }

    setRvs({ viewLock: newVl });
  };

  return (
    <div
      className="h-screen flex flex-col p-3"
      style={{
        background: "var(--color-vsc-bg)",
        color: "var(--color-vsc-text)",
      }}
    >
      <div className="flex-1 overflow-y-auto pr-1">
        {/* ── Surfaces ─────────────────────────────────── */}
        <GroupHeading>Surfaces</GroupHeading>

        <FieldRow label="Display">
          <select
            value={rvs.surfaceDisplay}
            onChange={(e) =>
              setRvs({
                surfaceDisplay: e.target.value as SurfaceDisplayMode,
              })
            }
            style={selectStyle}
            className="w-28"
          >
            <option value="critical">Critical only</option>
            <option value="all">All</option>
            <option value="filter">Filter</option>
          </select>
        </FieldRow>

        {rvs.surfaceDisplay === "filter" && (
          <FieldRow label="FOS ≤">
            <input
              type="number"
              value={rvs.fosFilterMax}
              onChange={(e) =>
                setRvs({
                  fosFilterMax: parseFloat(e.target.value) || 1.5,
                })
              }
              step="0.1"
              min="0.1"
              max="10"
              style={inputStyle}
              className="w-20 text-right"
            />
          </FieldRow>
        )}

        <CheckboxItem
          label="Show slices"
          checked={rvs.showSlices}
          onChange={(v) => setRvs({ showSlices: v })}
        />
        <CheckboxItem
          label="Show FOS label"
          checked={rvs.showFosLabel}
          onChange={(v) => setRvs({ showFosLabel: v })}
        />
        <CheckboxItem
          label="Show centre marker"
          checked={rvs.showCentreMarker}
          onChange={(v) => setRvs({ showCentreMarker: v })}
        />

        {/* ── Appearance ───────────────────────────────── */}
        <GroupHeading>Appearance</GroupHeading>

        <CheckboxItem
          label="Grid lines"
          checked={rvs.showGrid}
          onChange={(v) => setRvs({ showGrid: v })}
        />
        <CheckboxItem
          label="Soil colors"
          checked={rvs.showSoilColor ?? true}
          onChange={(v) => setRvs({ showSoilColor: v })}
        />

        {/* ── Paper ────────────────────────────────────── */}
        <GroupHeading>Paper</GroupHeading>

        <FieldRow label="Size">
          <select
            value={rvs.paperFrame.paperSize}
            onChange={(e) =>
              setRvs({
                paperFrame: {
                  ...rvs.paperFrame,
                  paperSize: e.target.value as PaperSize,
                },
              })
            }
            style={selectStyle}
            className="w-28"
          >
            {(Object.keys(PAPER_DIMENSIONS) as PaperSize[]).map((size) => (
              <option key={size} value={size}>
                {size} ({PAPER_DIMENSIONS[size].w}×{PAPER_DIMENSIONS[size].h}mm)
              </option>
            ))}
          </select>
        </FieldRow>

        <FieldRow label="Orientation">
          <select
            value={rvs.paperFrame.landscape ? "landscape" : "portrait"}
            onChange={(e) => {
              const newLandscape = e.target.value === "landscape";
              const newAr = getSharedPlotAspectRatio(
                rvs.paperFrame.paperSize,
                newLandscape,
              );
              const updates: Partial<ResultViewSettings> = {
                paperFrame: {
                  ...rvs.paperFrame,
                  landscape: newLandscape,
                },
              };
              if (rvs.viewLock) {
                const bl = [...rvs.viewLock.bottomLeft] as [number, number];
                const tr = [...rvs.viewLock.topRight] as [number, number];
                const w = tr[0] - bl[0];
                tr[1] = bl[1] + w / newAr;
                updates.viewLock = { bottomLeft: bl, topRight: tr };
              }
              setRvs(updates);
            }}
            style={selectStyle}
            className="w-28"
          >
            <option value="portrait">Portrait</option>
            <option value="landscape">Landscape</option>
          </select>
        </FieldRow>

        {/* ── Plot Extents ─────────────────────────── */}
        <GroupHeading>Plot Extents</GroupHeading>

        <div className="space-y-2 px-2">
          <div className="grid grid-cols-2 gap-x-3 gap-y-2">
            <div>
              <span className="text-[10px] opacity-60">Left X</span>
              <input
                type="number"
                step="any"
                value={rvs.viewLock?.bottomLeft[0] ?? -1}
                onChange={(e) =>
                  handleLockUpdate("bl_x", Number(e.target.value))
                }
                style={{ ...inputStyle, width: "100%" }}
              />
            </div>
            <div>
              <span className="text-[10px] opacity-60">Bottom Y</span>
              <input
                type="number"
                step="any"
                value={rvs.viewLock?.bottomLeft[1] ?? -1}
                onChange={(e) =>
                  handleLockUpdate("bl_y", Number(e.target.value))
                }
                style={{ ...inputStyle, width: "100%" }}
              />
            </div>
            <div>
              <span className="text-[10px] opacity-60">Right X</span>
              <input
                type="number"
                step="any"
                value={rvs.viewLock?.topRight[0] ?? 26}
                onChange={(e) =>
                  handleLockUpdate("tr_x", Number(e.target.value))
                }
                style={{ ...inputStyle, width: "100%" }}
              />
            </div>
            <div>
              <span className="text-[10px] opacity-60">Top Y</span>
              <input
                type="number"
                step="any"
                value={rvs.viewLock?.topRight[1] ?? 18}
                onChange={(e) =>
                  handleLockUpdate("tr_y", Number(e.target.value))
                }
                style={{ ...inputStyle, width: "100%" }}
              />
            </div>
          </div>

          <button
            type="button"
            onClick={setViewLockToModelBounds}
            style={btnStyle}
            className="w-full"
          >
            Use Model Bounds
          </button>
        </div>
      </div>

      {/* ── Close button ─────────────────────────────── */}
      <div
        className="pt-3 mt-2 border-t"
        style={{ borderColor: "var(--color-vsc-border)" }}
      >
        <button
          onClick={() => window.close()}
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
