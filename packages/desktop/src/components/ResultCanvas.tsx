/**
 * SlopeCanvas — Interactive HTML5 Canvas for editing slope geometry.
 */

import type React from "react";
import { useRef, useEffect, useCallback, useMemo, useState } from "react";
import { PLOT_MARGINS, useAppStore } from "../store/app-store";
import { useHitTest } from "../features/canvas/hooks/useHitTest";
import { useViewport } from "../features/canvas/hooks/useViewport";
import { usePointerHandlers } from "../features/canvas/hooks/usePointerHandlers";
import { useContextMenu } from "../features/canvas/hooks/useContextMenu";
import { useCanvasSizing } from "../features/canvas/hooks/useCanvasSizing";
import { useRafCleanup } from "../features/canvas/hooks/useRafCleanup";
import { useCanvasDrawLoop } from "../features/canvas/hooks/useCanvasDrawLoop";
import { drawCanvas, type DrawCanvasParams } from "../features/canvas/draw";
import { ARROW_HEIGHT_PX, RULER_SIZE_PX } from "../features/canvas/constants";
import {
  collectModelFitBounds,
  computePaperFrame,
  extendBoundsWithFosLabelFitPadding,
  extendBoundsWithResultFitExtras,
  surfaceYAtXFromCoordinates,
} from "../features/canvas/helpers";
import { AnnotationStyleMenu } from "../features/canvas/AnnotationStyleMenu";
import { ContextMenuOverlay } from "../features/canvas/ContextMenuOverlay";
import { AxisOverlay } from "../features/canvas/AxisOverlay";

export function ResultCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const crosshairCanvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const drawRafRef = useRef<number | null>(null);
  const drawDirtyRef = useRef(false);
  const drawArgsRef = useRef<Parameters<typeof drawCanvas>[1] | null>(null);
  const drawMetaRef = useRef({ dpr: 1 });
  const prevResultLayoutRef = useRef<{ width: number; height: number } | null>(
    null,
  );
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

  const mode = "result" as const;
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
  const setCanvasToolbar = useAppStore((s) => s.setCanvasToolbar);

  const editingExterior = false;
  const editingBoundaries = false;
  const editingPiezo = false;
  const editingAssignment = false;
  const editingLimits = false;
  const editingLoads = false;

  const surfaceYAtX = useCallback(
    (x: number): number | null => surfaceYAtXFromCoordinates(coordinates, x),
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
  } = useViewport(canvasRef, containerRef);

  const setMaterialPicker = useCallback(() => {}, []);

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
    panActive,
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

  // Sync mouse world position to the store so StatusBar can display it
  const setCursorWorld = useAppStore((s) => s.setCursorWorld);
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

  useEffect(() => {
    if (canvasSize.width <= 0 || canvasSize.height <= 0) return;
    if (mode !== "result") {
      prevResultLayoutRef.current = null;
      return;
    }

    const prev = prevResultLayoutRef.current;
    prevResultLayoutRef.current = {
      width: canvasSize.width,
      height: canvasSize.height,
    };

    if (!prev) return;
    if (prev.width === canvasSize.width && prev.height === canvasSize.height)
      return;
    if (viewScale <= 0) return;

    const getPlotBox = (w: number, h: number) => {
      if (resultViewSettings.paperFrame.showFrame) {
        const pf = computePaperFrame(
          w,
          h,
          resultViewSettings.paperFrame.paperSize,
        );
        const PLOT_PAD_L = pf.w * PLOT_MARGINS.L;
        const PLOT_PAD_B = pf.h * PLOT_MARGINS.B;
        const PLOT_PAD_T = pf.h * PLOT_MARGINS.T;
        const PLOT_PAD_R = pf.w * PLOT_MARGINS.R;
        return {
          x: pf.x + PLOT_PAD_L,
          y: pf.y + PLOT_PAD_T,
          w: pf.w - PLOT_PAD_L - PLOT_PAD_R,
          h: pf.h - PLOT_PAD_T - PLOT_PAD_B,
        };
      }

      return { x: 0, y: 0, w, h };
    };

    const prevBox = getPlotBox(prev.width, prev.height);
    const nextBox = getPlotBox(canvasSize.width, canvasSize.height);
    if (prevBox.w <= 0 || prevBox.h <= 0 || nextBox.w <= 0 || nextBox.h <= 0)
      return;

    const prevLeft = (prevBox.x - prev.width / 2) / viewScale - viewOffset[0];
    const prevRight =
      (prevBox.x + prevBox.w - prev.width / 2) / viewScale - viewOffset[0];
    const prevTop = -(prevBox.y - prev.height / 2) / viewScale - viewOffset[1];
    const prevBottom =
      -(prevBox.y + prevBox.h - prev.height / 2) / viewScale - viewOffset[1];

    const worldW = prevRight - prevLeft;
    const worldH = prevTop - prevBottom;
    if (worldW <= 0 || worldH <= 0) return;

    const nextScale = Math.min(nextBox.w / worldW, nextBox.h / worldH);
    if (!Number.isFinite(nextScale) || nextScale <= 0) return;

    const worldCx = (prevLeft + prevRight) / 2;
    const worldCy = (prevTop + prevBottom) / 2;
    const targetCx = nextBox.x + nextBox.w / 2;
    const targetCy = nextBox.y + nextBox.h / 2;

    const ox = (targetCx - canvasSize.width / 2) / nextScale - worldCx;
    const oy = (canvasSize.height / 2 - targetCy) / nextScale - worldCy;

    setActiveViewScale(nextScale);
    setActiveViewOffset([ox, oy]);
  }, [
    canvasSize.width,
    canvasSize.height,
    mode,
    resultViewSettings.paperFrame.showFrame,
    resultViewSettings.paperFrame.paperSize,
    viewScale,
    viewOffset,
    setActiveViewScale,
    setActiveViewOffset,
  ]);

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
  }, [canvasSize]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setContextMenu(null);
        setAssigningMaterial(null);
        setAnnoStyleMenu(null);
        return;
      }
      if (
        (e.key === "ArrowLeft" ||
          e.key === "ArrowRight" ||
          e.key === "ArrowUp" ||
          e.key === "ArrowDown") &&
        selectedAnnotationIds.length > 0
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
    updateAnnotation,
    setAssigningMaterial,
    setContextMenu,
    setAnnoStyleMenu,
  ]);

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

    let fitW = w;
    let fitH = h;
    let targetCx = w / 2;
    let targetCy = h / 2;

    if (result && resultViewSettings.paperFrame.showFrame) {
      const pf = computePaperFrame(
        w,
        h,
        resultViewSettings.paperFrame.paperSize,
      );
      const PLOT_PAD_L = pf.w * PLOT_MARGINS.L;
      const PLOT_PAD_B = pf.h * PLOT_MARGINS.B;
      const PLOT_PAD_T = pf.h * PLOT_MARGINS.T;
      const PLOT_PAD_R = pf.w * PLOT_MARGINS.R;

      fitW = pf.w - PLOT_PAD_L - PLOT_PAD_R;
      fitH = pf.h - PLOT_PAD_T - PLOT_PAD_B;
      targetCx = pf.x + PLOT_PAD_L + fitW / 2;
      targetCy = pf.y + PLOT_PAD_T + fitH / 2;
    }

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

    let { xMin, xMax, yMin, yMax } = modelBounds;

    const addPoint = (x: number, y: number) => {
      xMin = Math.min(xMin, x);
      xMax = Math.max(xMax, x);
      yMin = Math.min(yMin, y);
      yMax = Math.max(yMax, y);
    };

    if (result) {
      extendBoundsWithResultFitExtras({
        result,
        resultViewSettings,
        materials,
        projectInfo,
        canvas,
        width: w,
        height: h,
        canvasToWorld,
        addPoint,
      });
    }

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

    const fosPaddedBounds = extendBoundsWithFosLabelFitPadding({
      result,
      showFosLabel: resultViewSettings.showFosLabel,
      canvas,
      scale,
      bounds: { xMin, xMax, yMin, yMax },
    });
    if (fosPaddedBounds) {
      ({ xMin, xMax, yMin, yMax } = fosPaddedBounds);
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
    canvasToWorld,
    coordinates,
    lineLoads,
    materialBoundaries,
    materials,
    piezometricLine,
    projectInfo,
    result,
    resultViewSettings,
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
      onFitToScreen: handleFitToScreen,
      onZoomIn: () => handleZoomStep(1.1),
      onZoomOut: () => handleZoomStep(0.9),
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
    handleFitToScreen,
    handleZoomStep,
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

        <AnnotationStyleMenu
          menu={annoStyleMenu}
          annotations={resultViewSettings.annotations}
          updateAnnotation={updateAnnotation}
          removeAnnotation={removeAnnotation}
          onClose={() => setAnnoStyleMenu(null)}
        />
      </div>
      <AxisOverlay containerRef={containerRef} canvasRef={canvasRef} />
    </div>
  );
}
