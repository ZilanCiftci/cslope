/**
 * SlopeCanvas — Interactive HTML5 Canvas for editing slope geometry.
 */

import type React from "react";
import { useRef, useEffect, useCallback, useMemo, useState } from "react";
import {
  PLOT_MARGINS,
  useAppStore,
  useCanvasModelState,
  useCanvasActions,
} from "../store/app-store";
import type { Annotation } from "../store/types";
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
import {
  AnnotationStyleMenu,
  type AnnotationDraft,
} from "../features/canvas/AnnotationStyleMenu";
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
  const prevPlotViewportRef = useRef<{
    canvasW: number;
    canvasH: number;
    plotBox: { x: number; y: number; w: number; h: number };
    viewScale: number;
    viewOffset: [number, number];
  } | null>(null);
  const [zoomBoxActive, setZoomBoxActive] = useState(false);
  const [panActive, setPanActive] = useState(false);
  const [zoomBoxStart, setZoomBoxStart] = useState<[number, number] | null>(
    null,
  );
  const [zoomBoxCurrent, setZoomBoxCurrent] = useState<[number, number] | null>(
    null,
  );
  const paperPanRef = useRef<{
    startPx: [number, number];
    startOffset: [number, number];
  } | null>(null);
  const [zoomBoxOrigin, setZoomBoxOrigin] = useState<[number, number] | null>(
    null,
  );
  const [annotationStylePreview, setAnnotationStylePreview] = useState<{
    annoId: string;
    draft: AnnotationDraft | null;
  } | null>(null);
  const canvasSize = useCanvasSizing(canvasRef, crosshairCanvasRef);

  const mode = "result" as const;
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
    parameters,
  } = useCanvasModelState();
  const resultViewSettingsForRender = useMemo(() => {
    if (!annotationStylePreview || !annotationStylePreview.draft) {
      return resultViewSettings;
    }

    const mergedAnnotations = resultViewSettings.annotations.map((anno) =>
      anno.id === annotationStylePreview.annoId
        ? ({ ...anno, ...annotationStylePreview.draft } as Annotation)
        : anno,
    );

    return {
      ...resultViewSettings,
      annotations: mergedAnnotations,
    };
  }, [resultViewSettings, annotationStylePreview]);
  const setRvs = useAppStore((s) => s.setResultViewSettings);
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
    removeAnnotation,
    setSelectedAnnotations,
    toggleAnnotationSelection,
    alignAnnotations,
    setCanvasToolbar,
    setCursorWorld,
    setActivePiezoLine,
  } = useCanvasActions();

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

  const computePlotBox = useCallback(
    (w: number, h: number) => {
      if (resultViewSettings.paperFrame.showFrame) {
        const pf = computePaperFrame(
          w,
          h,
          resultViewSettings.paperFrame.paperSize,
          resultViewSettings.paperFrame.landscape,
          resultViewSettings.paperFrame.zoom ?? 1,
          resultViewSettings.paperFrame.offsetX ?? 0,
          resultViewSettings.paperFrame.offsetY ?? 0,
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
    },
    [
      resultViewSettings.paperFrame.showFrame,
      resultViewSettings.paperFrame.paperSize,
      resultViewSettings.paperFrame.landscape,
      resultViewSettings.paperFrame.zoom,
      resultViewSettings.paperFrame.offsetX,
      resultViewSettings.paperFrame.offsetY,
    ],
  );

  useRafCleanup(drawRafRef);

  useEffect(() => {
    if (canvasSize.width <= 0 || canvasSize.height <= 0) return;
    if (mode !== "result") {
      prevPlotViewportRef.current = null;
      return;
    }
    if (viewScale <= 0) return;

    const nextBox = computePlotBox(canvasSize.width, canvasSize.height);
    const prev = prevPlotViewportRef.current;

    if (!prev) {
      prevPlotViewportRef.current = {
        canvasW: canvasSize.width,
        canvasH: canvasSize.height,
        plotBox: nextBox,
        viewScale,
        viewOffset: [viewOffset[0], viewOffset[1]],
      };
      return;
    }

    const sameCanvas =
      prev.canvasW === canvasSize.width && prev.canvasH === canvasSize.height;
    const sameBox =
      Math.abs(prev.plotBox.x - nextBox.x) < 1e-6 &&
      Math.abs(prev.plotBox.y - nextBox.y) < 1e-6 &&
      Math.abs(prev.plotBox.w - nextBox.w) < 1e-6 &&
      Math.abs(prev.plotBox.h - nextBox.h) < 1e-6;

    if (sameCanvas && sameBox) {
      // Keep snapshot in sync when viewport changes for reasons other than
      // paper-frame layout changes (for example view-lock value edits).
      prevPlotViewportRef.current = {
        canvasW: canvasSize.width,
        canvasH: canvasSize.height,
        plotBox: nextBox,
        viewScale,
        viewOffset: [viewOffset[0], viewOffset[1]],
      };
      return;
    }

    const prevBox = prev.plotBox;
    if (prevBox.w <= 0 || prevBox.h <= 0 || nextBox.w <= 0 || nextBox.h <= 0)
      return;

    const prevLeft =
      (prevBox.x - prev.canvasW / 2) / prev.viewScale - prev.viewOffset[0];
    const prevRight =
      (prevBox.x + prevBox.w - prev.canvasW / 2) / prev.viewScale -
      prev.viewOffset[0];
    const prevTop =
      -(prevBox.y - prev.canvasH / 2) / prev.viewScale - prev.viewOffset[1];
    const prevBottom =
      -(prevBox.y + prevBox.h - prev.canvasH / 2) / prev.viewScale -
      prev.viewOffset[1];

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

    prevPlotViewportRef.current = {
      canvasW: canvasSize.width,
      canvasH: canvasSize.height,
      plotBox: nextBox,
      viewScale: nextScale,
      viewOffset: [ox, oy],
    };
  }, [
    canvasSize.width,
    canvasSize.height,
    mode,
    computePlotBox,
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
      resultViewSettings: resultViewSettingsForRender,
      orientation,
      coordinates,
      materials,
      materialBoundaries,
      regionMaterials,
      selectedRegionKey,
      editingAssignment,
      selectedAnnotationIds,
      projectInfo,
      parameters,
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
      resultViewSettingsForRender,
      selectedAnnotationIds,
      projectInfo,
      parameters,
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
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }

      if (e.key === "Escape") {
        setContextMenu(null);
        setAssigningMaterial(null);
        setAnnoStyleMenu(null);
        setAnnotationStylePreview(null);
        return;
      }

      if (
        (e.key === "Delete" || e.key === "Backspace") &&
        selectedAnnotationIds.length > 0
      ) {
        e.preventDefault();
        for (const id of selectedAnnotationIds) {
          removeAnnotation(id);
        }
        setSelectedAnnotations([]);
        setAnnoStyleMenu(null);
        setAnnotationStylePreview(null);
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
    removeAnnotation,
    setSelectedAnnotations,
    setAssigningMaterial,
    setContextMenu,
    setAnnoStyleMenu,
    setAnnotationStylePreview,
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

    // Reset paper frame zoom/offset to defaults so the frame fits the canvas
    if (resultViewSettings.paperFrame.showFrame) {
      setRvs({
        paperFrame: {
          ...resultViewSettings.paperFrame,
          zoom: 1,
          offsetX: 0,
          offsetY: 0,
        },
      });
    }

    let fitW = w;
    let fitH = h;
    let targetCx = w / 2;
    let targetCy = h / 2;

    if (result && resultViewSettings.paperFrame.showFrame) {
      // Compute paper frame at default zoom=1 / offset=0 for fitting
      const pf = computePaperFrame(
        w,
        h,
        resultViewSettings.paperFrame.paperSize,
        resultViewSettings.paperFrame.landscape,
        1,
        0,
        0,
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
        parameters,
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
    parameters,
    piezometricLine,
    projectInfo,
    result,
    resultViewSettings,
    setActiveViewOffset,
    setActiveViewScale,
    setRvs,
    surfaceYAtX,
    udls,
  ]);

  const handleZoomStep = useCallback(
    (factor: number) => {
      const currentZoom = resultViewSettings.paperFrame.zoom ?? 1;
      const nextZoom = Math.max(0.25, Math.min(3, currentZoom * factor));
      setRvs({
        paperFrame: {
          ...resultViewSettings.paperFrame,
          zoom: nextZoom,
        },
      });
    },
    [resultViewSettings.paperFrame, setRvs],
  );

  const handleSetZoomPercent = useCallback(
    (percent: number) => {
      const nextZoom = Math.max(0.25, Math.min(3, percent / 100));
      setRvs({
        paperFrame: {
          ...resultViewSettings.paperFrame,
          zoom: nextZoom,
        },
      });
    },
    [resultViewSettings.paperFrame, setRvs],
  );

  const zoomPercent = useMemo(() => {
    return Math.max(
      1,
      Math.round((resultViewSettings.paperFrame.zoom ?? 1) * 100),
    );
  }, [resultViewSettings.paperFrame.zoom]);

  const handleResultWheel = useCallback(
    (e: React.WheelEvent<HTMLCanvasElement>) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.ctrlKey) {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const rect = canvas.getBoundingClientRect();
        // Mouse position in CSS pixels relative to canvas
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;

        const pf = resultViewSettings.paperFrame;
        const currentZoom = pf.zoom ?? 1;
        const factor = e.deltaY > 0 ? 0.9 : 1.1;
        const nextZoom = Math.max(0.25, Math.min(3, currentZoom * factor));

        // Paper frame center (before offset) at current zoom
        const cxBefore = rect.width / 2 + (pf.offsetX ?? 0);
        const cyBefore = rect.height / 2 + (pf.offsetY ?? 0);

        // Vector from paper center to mouse
        const dx = mx - cxBefore;
        const dy = my - cyBefore;

        // Rescale that vector so the point under the mouse stays put
        const ratio = nextZoom / currentZoom;
        const newOffsetX = (pf.offsetX ?? 0) + dx - dx * ratio;
        const newOffsetY = (pf.offsetY ?? 0) + dy - dy * ratio;

        setRvs({
          paperFrame: {
            ...pf,
            zoom: nextZoom,
            offsetX: newOffsetX,
            offsetY: newOffsetY,
          },
        });
      }
    },
    [resultViewSettings.paperFrame, setRvs],
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
      if (mode === "result" && e.button === 1) {
        paperPanRef.current = {
          startPx: [e.clientX, e.clientY],
          startOffset: [
            resultViewSettings.paperFrame.offsetX ?? 0,
            resultViewSettings.paperFrame.offsetY ?? 0,
          ],
        };
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        return;
      }

      if (panActive && e.button === 0) {
        paperPanRef.current = {
          startPx: [e.clientX, e.clientY],
          startOffset: [
            resultViewSettings.paperFrame.offsetX ?? 0,
            resultViewSettings.paperFrame.offsetY ?? 0,
          ],
        };
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        return;
      }

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
    [
      mode,
      panActive,
      resultViewSettings.paperFrame.offsetX,
      resultViewSettings.paperFrame.offsetY,
      zoomBoxActive,
      handlePointerDown,
    ],
  );

  const handleCanvasPointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (paperPanRef.current) {
        const dx = e.clientX - paperPanRef.current.startPx[0];
        const dy = e.clientY - paperPanRef.current.startPx[1];
        setRvs({
          paperFrame: {
            ...resultViewSettings.paperFrame,
            offsetX: paperPanRef.current.startOffset[0] + dx,
            offsetY: paperPanRef.current.startOffset[1] + dy,
          },
        });
        return;
      }

      if (zoomBoxStart) {
        setZoomBoxCurrent([e.clientX, e.clientY]);
        return;
      }
      handlePointerMove(e);
    },
    [resultViewSettings.paperFrame, setRvs, zoomBoxStart, handlePointerMove],
  );

  const handleCanvasPointerUp = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (paperPanRef.current) {
        paperPanRef.current = null;
        (e.target as HTMLElement).releasePointerCapture(e.pointerId);
        return;
      }

      if (zoomBoxStart && zoomBoxCurrent) {
        const canvas = canvasRef.current;
        if (canvas) {
          const rect = canvas.getBoundingClientRect();
          const x0 = zoomBoxStart[0] - rect.left;
          const y0 = zoomBoxStart[1] - rect.top;
          const x1 = zoomBoxCurrent[0] - rect.left;
          const y1 = zoomBoxCurrent[1] - rect.top;

          const leftPx = Math.min(x0, x1);
          const rightPx = Math.max(x0, x1);
          const topPx = Math.min(y0, y1);
          const bottomPx = Math.max(y0, y1);

          const boxW = rightPx - leftPx;
          const boxH = bottomPx - topPx;

          if (boxW > 8 && boxH > 8) {
            // Zoom the paper frame so the selected region fills the canvas
            const pf = resultViewSettings.paperFrame;
            const currentZoom = pf.zoom ?? 1;
            const currentOffsetX = pf.offsetX ?? 0;
            const currentOffsetY = pf.offsetY ?? 0;

            // Scale factor: canvas size / zoom-box size
            const zoomFactor = Math.min(rect.width / boxW, rect.height / boxH);
            const nextZoom = Math.max(
              0.25,
              Math.min(3, currentZoom * zoomFactor),
            );

            // Center of the zoom box in canvas coords
            const boxCx = (leftPx + rightPx) / 2;
            const boxCy = (topPx + bottomPx) / 2;

            // Box center in paper-relative coords (before zoom/offset)
            const paperRelX =
              (boxCx - rect.width / 2 - currentOffsetX) / currentZoom;
            const paperRelY =
              (boxCy - rect.height / 2 - currentOffsetY) / currentZoom;

            // Offset so that paper-relative point lands at canvas center
            const newOffsetX = -paperRelX * nextZoom;
            const newOffsetY = -paperRelY * nextZoom;

            setRvs({
              paperFrame: {
                ...pf,
                zoom: nextZoom,
                offsetX: newOffsetX,
                offsetY: newOffsetY,
              },
            });
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
      resultViewSettings.paperFrame,
      setRvs,
      handlePointerUp,
    ],
  );

  const handleCanvasPointerCancel = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (paperPanRef.current) {
        paperPanRef.current = null;
        (e.target as HTMLElement).releasePointerCapture(e.pointerId);
        return;
      }
      handlePointerCancel(e);
    },
    [handlePointerCancel],
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
        setZoomBoxActive((v) => {
          const next = !v;
          if (next) setPanActive(false);
          return next;
        });
      },
      onTogglePan: () => {
        setPanActive((v) => {
          const next = !v;
          if (next) setZoomBoxActive(false);
          return next;
        });
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
          onPointerCancel={handleCanvasPointerCancel}
          onWheel={handleResultWheel}
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
          onPreviewChange={(annoId, draft) => {
            if (!draft) {
              setAnnotationStylePreview((prev) =>
                prev?.annoId === annoId ? null : prev,
              );
              return;
            }
            setAnnotationStylePreview({ annoId, draft });
          }}
          onClose={() => {
            setAnnotationStylePreview(null);
            setAnnoStyleMenu(null);
          }}
        />
      </div>
      <AxisOverlay containerRef={containerRef} canvasRef={canvasRef} />
    </div>
  );
}
