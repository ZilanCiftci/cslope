/**
 * SlopeCanvas — Interactive HTML5 Canvas for editing slope geometry.
 */

import type React from "react";
import { useRef, useEffect, useCallback, useMemo } from "react";
import { useAppStore } from "../store/app-store";
import { useHitTest } from "../features/canvas/hooks/useHitTest";
import { useViewport } from "../features/canvas/hooks/useViewport";
import { usePointerHandlers } from "../features/canvas/hooks/usePointerHandlers";
import { useContextMenu } from "../features/canvas/hooks/useContextMenu";
import { useMaterialPicker } from "../features/canvas/hooks/useMaterialPicker";
import { drawCanvas } from "../features/canvas/draw";

const SCROLL_FALLBACK = 4000; // virtual surface to show scrollbars when sizes are missing
const SCROLL_PAN_FACTOR = 0.25; // dampen scrollbar panning sensitivity

export function SlopeCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollStateRef = useRef({ x: 0, y: 0 });

  const mode = useAppStore((s) => s.mode);
  const result = useAppStore((s) => s.result);
  const resultViewSettings = useAppStore((s) => s.resultViewSettings);
  const orientation = useAppStore((s) => s.orientation);
  const coordinates = useAppStore((s) => s.coordinates);
  const materials = useAppStore((s) => s.materials);
  const materialBoundaries = useAppStore((s) => s.materialBoundaries);
  const analysisLimits = useAppStore((s) => s.analysisLimits);
  const setAnalysisLimits = useAppStore((s) => s.setAnalysisLimits);
  const udls = useAppStore((s) => s.udls);
  const updateUdl = useAppStore((s) => s.updateUdl);
  const lineLoads = useAppStore((s) => s.lineLoads);
  const updateLineLoad = useAppStore((s) => s.updateLineLoad);
  const activeSection = useAppStore((s) => s.activeSection);
  const piezometricLine = useAppStore((s) => s.piezometricLine);
  const setPiezoCoordinate = useAppStore((s) => s.setPiezoCoordinate);
  const insertPiezoPointAt = useAppStore((s) => s.insertPiezoPointAt);
  const removePiezoPoint = useAppStore((s) => s.removePiezoPoint);
  const selectedPointIndex = useAppStore((s) => s.selectedPointIndex);
  const setCoordinate = useAppStore((s) => s.setCoordinate);
  const insertCoordinateAt = useAppStore((s) => s.insertCoordinateAt);
  const removeCoordinate = useAppStore((s) => s.removeCoordinate);
  const setSelectedPoint = useAppStore((s) => s.setSelectedPoint);
  const updateBoundaryPoint = useAppStore((s) => s.updateBoundaryPoint);
  const removeBoundaryPoint = useAppStore((s) => s.removeBoundaryPoint);
  const insertBoundaryPointAt = useAppStore((s) => s.insertBoundaryPointAt);
  const regionMaterials = useAppStore((s) => s.regionMaterials);
  const setRegionMaterial = useAppStore((s) => s.setRegionMaterial);
  const assigningMaterialId = useAppStore((s) => s.assigningMaterialId);
  const setAssigningMaterial = useAppStore((s) => s.setAssigningMaterial);
  const selectedRegionKey = useAppStore((s) => s.selectedRegionKey);
  const setSelectedRegionKey = useAppStore((s) => s.setSelectedRegionKey);
  const updateAnnotation = useAppStore((s) => s.updateAnnotation);
  const removeAnnotation = useAppStore((s) => s.removeAnnotation);
  const selectedAnnotationIds = useAppStore((s) => s.selectedAnnotationIds);
  const setSelectedAnnotations = useAppStore((s) => s.setSelectedAnnotations);
  const toggleAnnotationSelection = useAppStore(
    (s) => s.toggleAnnotationSelection,
  );
  const alignAnnotations = useAppStore((s) => s.alignAnnotations);
  const theme = useAppStore((s) => s.theme);
  const snapToGrid = useAppStore((s) => s.snapToGrid);
  const gridSnapSize = useAppStore((s) => s.gridSnapSize);
  const projectInfo = useAppStore((s) => s.projectInfo);

  const editingExterior =
    mode === "edit" && activeSection === "Exterior Boundary";
  const editingBoundaries =
    mode === "edit" && activeSection === "Interior Boundaries";
  const editingPiezo = mode === "edit" && activeSection === "Piezometric Lines";
  const editingAssignment =
    mode === "edit" && activeSection === "Material Assignment";
  const editingLimits = mode === "edit" && activeSection === "Search Limits";
  const editingLoads = mode === "edit" && activeSection === "Loads";

  const surfaceYAtX = useCallback(
    (x: number): number | null => {
      let bestY: number | null = null;
      for (let i = 0; i < coordinates.length; i++) {
        const [x0, y0] = coordinates[i];
        const [x1, y1] = coordinates[(i + 1) % coordinates.length];
        if ((x0 <= x && x <= x1) || (x1 <= x && x <= x0)) {
          if (x1 === x0) continue;
          const t = (x - x0) / (x1 - x0);
          const y = y0 + t * (y1 - y0);
          if (bestY === null || y > bestY) bestY = y;
        }
      }
      return bestY;
    },
    [coordinates],
  );

  const activePiezoCoords: [number, number][] = useMemo(() => {
    const activePiezoLine =
      piezometricLine.lines.find(
        (l) => l.id === piezometricLine.activeLineId,
      ) ?? null;
    return activePiezoLine?.coordinates ?? [];
  }, [piezometricLine]);

  const snapValue = useCallback(
    (v: number) =>
      snapToGrid ? Math.round(v / gridSnapSize) * gridSnapSize : v,
    [snapToGrid, gridSnapSize],
  );

  const {
    viewOffset,
    viewScale,
    worldToCanvas,
    canvasToWorld,
    setActiveViewOffset,
    setActiveViewScale,
    getEventWorldPos,
  } = useViewport(canvasRef);

  const { materialPicker, setMaterialPicker } = useMaterialPicker();

  const hitTest = useHitTest({
    canvasRef,
    worldToCanvas,
    canvasToWorld,
    coordinates,
    materials,
    materialBoundaries,
    regionMaterials,
    piezometricLine,
    activePiezoCoords,
    analysisLimits,
    udls,
    lineLoads,
    surfaceYAtX,
    snapValue,
    viewScale,
    snapToGrid,
    gridSnapSize,
    editingExterior,
    editingBoundaries,
    editingPiezo,
    editingLimits,
    editingLoads,
  });

  const {
    contextMenu,
    annoStyleMenu,
    setContextMenu,
    setAnnoStyleMenu,
    handleContextMenu,
  } = useContextMenu({
    canvasRef,
    mode,
    selectedAnnotationIds,
    alignAnnotations,
    getEventWorldPos,
    findNearPointUnified: hitTest.findNearPointUnified,
    findNearEdgeUnified: hitTest.findNearEdgeUnified,
    coordinates,
    materialBoundaries,
    activePiezoCoords,
    removeCoordinate,
    removeBoundaryPoint,
    removePiezoPoint,
    insertCoordinateAt,
    insertBoundaryPointAt,
    insertPiezoPointAt,
    setSelectedPoint,
    setMaterialPicker,
  });

  const {
    mouseWorld,
    hoverHit,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    handleWheel,
  } = usePointerHandlers({
    canvasRef,
    getEventWorldPos,
    viewOffset,
    setActiveViewOffset,
    setActiveViewScale,
    findNearPointUnified: hitTest.findNearPointUnified,
    findRegionAtPoint: hitTest.findRegionAtPoint,
    findSnapTarget: hitTest.findSnapTarget,
    snapValue,
    coordinates,
    activePiezoCoords,
    analysisLimits,
    udls,
    lineLoads,
    materialBoundaries,
    assigningMaterialId,
    editingAssignment,
    setRegionMaterial,
    setAssigningMaterial,
    setSelectedRegionKey,
    setSelectedPoint,
    updateAnnotation,
    setSelectedAnnotations,
    toggleAnnotationSelection,
    selectedAnnotationIds,
    mode,
    setAnalysisLimits,
    updateUdl,
    updateLineLoad,
    setCoordinate,
    setPiezoCoordinate,
    updateBoundaryPoint,
    setContextMenu,
    setMaterialPicker,
  });

  // Center scrollbars initially so we can treat scroll deltas as pan inputs.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const centerX = (el.scrollWidth - el.clientWidth) / 2;
    const centerY = (el.scrollHeight - el.clientHeight) / 2;
    el.scrollLeft = centerX;
    el.scrollTop = centerY;
    scrollStateRef.current = { x: centerX, y: centerY };
  }, []);

  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;

    const dx = el.scrollLeft - scrollStateRef.current.x;
    const dy = el.scrollTop - scrollStateRef.current.y;
    if (dx === 0 && dy === 0) return;

    const scale = viewScale || 1;
    // Invert directions so scrollbar motion matches model motion (right→right, up→up).
    setActiveViewOffset([
      viewOffset[0] - (dx / scale) * SCROLL_PAN_FACTOR,
      viewOffset[1] + (dy / scale) * SCROLL_PAN_FACTOR,
    ]);

    // Track current position so thumb moves naturally.
    scrollStateRef.current = { x: el.scrollLeft, y: el.scrollTop };
  }, [viewOffset, viewScale, setActiveViewOffset]);

  const handleWheelCapture = useCallback(
    (e: React.WheelEvent<HTMLDivElement>) => {
      // Prevent page zoom; only stop propagation when not using Ctrl-zoom (so canvas still handles it).
      // Prevent browser zoom when user requests canvas zoom with Ctrl+wheel.
      if (e.ctrlKey) e.preventDefault();
    },
    [],
  );

  // ── Draw ────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Ensure redraw when theme CSS variables change
    void theme;

    drawCanvas(ctx, {
      w: rect.width,
      h: rect.height,
      mode,
      result,
      resultViewSettings,
      orientation,
      coordinates,
      materials,
      materialBoundaries,
      regionMaterials,
      selectedRegionKey,
      editingAssignment,
      selectedAnnotationIds,
      projectInfo,
      analysisLimits,
      udls,
      lineLoads,
      piezometricLine,
      viewScale,
      mouseWorld,
      hoverHit,
      selectedPointIndex,
      worldToCanvas,
      canvasToWorld,
      surfaceYAtX,
      editingExterior,
      editingBoundaries,
      editingPiezo,
    });
  }, [
    coordinates,
    orientation,
    materials,
    materialBoundaries,
    analysisLimits,
    udls,
    lineLoads,
    piezometricLine,
    viewScale,
    mouseWorld,
    hoverHit,
    selectedPointIndex,
    canvasToWorld,
    worldToCanvas,
    editingExterior,
    editingBoundaries,
    editingPiezo,
    editingAssignment,
    selectedRegionKey,
    regionMaterials,
    surfaceYAtX,
    mode,
    result,
    resultViewSettings,
    selectedAnnotationIds,
    projectInfo,
    theme,
  ]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setContextMenu(null);
        setMaterialPicker(null);
        setAssigningMaterial(null);
        setAnnoStyleMenu(null);
        return;
      }
      if (
        (e.key === "ArrowLeft" ||
          e.key === "ArrowRight" ||
          e.key === "ArrowUp" ||
          e.key === "ArrowDown") &&
        selectedAnnotationIds.length > 0 &&
        mode === "result"
      ) {
        e.preventDefault();
        const step = e.shiftKey ? 0.002 : 0.01;
        let dx = 0;
        let dy = 0;
        if (e.key === "ArrowLeft") dx = -step;
        if (e.key === "ArrowRight") dx = step;
        if (e.key === "ArrowUp") dy = -step;
        if (e.key === "ArrowDown") dy = step;

        const annos = useAppStore.getState().resultViewSettings.annotations;
        for (const id of selectedAnnotationIds) {
          const a = annos.find((an) => an.id === id);
          if (a) updateAnnotation(id, { x: a.x + dx, y: a.y + dy });
        }
      }
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [
    selectedAnnotationIds,
    mode,
    updateAnnotation,
    setAssigningMaterial,
    setContextMenu,
    setMaterialPicker,
    setAnnoStyleMenu,
  ]);

  const handleContainerWheel = useCallback(
    (e: React.WheelEvent<HTMLDivElement>) => {
      // Shift+wheel pans horizontally via scrollbars.
      if (e.shiftKey && !e.ctrlKey) {
        const el = containerRef.current;
        if (!el) return;
        el.scrollLeft += e.deltaY;
        e.preventDefault();
        e.stopPropagation();
      }
    },
    [],
  );

  return (
    <div
      ref={containerRef}
      className="relative overflow-auto"
      style={{
        background: "var(--color-canvas-bg)",
        overscrollBehavior: "none",
        width: "100%",
        height: "100%",
      }}
      onScroll={handleScroll}
      onWheelCapture={handleWheelCapture}
      onWheel={handleContainerWheel}
    >
      <div
        className="relative"
        style={{
          width: `${projectInfo.canvasWidth || SCROLL_FALLBACK}px`,
          height: `${projectInfo.canvasHeight || SCROLL_FALLBACK}px`,
        }}
      >
        <canvas
          ref={canvasRef}
          className="absolute inset-0 w-full h-full"
          style={{
            cursor: assigningMaterialId
              ? "crosshair"
              : hoverHit
                ? "grab"
                : "default",
          }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onWheel={handleWheel}
          onContextMenu={handleContextMenu}
          data-testid="slope-canvas"
        />

        {mouseWorld && (
          <div
            className="absolute bottom-2 right-3 text-[11px] font-mono select-none pointer-events-none"
            style={{ color: "var(--color-vsc-text-muted)" }}
          >
            x: {mouseWorld[0].toFixed(1)} &nbsp; y: {mouseWorld[1].toFixed(1)}
          </div>
        )}

        {assigningMaterialId && (
          <div
            className="absolute top-2 left-1/2 -translate-x-1/2 z-40 flex items-center gap-2 px-3 py-1.5 rounded-md text-[12px] font-medium select-none"
            style={{
              background: "var(--color-vsc-accent)",
              color: "var(--color-canvas-tooltip-text)",
              boxShadow: "0 4px 12px var(--color-canvas-tooltip-shadow)",
            }}
          >
            <span
              className="w-3 h-3 rounded-sm inline-block"
              style={{
                background:
                  materials.find((m) => m.id === assigningMaterialId)?.color ??
                  "#888",
                border: "1px solid rgba(255,255,255,0.4)",
              }}
            />
            Click a region to assign{" "}
            <strong>
              {materials.find((m) => m.id === assigningMaterialId)?.name ?? "?"}
            </strong>
            <button
              onClick={() => setAssigningMaterial(null)}
              className="ml-1 px-1.5 py-0.5 rounded text-[11px] cursor-pointer"
              style={{ background: "rgba(255,255,255,0.2)" }}
            >
              Cancel
            </button>
          </div>
        )}

        {contextMenu && (
          <div
            className="absolute z-50 py-1 rounded-md shadow-xl min-w-[140px]"
            style={{
              left: contextMenu.screenX,
              top: contextMenu.screenY,
              background: "var(--color-vsc-input-bg)",
              border: "1px solid var(--color-vsc-border)",
              boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
            }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            {contextMenu.items.map((item) => (
              <button
                key={item.label}
                onClick={item.disabled ? undefined : item.action}
                disabled={item.disabled}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-[12px] text-left cursor-pointer transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                style={{
                  color: item.danger
                    ? "var(--color-vsc-error)"
                    : "var(--color-vsc-text)",
                }}
                onMouseEnter={(e) => {
                  if (!item.disabled)
                    (e.currentTarget as HTMLElement).style.background =
                      "var(--color-vsc-list-hover)";
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLElement).style.background = "";
                }}
              >
                {item.label}
              </button>
            ))}
          </div>
        )}

        {materialPicker && (
          <div
            className="absolute z-50 py-1 rounded-md shadow-xl min-w-[140px]"
            style={{
              left: materialPicker.screenX,
              top: materialPicker.screenY,
              background: "var(--color-vsc-input-bg)",
              border: "1px solid var(--color-vsc-border)",
              boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
            }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div
              className="px-3 py-1 text-[10px] font-medium"
              style={{ color: "var(--color-vsc-text-muted)" }}
            >
              Assign Material
            </div>
            {materials.map((m) => (
              <button
                key={m.id}
                onClick={() => {
                  setRegionMaterial(materialPicker.regionKey, m.id);
                  setMaterialPicker(null);
                }}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-[12px] text-left cursor-pointer transition-colors"
                style={{ color: "var(--color-vsc-text)" }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLElement).style.background =
                    "var(--color-vsc-list-hover)";
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLElement).style.background = "";
                }}
              >
                <div
                  className="w-3 h-3 rounded-sm"
                  style={{ background: m.color }}
                />
                {m.name}
              </button>
            ))}
          </div>
        )}

        {annoStyleMenu &&
          (() => {
            const anno = resultViewSettings.annotations.find(
              (a) => a.id === annoStyleMenu.annoId,
            );
            if (!anno) return null;
            const FONT_SIZES = [8, 10, 12, 14, 16, 18, 20, 24, 28, 32];
            const FONT_FAMILIES = [
              { label: "Sans-serif", value: "sans-serif" },
              { label: "Serif", value: "serif" },
              { label: "Monospace", value: "monospace" },
            ];
            const COLORS = [
              "#000000",
              "#333333",
              "#666666",
              "#999999",
              "#cc0000",
              "#cc6600",
              "#cccc00",
              "#00cc00",
              "#0066cc",
              "#6600cc",
              "#ffffff",
            ];
            return (
              <div
                className="absolute z-50 p-3 rounded-md shadow-xl min-w-[200px] space-y-2.5"
                style={{
                  left: annoStyleMenu.screenX,
                  top: annoStyleMenu.screenY,
                  background: "var(--color-vsc-input-bg)",
                  border: "1px solid var(--color-vsc-border)",
                  boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
                }}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => e.stopPropagation()}
              >
                <div
                  className="text-[10px] font-medium mb-1"
                  style={{ color: "var(--color-vsc-text-muted)" }}
                >
                  Annotation Style
                </div>

                {anno.type === "text" && (
                  <div>
                    <label
                      className="text-[10px] block mb-0.5"
                      style={{ color: "var(--color-vsc-text-muted)" }}
                    >
                      Text
                    </label>
                    <textarea
                      value={anno.text ?? ""}
                      onChange={(e) =>
                        updateAnnotation(anno.id, { text: e.target.value })
                      }
                      className="w-full text-[11px] px-1.5 py-1 rounded resize-y min-h-[48px]"
                      style={{
                        background: "var(--color-vsc-bg)",
                        color: "var(--color-vsc-text)",
                        border: "1px solid var(--color-vsc-border)",
                      }}
                    />
                  </div>
                )}

                <div>
                  <label
                    className="text-[10px] block mb-0.5"
                    style={{ color: "var(--color-vsc-text-muted)" }}
                  >
                    Font
                  </label>
                  <select
                    value={anno.fontFamily ?? "sans-serif"}
                    onChange={(e) =>
                      updateAnnotation(anno.id, { fontFamily: e.target.value })
                    }
                    className="w-full text-[11px] px-1.5 py-1 rounded cursor-pointer"
                    style={{
                      background: "var(--color-vsc-bg)",
                      color: "var(--color-vsc-text)",
                      border: "1px solid var(--color-vsc-border)",
                    }}
                  >
                    {FONT_FAMILIES.map((f) => (
                      <option key={f.value} value={f.value}>
                        {f.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label
                    className="text-[10px] block mb-0.5"
                    style={{ color: "var(--color-vsc-text-muted)" }}
                  >
                    Size
                  </label>
                  <select
                    value={anno.fontSize ?? 12}
                    onChange={(e) =>
                      updateAnnotation(anno.id, {
                        fontSize: Number(e.target.value),
                      })
                    }
                    className="w-full text-[11px] px-1.5 py-1 rounded cursor-pointer"
                    style={{
                      background: "var(--color-vsc-bg)",
                      color: "var(--color-vsc-text)",
                      border: "1px solid var(--color-vsc-border)",
                    }}
                  >
                    {FONT_SIZES.map((s) => (
                      <option key={s} value={s}>
                        {s}px
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex gap-1.5">
                  <button
                    onClick={() =>
                      updateAnnotation(anno.id, { bold: !anno.bold })
                    }
                    className="flex-1 text-[12px] font-bold py-1 rounded cursor-pointer"
                    style={{
                      background: anno.bold
                        ? "var(--color-vsc-accent)"
                        : "var(--color-vsc-bg)",
                      color: anno.bold ? "#fff" : "var(--color-vsc-text)",
                      border: "1px solid var(--color-vsc-border)",
                    }}
                  >
                    B
                  </button>
                  <button
                    onClick={() =>
                      updateAnnotation(anno.id, { italic: !anno.italic })
                    }
                    className="flex-1 text-[12px] italic py-1 rounded cursor-pointer"
                    style={{
                      background: anno.italic
                        ? "var(--color-vsc-accent)"
                        : "var(--color-vsc-bg)",
                      color: anno.italic ? "#fff" : "var(--color-vsc-text)",
                      border: "1px solid var(--color-vsc-border)",
                    }}
                  >
                    I
                  </button>
                </div>

                <div>
                  <label
                    className="text-[10px] block mb-0.5"
                    style={{ color: "var(--color-vsc-text-muted)" }}
                  >
                    Color
                  </label>
                  <div className="flex flex-wrap gap-1">
                    {COLORS.map((c) => (
                      <button
                        key={c}
                        onClick={() => updateAnnotation(anno.id, { color: c })}
                        className="w-5 h-5 rounded-sm cursor-pointer"
                        style={{
                          background: c,
                          border:
                            (anno.color ?? "#000000") === c
                              ? "2px solid var(--color-vsc-accent)"
                              : "1px solid var(--color-vsc-border)",
                        }}
                      />
                    ))}
                  </div>
                </div>

                <button
                  onClick={() => {
                    removeAnnotation(anno.id);
                    setAnnoStyleMenu(null);
                  }}
                  className="w-full text-[11px] py-1 rounded cursor-pointer mt-1"
                  style={{
                    background: "transparent",
                    color: "var(--color-vsc-error)",
                    border: "1px solid var(--color-vsc-error)",
                  }}
                >
                  Delete Annotation
                </button>
              </div>
            );
          })()}
      </div>
    </div>
  );
}
