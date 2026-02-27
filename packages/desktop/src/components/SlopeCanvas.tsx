/**
 * SlopeCanvas — Interactive HTML5 Canvas for editing slope geometry.
 */

import type React from "react";
import { useRef, useEffect, useCallback, useMemo, useState } from "react";
import { useAppStore } from "../store/app-store";
import { useHitTest } from "../features/canvas/hooks/useHitTest";
import { useViewport } from "../features/canvas/hooks/useViewport";
import { usePointerHandlers } from "../features/canvas/hooks/usePointerHandlers";
import { useContextMenu } from "../features/canvas/hooks/useContextMenu";
import { useMaterialPicker } from "../features/canvas/hooks/useMaterialPicker";
import { drawCanvas } from "../features/canvas/draw";
import { ARROW_HEIGHT_PX, cssVar } from "../features/canvas/constants";
import { computePaperFrame } from "../features/canvas/helpers";
import { circleArcPoints } from "../utils/arc";

const SCROLL_FALLBACK = 4000; // virtual surface to show scrollbars when sizes are missing
const SCROLL_PAN_FACTOR = 0.25; // dampen scrollbar panning sensitivity

export function SlopeCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const crosshairCanvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollStateRef = useRef({ x: 0, y: 0 });
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
  const [canvasSize, setCanvasSize] = useState({
    width: 0,
    height: 0,
    dpr: window.devicePixelRatio || 1,
  });

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
  const setCanvasToolbar = useAppStore((s) => s.setCanvasToolbar);

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

  const recenterScrollbars = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const centerX = (el.scrollWidth - el.clientWidth) / 2;
    const centerY = (el.scrollHeight - el.clientHeight) / 2;
    el.scrollLeft = centerX;
    el.scrollTop = centerY;
    scrollStateRef.current = { x: centerX, y: centerY };
  }, []);

  const {
    mouseWorld,
    hoverHit,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    handleWheel,
  } = usePointerHandlers({
    canvasRef,
    containerRef,
    getEventWorldPos,
    viewOffset,
    setActiveViewOffset,
    setActiveViewScale,
    onZoomCompleted: recenterScrollbars,
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

  // Center scrollbars initially so we can treat scroll deltas as pan inputs.
  useEffect(() => {
    recenterScrollbars();
  }, [recenterScrollbars]);

  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;

    const dx = el.scrollLeft - scrollStateRef.current.x;
    const dy = el.scrollTop - scrollStateRef.current.y;
    if (dx === 0 && dy === 0) return;

    const state = useAppStore.getState();
    const scale =
      (state.mode === "result" ? state.resultViewScale : state.editViewScale) ||
      1;
    const offset =
      state.mode === "result" ? state.resultViewOffset : state.editViewOffset;
    // Invert directions so scrollbar motion matches model motion (right→right, up→up).
    setActiveViewOffset([
      offset[0] - (dx / scale) * SCROLL_PAN_FACTOR,
      offset[1] + (dy / scale) * SCROLL_PAN_FACTOR,
    ]);

    // Track current position so thumb moves naturally.
    scrollStateRef.current = { x: el.scrollLeft, y: el.scrollTop };
  }, [setActiveViewOffset]);

  const handleWheelCapture = useCallback(
    (e: React.WheelEvent<HTMLDivElement>) => {
      // Prevent page zoom; only stop propagation when not using Ctrl-zoom (so canvas still handles it).
      // Prevent browser zoom when user requests canvas zoom with Ctrl+wheel.
      if (e.ctrlKey) e.preventDefault();
    },
    [],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const updateSize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      if (rect.width <= 0 || rect.height <= 0) return;
      if (
        rect.width === canvasSize.width &&
        rect.height === canvasSize.height &&
        dpr === canvasSize.dpr
      ) {
        return;
      }
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      setCanvasSize({ width: rect.width, height: rect.height, dpr });
    };

    updateSize();
    const ro = new ResizeObserver(() => updateSize());
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [canvasSize.width, canvasSize.height, canvasSize.dpr]);

  useEffect(() => {
    const canvas = crosshairCanvasRef.current;
    if (!canvas || canvasSize.width <= 0 || canvasSize.height <= 0) return;
    canvas.width = canvasSize.width * canvasSize.dpr;
    canvas.height = canvasSize.height * canvasSize.dpr;
  }, [canvasSize.width, canvasSize.height, canvasSize.dpr]);

  // ── Draw ────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || canvasSize.width <= 0 || canvasSize.height <= 0) return;
    drawMetaRef.current = { dpr: canvasSize.dpr };

    // Ensure redraw when theme CSS variables change
    void theme;

    drawArgsRef.current = {
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
    };

    const requestDraw = () => {
      if (drawRafRef.current !== null) return;
      drawRafRef.current = requestAnimationFrame(() => {
        drawRafRef.current = null;
        if (!drawDirtyRef.current) return;
        drawDirtyRef.current = false;

        const canvas = canvasRef.current;
        const args = drawArgsRef.current;
        if (!canvas || !args) return;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        ctx.setTransform(
          drawMetaRef.current.dpr,
          0,
          0,
          drawMetaRef.current.dpr,
          0,
          0,
        );
        drawCanvas(ctx, args);

        if (drawDirtyRef.current) requestDraw();
      });
    };

    drawDirtyRef.current = true;
    requestDraw();
  }, [
    canvasSize,
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
    theme,
  ]);

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

  useEffect(() => {
    return () => {
      if (drawRafRef.current !== null) {
        cancelAnimationFrame(drawRafRef.current);
        drawRafRef.current = null;
      }
    };
  }, []);

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

  const handleFitToScreen = useCallback(() => {
    if (coordinates.length < 2) return;

    const container = containerRef.current;
    const canvas = canvasRef.current;
    const rect = container?.getBoundingClientRect();
    const w = rect?.width ?? canvas?.getBoundingClientRect().width ?? 0;
    const h = rect?.height ?? canvas?.getBoundingClientRect().height ?? 0;
    if (w <= 0 || h <= 0) return;

    let xMin = Number.POSITIVE_INFINITY;
    let xMax = Number.NEGATIVE_INFINITY;
    let yMin = Number.POSITIVE_INFINITY;
    let yMax = Number.NEGATIVE_INFINITY;

    const addPoint = (x: number, y: number) => {
      xMin = Math.min(xMin, x);
      xMax = Math.max(xMax, x);
      yMin = Math.min(yMin, y);
      yMax = Math.max(yMax, y);
    };

    const addCanvasRect = (
      x: number,
      y: number,
      width: number,
      height: number,
    ) => {
      const corners: [number, number][] = [
        [x, y],
        [x + width, y],
        [x, y + height],
        [x + width, y + height],
      ];
      for (const [px, py] of corners) {
        const [wx, wy] = canvasToWorld(px, py, w, h);
        addPoint(wx, wy);
      }
    };

    for (const [x, y] of coordinates) addPoint(x, y);

    for (const boundary of materialBoundaries) {
      for (const [x, y] of boundary.coordinates) addPoint(x, y);
    }

    for (const line of piezometricLine.lines) {
      for (const [x, y] of line.coordinates) addPoint(x, y);
    }

    if (analysisLimits.enabled) {
      const entryLeftY = surfaceYAtX(analysisLimits.entryLeftX);
      if (entryLeftY !== null) addPoint(analysisLimits.entryLeftX, entryLeftY);
      const entryRightY = surfaceYAtX(analysisLimits.entryRightX);
      if (entryRightY !== null)
        addPoint(analysisLimits.entryRightX, entryRightY);
      const exitLeftY = surfaceYAtX(analysisLimits.exitLeftX);
      if (exitLeftY !== null) addPoint(analysisLimits.exitLeftX, exitLeftY);
      const exitRightY = surfaceYAtX(analysisLimits.exitRightX);
      if (exitRightY !== null) addPoint(analysisLimits.exitRightX, exitRightY);
    }

    for (const udl of udls) {
      const y1 = surfaceYAtX(udl.x1);
      if (y1 !== null) addPoint(udl.x1, y1);
      const y2 = surfaceYAtX(udl.x2);
      if (y2 !== null) addPoint(udl.x2, y2);
    }

    for (const lineLoad of lineLoads) {
      const y = surfaceYAtX(lineLoad.x);
      if (y !== null) addPoint(lineLoad.x, y);
    }

    if (mode === "result" && result) {
      const ctx = canvas?.getContext("2d") ?? null;
      const rvs = resultViewSettings;
      const surfaces = (() => {
        if (rvs.surfaceDisplay === "critical") {
          return result.criticalSurface ? [result.criticalSurface] : [];
        }
        if (rvs.surfaceDisplay === "filter") {
          return result.allSurfaces.filter((s) => s.fos <= rvs.fosFilterMax);
        }
        return result.allSurfaces;
      })();

      const addSurface = (surf: {
        cx: number;
        cy: number;
        radius: number;
        entryPoint: [number, number];
        exitPoint: [number, number];
      }) => {
        addPoint(surf.cx, surf.cy);
        const arcPts = circleArcPoints(
          surf.cx,
          surf.cy,
          surf.radius,
          surf.entryPoint,
          surf.exitPoint,
        );
        for (const [px, py] of arcPts) addPoint(px, py);
      };

      for (const surf of surfaces) addSurface(surf);
      if (result.criticalSurface) addSurface(result.criticalSurface);

      if (ctx && rvs.annotations.length > 0) {
        const pf = computePaperFrame(w, h, rvs.paperFrame.paperSize);
        const annoScale = Math.min(pf.w, pf.h) / 600;

        const resolveAnnotationText = (text: string) => {
          if (!text) return "";
          return text
            .replace(/#Title/gi, projectInfo.title)
            .replace(/#Subtitle/gi, projectInfo.subtitle)
            .replace(/#Client/gi, projectInfo.client)
            .replace(/#ProjectNumber/gi, projectInfo.projectNumber)
            .replace(/#Revision/gi, projectInfo.revision)
            .replace(/#Author/gi, projectInfo.author)
            .replace(/#Checker/gi, projectInfo.checker)
            .replace(/#Date/gi, projectInfo.date)
            .replace(/#Description/gi, projectInfo.description)
            .replace(/#FOS/gi, result.minFOS.toFixed(3))
            .replace(/#MinFOS/gi, result.minFOS.toFixed(3))
            .replace(/#Method/gi, result.method)
            .replace(/\n/g, "\n");
        };

        const measureParamBlock = (title: string, lines: string[]) => {
          const padding = 8 * annoScale;
          const lineHeight = 16 * annoScale;
          const titleHeight = 20 * annoScale;
          const font = `${12 * annoScale}px sans-serif`;
          const titleFont = `bold ${12 * annoScale}px sans-serif`;

          ctx.font = titleFont;
          let maxW = ctx.measureText(title).width;
          ctx.font = font;
          for (const line of lines) {
            maxW = Math.max(maxW, ctx.measureText(line).width);
          }
          const boxW = maxW + padding * 2;
          const boxH = titleHeight + lines.length * lineHeight + padding;
          return { width: boxW, height: boxH };
        };

        const measureTable = (header: string[], rows: string[][]) => {
          const padding = 6 * annoScale;
          const rowH = 18 * annoScale;
          const headerH = 22 * annoScale;
          const font = `${11 * annoScale}px sans-serif`;
          const headerFont = `bold ${11 * annoScale}px sans-serif`;
          const swatchW = 12 * annoScale;

          ctx.font = headerFont;
          const colW = header.map(
            (h) => ctx.measureText(h).width + padding * 2,
          );
          ctx.font = font;
          for (const row of rows) {
            for (let c = 0; c < row.length; c++) {
              colW[c] = Math.max(
                colW[c],
                ctx.measureText(row[c]).width + padding * 2,
              );
            }
          }
          colW[0] += swatchW + 4;

          const totalW = colW.reduce((a, b) => a + b, 0);
          const totalH = headerH + rows.length * rowH;
          return { width: totalW, height: totalH };
        };

        for (const anno of rvs.annotations) {
          const ax = pf.x + anno.x * pf.w;
          const ay = pf.y + anno.y * pf.h;

          if (anno.type === "text") {
            const fontSize = (anno.fontSize ?? 12) * annoScale;
            const family = anno.fontFamily ?? "sans-serif";
            const weight = anno.bold ? "bold" : "normal";
            const style = anno.italic ? "italic" : "normal";
            const resolvedText = resolveAnnotationText(anno.text ?? "");
            const lines = resolvedText.split("\n");
            const lineHeight = fontSize * 1.2;

            ctx.font = `${style} ${weight} ${fontSize}px ${family}`;
            let maxW = 0;
            for (const line of lines) {
              maxW = Math.max(maxW, ctx.measureText(line).width);
            }
            const height = lines.length * lineHeight;
            addCanvasRect(ax, ay, maxW, height);
          } else if (anno.type === "color-bar") {
            const barW = 20 * annoScale;
            const barH = 200 * annoScale;
            const barX = ax;
            const barY = ay;

            const fosMin = result.minFOS;
            const fosMax = result.maxFOS;
            const numTicks = 5;
            const fontSize = Math.max(10, 11 * annoScale);
            const labelX2 = barX + barW + 5 * annoScale;

            ctx.font = `${fontSize}px 'Segoe UI', sans-serif`;
            let maxLabelW = 0;
            for (let t = 0; t <= numTicks; t++) {
              const frac = t / numTicks;
              const fos = fosMax - frac * (fosMax - fosMin);
              maxLabelW = Math.max(
                maxLabelW,
                ctx.measureText(fos.toFixed(2)).width,
              );
            }

            const xRight = labelX2 + maxLabelW;
            const yTop = barY - 4 * annoScale - fontSize;
            const yBottom = barY + barH;
            addCanvasRect(barX, yTop, xRight - barX, yBottom - yTop);
          } else if (anno.type === "input-params") {
            const { width, height } = measureParamBlock("Input Parameters", [
              `Method: ${result.method}`,
              `Slices: ${result.criticalSlices.length}`,
              `Surfaces: ${result.allSurfaces.length}`,
            ]);
            addCanvasRect(ax, ay, width, height);
          } else if (anno.type === "output-params") {
            const lines = [`FOS = ${result.minFOS.toFixed(3)}`];
            if (result.criticalSurface) {
              lines.push(
                `Centre: (${result.criticalSurface.cx.toFixed(1)}, ${result.criticalSurface.cy.toFixed(1)})`,
              );
              lines.push(
                `Radius: ${result.criticalSurface.radius.toFixed(2)} m`,
              );
            }
            lines.push(`Time: ${result.elapsedMs.toFixed(0)} ms`);
            const { width, height } = measureParamBlock("Results", lines);
            addCanvasRect(ax, ay, width, height);
          } else if (anno.type === "material-table") {
            const header = ["Material", "gamma", "phi", "c"];
            const rows = materials.map((m) => [
              m.name,
              `${m.unitWeight}`,
              `${m.frictionAngle} deg`,
              `${m.cohesion}`,
            ]);
            const { width, height } = measureTable(header, rows);
            addCanvasRect(ax, ay, width, height);
          }
        }
      }
    }

    if (!Number.isFinite(xMin) || !Number.isFinite(yMin)) return;

    const computeScale = (
      minX: number,
      maxX: number,
      minY: number,
      maxY: number,
    ) => {
      const worldW = maxX - minX || 10;
      const worldH = maxY - minY || 10;
      const margin = Math.max(worldW, worldH) * 0.05;
      return Math.min(w / (worldW + margin * 2), h / (worldH + margin * 2));
    };

    let scale = computeScale(xMin, xMax, yMin, yMax);

    if (udls.length > 0 || lineLoads.length > 0) {
      const extraPx = ARROW_HEIGHT_PX + 18;
      const extraWorld = extraPx / scale;
      yMax += extraWorld;
      scale = computeScale(xMin, xMax, yMin, yMax);
    }

    if (
      mode === "result" &&
      result?.criticalSurface &&
      resultViewSettings.showFosLabel
    ) {
      const ctx = canvas?.getContext("2d");
      if (ctx) {
        const fosText = result.criticalSurface.fos.toFixed(3);
        ctx.font = "bold 14px sans-serif";
        const tw = ctx.measureText(fosText).width;
        const extraRight = (13 + tw) / scale;
        const extraLeft = 7 / scale;
        const extraUp = 16 / scale;
        const extraDown = 6 / scale;

        const { cx, cy } = result.criticalSurface;
        xMin = Math.min(xMin, cx - extraLeft);
        xMax = Math.max(xMax, cx + extraRight);
        yMin = Math.min(yMin, cy - extraDown);
        yMax = Math.max(yMax, cy + extraUp);

        scale = computeScale(xMin, xMax, yMin, yMax);
      }
    }

    const cx = (xMin + xMax) / 2;
    const cy = (yMin + yMax) / 2;

    setActiveViewScale(Math.max(0.1, Math.min(200, scale)));
    setActiveViewOffset([-cx, -cy]);

    if (container) {
      const centerX = (container.scrollWidth - container.clientWidth) / 2;
      const centerY = (container.scrollHeight - container.clientHeight) / 2;
      scrollStateRef.current = { x: centerX, y: centerY };
      container.scrollLeft = centerX;
      container.scrollTop = centerY;
    }
  }, [
    analysisLimits,
    canvasToWorld,
    coordinates,
    lineLoads,
    materialBoundaries,
    materials,
    mode,
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
      recenterScrollbars();
    },
    [
      viewOffset,
      viewScale,
      setActiveViewOffset,
      setActiveViewScale,
      recenterScrollbars,
    ],
  );

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

            if (container) {
              const centerX =
                (container.scrollWidth - container.clientWidth) / 2;
              const centerY =
                (container.scrollHeight - container.clientHeight) / 2;
              scrollStateRef.current = { x: centerX, y: centerY };
              container.scrollLeft = centerX;
              container.scrollTop = centerY;
            }
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
        className="relative w-full h-full overflow-auto"
        style={{
          background: "var(--color-canvas-bg)",
          overscrollBehavior: "none",
        }}
        onScroll={handleScroll}
        onWheelCapture={handleWheelCapture}
        onWheel={handleContainerWheel}
      >
        <div
          className="relative"
          style={{
            width: `${SCROLL_FALLBACK}px`,
            height: `${SCROLL_FALLBACK}px`,
          }}
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
                    materials.find((m) => m.id === assigningMaterialId)
                      ?.color ?? "#888",
                  border: "1px solid rgba(255,255,255,0.4)",
                }}
              />
              Click a region to assign{" "}
              <strong>
                {materials.find((m) => m.id === assigningMaterialId)?.name ??
                  "?"}
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
                        updateAnnotation(anno.id, {
                          fontFamily: e.target.value,
                        })
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
                          onClick={() =>
                            updateAnnotation(anno.id, { color: c })
                          }
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
    </div>
  );
}
