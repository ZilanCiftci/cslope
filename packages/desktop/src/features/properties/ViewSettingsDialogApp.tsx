import { useEffect, useRef, useState } from "react";
import { isElectron } from "../../utils/is-electron";
import { useAppStore, PAPER_DIMENSIONS } from "../../store/app-store";
import type { ResultViewSettings, PaperSize } from "../../store/types";
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

  type ExtentField = "bl_x" | "bl_y" | "tr_x" | "tr_y";

  const extentFieldValue = (field: ExtentField): number => {
    if (field === "bl_x") return rvs.viewLock?.bottomLeft[0] ?? -1;
    if (field === "bl_y") return rvs.viewLock?.bottomLeft[1] ?? -1;
    if (field === "tr_x") return rvs.viewLock?.topRight[0] ?? 26;
    return rvs.viewLock?.topRight[1] ?? 18;
  };

  const formatExtentValue = (value: number) => {
    const rounded = Math.round((value + Number.EPSILON) * 100) / 100;
    return rounded.toFixed(2);
  };

  const [extentDraft, setExtentDraft] = useState<Record<ExtentField, string>>({
    bl_x: formatExtentValue(extentFieldValue("bl_x")),
    bl_y: formatExtentValue(extentFieldValue("bl_y")),
    tr_x: formatExtentValue(extentFieldValue("tr_x")),
    tr_y: formatExtentValue(extentFieldValue("tr_y")),
  });
  const [activeExtentField, setActiveExtentField] =
    useState<ExtentField | null>(null);

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
      // When Top Y changes, keep Right X fixed and adjust Bottom Y.
      const w = newVl.topRight[0] - newVl.bottomLeft[0];
      const newH = w / ar;
      newVl.bottomLeft[1] = newVl.topRight[1] - newH;
    } else {
      // For Left X, Bottom Y, Right X: adjust Top Y to keep aspect ratio
      const w = newVl.topRight[0] - newVl.bottomLeft[0];
      const newH = w / ar;
      newVl.topRight[1] = newVl.bottomLeft[1] + newH;
    }

    setRvs({ viewLock: newVl });
  };

  useEffect(() => {
    // Keep input boxes in sync with external updates when user is not typing.
    if (activeExtentField) return;
    setExtentDraft({
      bl_x: formatExtentValue(extentFieldValue("bl_x")),
      bl_y: formatExtentValue(extentFieldValue("bl_y")),
      tr_x: formatExtentValue(extentFieldValue("tr_x")),
      tr_y: formatExtentValue(extentFieldValue("tr_y")),
    });
  }, [rvs.viewLock, activeExtentField]);

  const commitExtentField = (field: ExtentField) => {
    const raw = extentDraft[field].trim();
    if (raw === "" || raw === "-" || raw === "+") {
      setExtentDraft((prev) => ({
        ...prev,
        [field]: formatExtentValue(extentFieldValue(field)),
      }));
      return;
    }

    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) {
      setExtentDraft((prev) => ({
        ...prev,
        [field]: formatExtentValue(extentFieldValue(field)),
      }));
      return;
    }

    handleLockUpdate(field, parsed);
  };

  const handleExtentChange = (field: ExtentField, raw: string) => {
    setExtentDraft((prev) => ({ ...prev, [field]: raw }));
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

        {/* ── Grid & Ticks ──────────────────────── */}
        <GroupHeading>Grid &amp; Ticks</GroupHeading>

        <FieldRow label="Spacing">
          <input
            type="number"
            min={0}
            step="any"
            placeholder="Auto"
            value={rvs.gridSpacing ?? ""}
            onChange={(e) => {
              const raw = e.target.value;
              if (raw === "") {
                setRvs({ gridSpacing: undefined });
                return;
              }
              const parsed = Number(raw);
              setRvs({
                gridSpacing:
                  Number.isFinite(parsed) && parsed > 0 ? parsed : undefined,
              });
            }}
            style={{ ...inputStyle, width: 80 }}
          />
        </FieldRow>

        <FieldRow label="Minor ticks">
          <input
            type="number"
            min={0}
            max={20}
            step={1}
            value={rvs.minorTicks ?? 0}
            onChange={(e) => {
              const raw = e.target.value;
              if (raw === "") {
                setRvs({ minorTicks: undefined });
                return;
              }
              const parsed = Number(raw);
              if (!Number.isFinite(parsed)) {
                return;
              }
              const value = Math.max(0, Math.min(20, Math.round(parsed)));
              setRvs({ minorTicks: value || undefined });
            }}
            style={{ ...inputStyle, width: 80 }}
          />
        </FieldRow>

        {/* ── Plot Extents ─────────────────────────── */}
        <GroupHeading>Plot Extents</GroupHeading>

        <div className="space-y-2 px-2">
          <div className="grid grid-cols-2 gap-x-3 gap-y-2">
            <div>
              <span className="text-[10px] opacity-60">Left X</span>
              <input
                type="number"
                step={1}
                value={extentDraft.bl_x}
                onFocus={() => setActiveExtentField("bl_x")}
                onChange={(e) => handleExtentChange("bl_x", e.target.value)}
                onBlur={() => {
                  commitExtentField("bl_x");
                  setActiveExtentField(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    commitExtentField("bl_x");
                    (e.currentTarget as HTMLInputElement).blur();
                  }
                }}
                style={{ ...inputStyle, width: "100%" }}
              />
            </div>
            <div>
              <span className="text-[10px] opacity-60">Right X</span>
              <input
                type="number"
                step={1}
                value={extentDraft.tr_x}
                onFocus={() => setActiveExtentField("tr_x")}
                onChange={(e) => handleExtentChange("tr_x", e.target.value)}
                onBlur={() => {
                  commitExtentField("tr_x");
                  setActiveExtentField(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    commitExtentField("tr_x");
                    (e.currentTarget as HTMLInputElement).blur();
                  }
                }}
                style={{ ...inputStyle, width: "100%" }}
              />
            </div>
            <div>
              <span className="text-[10px] opacity-60">Bottom Y</span>
              <input
                type="number"
                step={1}
                value={extentDraft.bl_y}
                onFocus={() => setActiveExtentField("bl_y")}
                onChange={(e) => handleExtentChange("bl_y", e.target.value)}
                onBlur={() => {
                  commitExtentField("bl_y");
                  setActiveExtentField(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    commitExtentField("bl_y");
                    (e.currentTarget as HTMLInputElement).blur();
                  }
                }}
                style={{ ...inputStyle, width: "100%" }}
              />
            </div>
            <div>
              <span className="text-[10px] opacity-60">Top Y</span>
              <input
                type="number"
                step={1}
                value={extentDraft.tr_y}
                onFocus={() => setActiveExtentField("tr_y")}
                onChange={(e) => handleExtentChange("tr_y", e.target.value)}
                onBlur={() => {
                  commitExtentField("tr_y");
                  setActiveExtentField(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    commitExtentField("tr_y");
                    (e.currentTarget as HTMLInputElement).blur();
                  }
                }}
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
