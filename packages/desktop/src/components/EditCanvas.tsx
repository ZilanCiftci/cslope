/**
 * SlopeCanvas — Interactive HTML5 Canvas for editing slope geometry.
 */

import type React from "react";
import { useRef, useEffect, useCallback, useState, useMemo } from "react";
import {
  useAppStore,
  useCanvasModelState,
  useCanvasActions,
} from "../store/app-store";
import { useHitTest } from "../features/canvas/hooks/useHitTest";
import { useViewport } from "../features/canvas/hooks/useViewport";
import { usePointerHandlers } from "../features/canvas/hooks/usePointerHandlers";
import { useContextMenu } from "../features/canvas/hooks/useContextMenu";
import { useMaterialPicker } from "../features/canvas/hooks/useMaterialPicker";
import { useCanvasSizing } from "../features/canvas/hooks/useCanvasSizing";
import { useRafCleanup } from "../features/canvas/hooks/useRafCleanup";
import { useCanvasDrawLoop } from "../features/canvas/hooks/useCanvasDrawLoop";
import { drawCanvas, type DrawCanvasParams } from "../features/canvas/draw";
import {
  ARROW_HEIGHT_PX,
  RULER_SIZE_PX,
  cssVar,
} from "../features/canvas/constants";
import {
  collectModelFitBounds,
  surfaceYAtXFromCoordinates,
} from "../features/canvas/helpers";
import { ContextMenuOverlay } from "../features/canvas/ContextMenuOverlay";
import { MaterialPickerMenu } from "../features/canvas/MaterialPickerMenu";
import { AxisOverlay } from "../features/canvas/AxisOverlay";

export function EditCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const crosshairCanvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const drawRafRef = useRef<number | null>(null);
  const drawDirtyRef = useRef(false);
  const drawArgsRef = useRef<Parameters<typeof drawCanvas>[1] | null>(null);
  const drawMetaRef = useRef({ dpr: 1 });
  const [zoomBoxActive, setZoomBoxActive] = useState(false);
  const [panActive, setPanActive] = useState(false);
  const [zoomBoxStart, setZoomBoxStart] = useState<[number, number] | null>(
    null,
  );
  const [zoomBoxCurrent, setZoomBoxCurrent] = useState<[number, number] | null>(
    null,
  );
  const [zoomBoxOrigin, setZoomBoxOrigin] = useState<[number, number] | null>(
    null,
  );
  const canvasSize = useCanvasSizing(canvasRef, crosshairCanvasRef);

  const mode = "edit" as const;
  const {
    result,
    resultViewSettings,
    orientation,
    coordinates,
    materials,
    materialBoundaries,
    analysisLimits,
    udls,
    lineLoads,
    piezometricLine,
    selectedPointIndex,
    selectedMaterialBoundaryId,
    interiorBoundariesDialogOpen,
    regionMaterials,
    assigningMaterialId,
    selectedRegionKey,
    selectedAnnotationIds,
    theme,
    snapToGrid,
    gridSnapSize,
    projectInfo,
  } = useCanvasModelState();
  const activeSection = useAppStore((s) => s.activeSection);
  const {
    setAnalysisLimits,
    updateUdl,
    updateLineLoad,
    setPiezoCoordinate,
    insertPiezoPointAt,
    removePiezoPoint,
    setCoordinate,
    insertCoordinateAt,
    removeCoordinate,
    setSelectedPoint,
    setSelectedMaterialBoundary,
    updateBoundaryPoint,
    removeBoundaryPoint,
    insertBoundaryPointAt,
    setRegionMaterial,
    setAssigningMaterial,
    setSelectedRegionKey,
    updateAnnotation,
    setSelectedAnnotations,
    toggleAnnotationSelection,
    alignAnnotations,
    setCanvasToolbar,
    setCursorWorld,
    setActivePiezoLine,
  } = useCanvasActions();

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
    (x: number): number | null => surfaceYAtXFromCoordinates(coordinates, x),
    [coordinates],
  );

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
  } = useViewport(canvasRef, containerRef);

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

  const { contextMenu, setContextMenu, handleContextMenu } = useContextMenu({
    canvasRef,
    mode,
    selectedAnnotationIds,
    alignAnnotations,
    getEventWorldPos,
    findNearPointUnified: hitTest.findNearPointUnified,
    findNearEdgeUnified: hitTest.findNearEdgeUnified,
    coordinates,
    materialBoundaries,
    piezometricLine,
    setActivePiezoLine,
    removeCoordinate,
    removeBoundaryPoint,
    removePiezoPoint,
    insertCoordinateAt,
    insertBoundaryPointAt,
    insertPiezoPointAt,
    setSelectedPoint,
    setSelectedMaterialBoundary,
    setMaterialPicker,
  });

  const {
    mouseWorld,
    hoverHit,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    handlePointerCancel,
    handleWheel,
  } = usePointerHandlers({
    canvasRef,
    containerRef,
    getEventWorldPos,
    viewOffset,
    setActiveViewOffset,
    setActiveViewScale,
    findNearPointUnified: hitTest.findNearPointUnified,
    findNearEdgeUnified: hitTest.findNearEdgeUnified,
    findRegionAtPoint: hitTest.findRegionAtPoint,
    findSnapTarget: hitTest.findSnapTarget,
    snapValue,
    coordinates,
    piezometricLine,
    setActivePiezoLine,
    analysisLimits,
    udls,
    lineLoads,
    materialBoundaries,
    assigningMaterialId,
    editingAssignment,
    editingBoundaries,
    panActive,
    setRegionMaterial,
    setAssigningMaterial,
    setSelectedRegionKey,
    setSelectedMaterialBoundary,
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

  // Sync mouse world position to the store so StatusBar can display it
  useEffect(() => {
    setCursorWorld(mouseWorld);
  }, [mouseWorld, setCursorWorld]);

  const handleWheelCapture = useCallback(
    (e: React.WheelEvent<HTMLDivElement>) => {
      // Prevent page zoom; only stop propagation when not using Ctrl-zoom (so canvas still handles it).
      // Prevent browser zoom when user requests canvas zoom with Ctrl+wheel.
      if (e.ctrlKey) e.preventDefault();
    },
    [],
  );

  useRafCleanup(drawRafRef);

  const drawArgs = useMemo<DrawCanvasParams>(
    () => ({
      w: canvasSize.width,
      h: canvasSize.height,
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
      mouseWorld: null,
      hoverHit,
      selectedPointIndex,
      selectedMaterialBoundaryId,
      interiorBoundariesDialogOpen,
      worldToCanvas,
      canvasToWorld,
      surfaceYAtX,
      editingExterior,
      editingBoundaries,
      editingPiezo,
    }),
    [
      canvasSize.width,
      canvasSize.height,
      coordinates,
      orientation,
      materials,
      materialBoundaries,
      analysisLimits,
      udls,
      lineLoads,
      piezometricLine,
      viewScale,
      hoverHit,
      selectedPointIndex,
      selectedMaterialBoundaryId,
      interiorBoundariesDialogOpen,
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
    ],
  );

  useCanvasDrawLoop({
    canvasRef,
    canvasSize,
    drawMetaRef,
    drawRafRef,
    drawDirtyRef,
    drawArgsRef,
    drawArgs,
    themeToken: theme,
  });

  useEffect(() => {
    const canvas = crosshairCanvasRef.current;
    if (!canvas || canvasSize.width <= 0 || canvasSize.height <= 0) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(canvasSize.dpr, 0, 0, canvasSize.dpr, 0, 0);
    ctx.clearRect(0, 0, canvasSize.width, canvasSize.height);

    if (mode !== "edit" || !mouseWorld) return;

    const [mx, my] = worldToCanvas(
      mouseWorld[0],
      mouseWorld[1],
      canvasSize.width,
      canvasSize.height,
    );
    ctx.strokeStyle = cssVar("--color-canvas-crosshair");
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(mx, 0);
    ctx.lineTo(mx, canvasSize.height);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, my);
    ctx.lineTo(canvasSize.width, my);
    ctx.stroke();
    ctx.setLineDash([]);
  }, [canvasSize, mode, mouseWorld, worldToCanvas]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setContextMenu(null);
        setMaterialPicker(null);
        setAssigningMaterial(null);
        return;
      }
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [setAssigningMaterial, setContextMenu, setMaterialPicker]);

  const handleFitToScreen = useCallback(() => {
    if (coordinates.length < 2) return;

    const container = containerRef.current;
    const canvas = canvasRef.current;
    const rect = container?.getBoundingClientRect();
    const rulerPadding = RULER_SIZE_PX + 16; // ruler band + extra margin
    const w =
      (rect?.width ?? canvas?.getBoundingClientRect().width ?? 0) -
      rulerPadding;
    const h =
      (rect?.height ?? canvas?.getBoundingClientRect().height ?? 0) -
      rulerPadding;
    if (w <= 0 || h <= 0) return;

    const fitW = w;
    const fitH = h;
    const targetCx = w / 2;
    const targetCy = h / 2;

    const modelBounds = collectModelFitBounds({
      coordinates,
      materialBoundaries,
      piezometricLines: piezometricLine.lines,
      analysisLimits,
      udls,
      lineLoads,
      surfaceYAtX,
    });
    if (!modelBounds) return;

    const { xMin, xMax, yMin } = modelBounds;
    let { yMax } = modelBounds;

    const computeScale = (
      minX: number,
      maxX: number,
      minY: number,
      maxY: number,
    ) => {
      const worldW = maxX - minX || 10;
      const worldH = maxY - minY || 10;
      const margin = Math.max(worldW, worldH) * 0.05;
      return Math.min(
        fitW / (worldW + margin * 2),
        fitH / (worldH + margin * 2),
      );
    };

    let scale = computeScale(xMin, xMax, yMin, yMax);

    if (udls.length > 0 || lineLoads.length > 0) {
      const extraPx = ARROW_HEIGHT_PX + 18;
      const extraWorld = extraPx / scale;
      yMax += extraWorld;
      scale = computeScale(xMin, xMax, yMin, yMax);
    }

    const cx = (xMin + xMax) / 2;
    const cy = (yMin + yMax) / 2;

    const clampedScale = Math.max(0.1, Math.min(200, scale));
    const ox = (targetCx - w / 2) / clampedScale - cx;
    const oy = (h / 2 - targetCy) / clampedScale - cy;

    setActiveViewScale(clampedScale);
    setActiveViewOffset([ox, oy]);
  }, [
    analysisLimits,
    coordinates,
    lineLoads,
    materialBoundaries,
    piezometricLine,
    setActiveViewOffset,
    setActiveViewScale,
    surfaceYAtX,
    udls,
  ]);

  const handleZoomStep = useCallback(
    (factor: number) => {
      const canvas = canvasRef.current;
      if (!canvas || viewScale <= 0) return;

      const rect = canvas.getBoundingClientRect();
      const w = rect.width;
      const h = rect.height;

      const oldScale = viewScale;
      const newScale = Math.max(0.1, Math.min(200, oldScale * factor));
      if (newScale === oldScale) return;

      const cx = w / 2;
      const cy = h / 2;
      const [ox, oy] = viewOffset;

      setActiveViewOffset([
        ox + (cx - w / 2) / newScale - (cx - w / 2) / oldScale,
        oy - (cy - h / 2) / newScale + (cy - h / 2) / oldScale,
      ]);
      setActiveViewScale(newScale);
    },
    [viewOffset, viewScale, setActiveViewOffset, setActiveViewScale],
  );

  const computeFitWidthScale = useCallback(() => {
    if (coordinates.length < 2) return null;

    const container = containerRef.current;
    const canvas = canvasRef.current;
    const rect = container?.getBoundingClientRect();
    const rulerPadding = RULER_SIZE_PX + 16;
    const w =
      (rect?.width ?? canvas?.getBoundingClientRect().width ?? 0) -
      rulerPadding;
    if (w <= 0) return null;

    const modelBounds = collectModelFitBounds({
      coordinates,
      materialBoundaries,
      piezometricLines: piezometricLine.lines,
      analysisLimits,
      udls,
      lineLoads,
      surfaceYAtX,
    });
    if (!modelBounds) return null;

    const { xMin, xMax, yMin, yMax } = modelBounds;
    const worldW = xMax - xMin || 10;
    const worldH = yMax - yMin || 10;
    const margin = Math.max(worldW, worldH) * 0.05;
    return w / (worldW + margin * 2);
  }, [
    analysisLimits,
    coordinates,
    lineLoads,
    materialBoundaries,
    piezometricLine,
    surfaceYAtX,
    udls,
  ]);

  const handleSetZoomPercent = useCallback(
    (percent: number) => {
      const fitWidthScale = computeFitWidthScale();
      if (!fitWidthScale || fitWidthScale <= 0) return;
      const scale = Math.max(
        0.1,
        Math.min(200, fitWidthScale * (percent / 100)),
      );
      setActiveViewScale(scale);
    },
    [computeFitWidthScale, setActiveViewScale],
  );

  const zoomPercent = useMemo(() => {
    // eslint-disable-next-line react-hooks/refs -- reading ref dimensions for display-only zoom percentage is safe
    const fitWidthScale = computeFitWidthScale();
    if (!fitWidthScale || fitWidthScale <= 0 || viewScale <= 0) return 100;
    return Math.max(1, Math.round((viewScale / fitWidthScale) * 100));
  }, [computeFitWidthScale, viewScale]);

  // Auto-fit when a project file is loaded / benchmarks opened
  const pendingFit = useAppStore((s) => s._pendingFitToScreen);
  const clearPendingFit = useAppStore((s) => s.clearPendingFitToScreen);
  useEffect(() => {
    if (!pendingFit) return;
    // Wait one frame so the canvas has valid dimensions after the state update
    const id = requestAnimationFrame(() => {
      handleFitToScreen();
      clearPendingFit();
    });
    return () => cancelAnimationFrame(id);
  }, [pendingFit, handleFitToScreen, clearPendingFit]);

  const handleCanvasPointerDown = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (zoomBoxActive && e.button === 0) {
        const rect = canvasRef.current?.getBoundingClientRect() ?? null;
        if (rect) setZoomBoxOrigin([rect.left, rect.top]);
        setZoomBoxStart([e.clientX, e.clientY]);
        setZoomBoxCurrent([e.clientX, e.clientY]);
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        return;
      }
      handlePointerDown(e);
    },
    [zoomBoxActive, handlePointerDown],
  );

  const handleCanvasPointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (zoomBoxStart) {
        setZoomBoxCurrent([e.clientX, e.clientY]);
        return;
      }
      handlePointerMove(e);
    },
    [zoomBoxStart, handlePointerMove],
  );

  const handleCanvasPointerUp = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (zoomBoxStart && zoomBoxCurrent) {
        const canvas = canvasRef.current;
        if (canvas) {
          const container = containerRef.current;
          const rect = canvas.getBoundingClientRect();
          const x0 = zoomBoxStart[0] - rect.left;
          const y0 = zoomBoxStart[1] - rect.top;
          const x1 = zoomBoxCurrent[0] - rect.left;
          const y1 = zoomBoxCurrent[1] - rect.top;

          const leftPx = Math.min(x0, x1);
          const rightPx = Math.max(x0, x1);
          const topPx = Math.min(y0, y1);
          const bottomPx = Math.max(y0, y1);

          if (rightPx - leftPx > 8 && bottomPx - topPx > 8) {
            const [wx0, wy0] = canvasToWorld(
              leftPx,
              topPx,
              rect.width,
              rect.height,
            );
            const [wx1, wy1] = canvasToWorld(
              rightPx,
              bottomPx,
              rect.width,
              rect.height,
            );
            const worldLeft = Math.min(wx0, wx1);
            const worldRight = Math.max(wx0, wx1);
            const worldBottom = Math.min(wy0, wy1);
            const worldTop = Math.max(wy0, wy1);
            const worldW = Math.max(0.001, worldRight - worldLeft);
            const worldH = Math.max(0.001, worldTop - worldBottom);
            const viewW = container?.clientWidth ?? rect.width;
            const viewH = container?.clientHeight ?? rect.height;
            const scale = Math.min(viewW / worldW, viewH / worldH);
            const cx = (worldLeft + worldRight) / 2;
            const cy = (worldBottom + worldTop) / 2;

            setActiveViewScale(Math.max(0.1, Math.min(200, scale)));
            setActiveViewOffset([-cx, -cy]);
          }
        }

        setZoomBoxStart(null);
        setZoomBoxCurrent(null);
        setZoomBoxActive(false);
        setZoomBoxOrigin(null);
        (e.target as HTMLElement).releasePointerCapture(e.pointerId);
        return;
      }

      handlePointerUp(e);
    },
    [
      zoomBoxStart,
      zoomBoxCurrent,
      canvasToWorld,
      setActiveViewOffset,
      setActiveViewScale,
      handlePointerUp,
    ],
  );

  const zoomRect = useMemo(() => {
    if (!zoomBoxStart || !zoomBoxCurrent || !zoomBoxOrigin) return null;
    const [left, top] = zoomBoxOrigin;
    const x0 = zoomBoxStart[0] - left;
    const y0 = zoomBoxStart[1] - top;
    const x1 = zoomBoxCurrent[0] - left;
    const y1 = zoomBoxCurrent[1] - top;
    return {
      left: Math.min(x0, x1),
      top: Math.min(y0, y1),
      width: Math.abs(x1 - x0),
      height: Math.abs(y1 - y0),
    };
  }, [zoomBoxStart, zoomBoxCurrent, zoomBoxOrigin]);

  useEffect(() => {
    setCanvasToolbar({
      zoomBoxActive,
      panActive,
      zoomPercent,
      onFitToScreen: handleFitToScreen,
      onZoomIn: () => handleZoomStep(1.1),
      onZoomOut: () => handleZoomStep(0.9),
      onSetZoomPercent: handleSetZoomPercent,
      onToggleZoomBox: () => {
        setZoomBoxStart(null);
        setZoomBoxCurrent(null);
        setZoomBoxOrigin(null);
        setZoomBoxActive((v) => !v);
        setPanActive(false);
      },
      onTogglePan: () => {
        setPanActive((v) => !v);
        setZoomBoxActive(false);
      },
    });

    return () => setCanvasToolbar(null);
  }, [
    zoomBoxActive,
    panActive,
    zoomPercent,
    handleFitToScreen,
    handleZoomStep,
    handleSetZoomPercent,
    setCanvasToolbar,
  ]);

  return (
    <div className="relative w-full h-full">
      <div
        ref={containerRef}
        className="relative w-full h-full overflow-hidden"
        style={{
          background: "var(--color-canvas-bg)",
          overscrollBehavior: "none",
        }}
        onWheelCapture={handleWheelCapture}
      >
        <canvas
          ref={canvasRef}
          className="absolute inset-0 w-full h-full"
          style={{
            cursor: assigningMaterialId
              ? "crosshair"
              : zoomBoxActive
                ? "crosshair"
                : panActive
                  ? "grab"
                  : hoverHit?.kind === "limit" ||
                      hoverHit?.kind === "udl" ||
                      hoverHit?.kind === "lineLoad"
                    ? "ew-resize"
                    : hoverHit
                      ? "grab"
                      : "default",
          }}
          onPointerDown={handleCanvasPointerDown}
          onPointerMove={handleCanvasPointerMove}
          onPointerUp={handleCanvasPointerUp}
          onPointerCancel={handlePointerCancel}
          onWheel={handleWheel}
          onContextMenu={handleContextMenu}
          data-testid="slope-canvas"
        />
        <canvas
          ref={crosshairCanvasRef}
          className="absolute inset-0 w-full h-full pointer-events-none"
        />
        {zoomRect && (
          <div
            className="absolute pointer-events-none"
            style={{
              left: zoomRect.left,
              top: zoomRect.top,
              width: zoomRect.width,
              height: zoomRect.height,
              border: "1px dashed var(--color-vsc-accent)",
              background: "rgba(0,120,212,0.12)",
              zIndex: 35,
            }}
          />
        )}

        {mouseWorld && (
          <div
            className="absolute bottom-10 right-3 text-[11px] font-mono select-none pointer-events-none z-70"
            style={{ color: "var(--color-vsc-text-muted)", display: "none" }}
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
        <ContextMenuOverlay menu={contextMenu} />

        <MaterialPickerMenu
          picker={materialPicker}
          materials={materials}
          onSelect={(worldPoint, materialId) =>
            setRegionMaterial(worldPoint, materialId)
          }
          onClose={() => setMaterialPicker(null)}
        />
      </div>
      <AxisOverlay containerRef={containerRef} canvasRef={canvasRef} />
    </div>
  );
}
