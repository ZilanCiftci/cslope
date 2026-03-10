import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as RPointerEvent,
  type WheelEvent as RWheelEvent,
  type RefObject,
} from "react";
import { computePaperFrame, getAnnotationBoundsPx } from "../helpers";
import { useAppStore } from "../../../store/app-store";
import type { ContextMenuState, MaterialPickerState, PointHit } from "../types";
import type {
  AnalysisLimitsState,
  AppState,
  LineLoadRow,
  MaterialBoundaryRow,
  UdlRow,
} from "../../../store/types";

type UndoableSnapshot = Pick<
  AppState,
  | "orientation"
  | "coordinates"
  | "materials"
  | "materialBoundaries"
  | "regionMaterials"
  | "piezometricLine"
  | "udls"
  | "lineLoads"
  | "analysisLimits"
  | "options"
  | "resultViewSettings"
>;

function pickUndoableSnapshot(state: AppState): UndoableSnapshot {
  return {
    orientation: state.orientation,
    coordinates: state.coordinates,
    materials: state.materials,
    materialBoundaries: state.materialBoundaries,
    regionMaterials: state.regionMaterials,
    piezometricLine: state.piezometricLine,
    udls: state.udls,
    lineLoads: state.lineLoads,
    analysisLimits: state.analysisLimits,
    options: state.options,
    resultViewSettings: state.resultViewSettings,
  };
}

function isSameUndoableSnapshot(a: UndoableSnapshot, b: UndoableSnapshot) {
  return JSON.stringify(a) === JSON.stringify(b);
}

interface PointerDeps {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  containerRef?: RefObject<HTMLDivElement | null>;
  getEventWorldPos: (e: {
    clientX: number;
    clientY: number;
  }) => [number, number];
  viewOffset: [number, number];
  setActiveViewOffset: (offset: [number, number]) => void;
  setActiveViewScale: (scale: number) => void;
  onZoomCompleted?: () => void;
  findNearPointUnified: (wx: number, wy: number) => PointHit | null;
  findRegionAtPoint: (wx: number, wy: number) => { regionKey: string } | null;
  findSnapTarget: (
    wx: number,
    wy: number,
    hit: PointHit,
  ) => [number, number] | null;
  snapValue: (v: number) => number;
  coordinates: [number, number][];
  activePiezoCoords: [number, number][];
  analysisLimits: AnalysisLimitsState;
  udls: UdlRow[];
  lineLoads: LineLoadRow[];
  materialBoundaries: MaterialBoundaryRow[];
  assigningMaterialId: string | null;
  editingAssignment: boolean;
  panActive: boolean;
  setRegionMaterial: (point: [number, number], materialId: string) => void;
  setAssigningMaterial: (materialId: string | null) => void;
  setSelectedRegionKey: (key: string | null) => void;
  setSelectedPoint: (idx: number | null) => void;
  updateAnnotation: (
    id: string,
    patch: Partial<{
      text: string;
      fontSize: number;
      fontFamily: string;
      bold: boolean;
      italic: boolean;
      color: string;
      x: number;
      y: number;
    }>,
  ) => void;
  setSelectedAnnotations: (ids: string[]) => void;
  toggleAnnotationSelection: (id: string, add: boolean) => void;
  selectedAnnotationIds: string[];
  mode: "edit" | "result";
  setAnalysisLimits: (patch: Partial<AnalysisLimitsState>) => void;
  updateUdl: (id: string, patch: Partial<UdlRow>) => void;
  updateLineLoad: (id: string, patch: Partial<LineLoadRow>) => void;
  setCoordinate: (index: number, coord: [number, number]) => void;
  setPiezoCoordinate: (index: number, coord: [number, number]) => void;
  updateBoundaryPoint: (
    boundaryId: string,
    pointIndex: number,
    coord: [number, number],
  ) => void;
  setContextMenu: (menu: ContextMenuState | null) => void;
  setMaterialPicker: (picker: MaterialPickerState | null) => void;
}

export function usePointerHandlers(deps: PointerDeps) {
  const {
    canvasRef,
    containerRef,
    getEventWorldPos,
    viewOffset,
    setActiveViewOffset,
    setActiveViewScale,
    onZoomCompleted,
    findNearPointUnified,
    findRegionAtPoint,
    findSnapTarget,
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
  } = deps;

  const dragRef = useRef<{
    hit: PointHit;
    startWorld: [number, number];
    startPx: [number, number];
  } | null>(null);
  const panRef = useRef<{
    startPx: [number, number];
    startOffset: [number, number];
  } | null>(null);
  const autoPanRafRef = useRef<number | null>(null);
  const lastPointerRef = useRef<{ x: number; y: number } | null>(null);
  const dragStartSnapshotRef = useRef<UndoableSnapshot | null>(null);

  const beginDragHistoryBatch = useCallback(() => {
    dragStartSnapshotRef.current = pickUndoableSnapshot(useAppStore.getState());
    useAppStore.temporal.getState().pause();
  }, []);

  const commitDragHistoryBatch = useCallback(() => {
    const temporalStore = useAppStore.temporal;
    const temporalState = temporalStore.getState();
    const startSnapshot = dragStartSnapshotRef.current;

    temporalState.resume();

    if (!startSnapshot) {
      dragStartSnapshotRef.current = null;
      return;
    }

    const endSnapshot = pickUndoableSnapshot(useAppStore.getState());
    if (!isSameUndoableSnapshot(startSnapshot, endSnapshot)) {
      temporalStore.setState((s) => ({
        pastStates:
          s.pastStates.length >= 50
            ? [...s.pastStates.slice(1), startSnapshot]
            : [...s.pastStates, startSnapshot],
        futureStates: [],
      }));
    }

    dragStartSnapshotRef.current = null;
  }, []);

  const [mouseWorld, setMouseWorld] = useState<[number, number] | null>(null);
  const [hoverHit, setHoverHit] = useState<PointHit | null>(null);
  const hoverHitRef = useRef<PointHit | null>(null);

  const isSameHit = (a: PointHit | null, b: PointHit | null) => {
    if (!a || !b) return a === b;
    switch (a.kind) {
      case "external":
        return b.kind === "external" && a.index === b.index;
      case "piezo":
        return b.kind === "piezo" && a.index === b.index;
      case "limit":
        return b.kind === "limit" && a.handle === b.handle;
      case "udl":
        return b.kind === "udl" && a.udlId === b.udlId && a.handle === b.handle;
      case "lineLoad":
        return b.kind === "lineLoad" && a.loadId === b.loadId;
      case "boundary":
        return (
          b.kind === "boundary" &&
          a.boundaryId === b.boundaryId &&
          a.pointIndex === b.pointIndex
        );
      case "annotation":
        return b.kind === "annotation" && a.annoId === b.annoId;
      default:
        return false;
    }
  };

  const applyEdgePan = useCallback(() => {
    const drag = dragRef.current;
    const last = lastPointerRef.current;
    if (!drag || drag.hit.kind === "annotation" || !last) return;

    const rect = containerRef?.current?.getBoundingClientRect();
    const canvasRect = canvasRef.current?.getBoundingClientRect();
    const viewRect = rect ?? canvasRect;
    if (!viewRect) return;

    const cx = last.x - viewRect.left;
    const cy = last.y - viewRect.top;
    const edgeMargin = 24;
    const maxPanPx = 18;

    let panPxX = 0;
    let panPxY = 0;

    if (cx < edgeMargin) {
      panPxX = Math.max(-maxPanPx, (cx - edgeMargin) * 0.35);
    } else if (cx > viewRect.width - edgeMargin) {
      panPxX = Math.min(maxPanPx, (cx - (viewRect.width - edgeMargin)) * 0.35);
    }

    if (cy < edgeMargin) {
      panPxY = Math.max(-maxPanPx, (cy - edgeMargin) * 0.35);
    } else if (cy > viewRect.height - edgeMargin) {
      panPxY = Math.min(maxPanPx, (cy - (viewRect.height - edgeMargin)) * 0.35);
    }

    if (panPxX !== 0 || panPxY !== 0) {
      const s = useAppStore.getState();
      const currentViewScale =
        (s.mode === "result" ? s.resultViewScale : s.editViewScale) || 1;
      const offset =
        s.mode === "result" ? s.resultViewOffset : s.editViewOffset;

      setActiveViewOffset([
        offset[0] - panPxX / currentViewScale,
        offset[1] + panPxY / currentViewScale,
      ]);

      const updatedDrag = dragRef.current;
      if (!updatedDrag) return;
      updatedDrag.startPx = [
        updatedDrag.startPx[0] - panPxX,
        updatedDrag.startPx[1] - panPxY,
      ];
    }
  }, [canvasRef, containerRef, setActiveViewOffset]);

  const stopAutoPan = useCallback(() => {
    if (autoPanRafRef.current !== null) {
      cancelAnimationFrame(autoPanRafRef.current);
      autoPanRafRef.current = null;
    }
  }, []);

  useEffect(() => stopAutoPan, [stopAutoPan]);

  const updateDragAtPointer = useCallback(
    (clientX: number, clientY: number) => {
      const drag = dragRef.current;
      if (!drag) return;

      const s = useAppStore.getState();
      const currentViewScale =
        (s.mode === "result" ? s.resultViewScale : s.editViewScale) || 1;

      const dx = (clientX - drag.startPx[0]) / currentViewScale;
      const dy = -(clientY - drag.startPx[1]) / currentViewScale;
      const rawX = drag.startWorld[0] + dx;
      const rawY = drag.startWorld[1] + dy;

      const snap = findSnapTarget(rawX, rawY, drag.hit);
      const newX = snap ? snap[0] : snapValue(rawX);
      const newY = snap ? snap[1] : snapValue(rawY);

      // Show the snapped coordinate in the status bar, not the raw mouse position
      if (drag.hit.kind !== "annotation") {
        setMouseWorld([newX, newY]);
      }

      if (drag.hit.kind === "annotation") {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const rect = canvas.getBoundingClientRect();
        const pf = computePaperFrame(
          rect.width,
          rect.height,
          s.resultViewSettings.paperFrame.paperSize,
          s.resultViewSettings.paperFrame.landscape,
        );
        const cxPx = clientX - rect.left;
        const cyPx = clientY - rect.top;
        const fx = (cxPx - pf.x) / pf.w;
        const fy = (cyPx - pf.y) / pf.h;
        const draggedId = drag.hit.annoId;

        if (selectedAnnotationIds.includes(draggedId)) {
          if (selectedAnnotationIds.length > 1) {
            const draggedAnno = s.resultViewSettings.annotations.find(
              (a) => a.id === draggedId,
            );
            if (draggedAnno) {
              const ddx = fx - draggedAnno.x;
              const ddy = fy - draggedAnno.y;
              for (const sid of selectedAnnotationIds) {
                const sa = s.resultViewSettings.annotations.find(
                  (a) => a.id === sid,
                );
                if (sa) {
                  updateAnnotation(sid, { x: sa.x + ddx, y: sa.y + ddy });
                }
              }
            }
          } else {
            updateAnnotation(draggedId, { x: fx, y: fy });
          }
        } else {
          updateAnnotation(draggedId, { x: fx, y: fy });
        }
      } else if (drag.hit.kind === "external") {
        setCoordinate(drag.hit.index, [newX, newY]);
      } else if (drag.hit.kind === "piezo") {
        setPiezoCoordinate(drag.hit.index, [newX, newY]);
      } else if (drag.hit.kind === "limit") {
        setAnalysisLimits({ [drag.hit.handle]: newX });
      } else if (drag.hit.kind === "udl") {
        updateUdl(drag.hit.udlId, { [drag.hit.handle]: newX });
      } else if (drag.hit.kind === "lineLoad") {
        updateLineLoad(drag.hit.loadId, { x: newX });
      } else {
        updateBoundaryPoint(drag.hit.boundaryId, drag.hit.pointIndex, [
          newX,
          newY,
        ]);
      }
    },
    [
      canvasRef,
      findSnapTarget,
      selectedAnnotationIds,
      setAnalysisLimits,
      setCoordinate,
      setPiezoCoordinate,
      snapValue,
      updateAnnotation,
      updateBoundaryPoint,
      updateLineLoad,
      updateUdl,
    ],
  );

  const startAutoPan = useCallback(() => {
    if (autoPanRafRef.current !== null) return;
    const tick = () => {
      if (!dragRef.current) {
        autoPanRafRef.current = null;
        return;
      }
      applyEdgePan();
      const last = lastPointerRef.current;
      if (last) updateDragAtPointer(last.x, last.y);
      autoPanRafRef.current = requestAnimationFrame(tick);
    };
    autoPanRafRef.current = requestAnimationFrame(tick);
  }, [applyEdgePan, updateDragAtPointer]);

  const handlePointerDown = useCallback(
    (e: RPointerEvent<HTMLCanvasElement>) => {
      setContextMenu(null);
      setMaterialPicker(null);

      const [wx, wy] = getEventWorldPos(e);
      setMouseWorld([wx, wy]);
      lastPointerRef.current = { x: e.clientX, y: e.clientY };

      if (e.button === 1) {
        e.preventDefault();
        e.stopPropagation();
        panRef.current = {
          startPx: [e.clientX, e.clientY],
          startOffset: [...viewOffset],
        };
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        return;
      }

      if (mode === "result") {
        const canvas = canvasRef.current;
        if (canvas) {
          const ctx = canvas.getContext("2d");
          const rect = canvas.getBoundingClientRect();
          const pf = computePaperFrame(
            rect.width,
            rect.height,
            useAppStore.getState().resultViewSettings.paperFrame.paperSize,
            useAppStore.getState().resultViewSettings.paperFrame.landscape,
          );
          const cxPx = e.clientX - rect.left;
          const cyPx = e.clientY - rect.top;
          const state = useAppStore.getState();
          const annos = state.resultViewSettings.annotations;
          const resultForBounds = state.result;
          for (let i = annos.length - 1; i >= 0; i--) {
            const a = annos[i];
            const hit =
              ctx && resultForBounds
                ? (() => {
                    const b = getAnnotationBoundsPx(ctx, {
                      annotation: a,
                      paperFrame: pf,
                      result: resultForBounds,
                      materials: state.materials,
                      projectInfo: state.projectInfo,
                    });
                    return (
                      cxPx >= b.x &&
                      cxPx <= b.x + b.w &&
                      cyPx >= b.y &&
                      cyPx <= b.y + b.h
                    );
                  })()
                : (() => {
                    const fx = (cxPx - pf.x) / pf.w;
                    const fy = (cyPx - pf.y) / pf.h;
                    const dx = (fx - a.x) * pf.w;
                    const dy = (fy - a.y) * pf.h;
                    return Math.hypot(dx, dy) < 15;
                  })();

            if (hit) {
              if (e.ctrlKey || e.shiftKey) {
                toggleAnnotationSelection(a.id, true);
              } else if (!selectedAnnotationIds.includes(a.id)) {
                setSelectedAnnotations([a.id]);
              }
              const hit: PointHit = { kind: "annotation", annoId: a.id };
              dragRef.current = {
                hit,
                startWorld: [a.x, a.y],
                startPx: [e.clientX, e.clientY],
              };
              beginDragHistoryBatch();
              (e.target as HTMLElement).setPointerCapture(e.pointerId);
              return;
            }
          }
          setSelectedAnnotations([]);
          if (panActive && e.button === 0) {
            panRef.current = {
              startPx: [e.clientX, e.clientY],
              startOffset: [...viewOffset],
            };
            (e.target as HTMLElement).setPointerCapture(e.pointerId);
          }
          return;
        }
      }

      if (e.button !== 0) return;

      const hit = findNearPointUnified(wx, wy);
      if (hit) {
        const startWorld: [number, number] =
          hit.kind === "external"
            ? [coordinates[hit.index][0], coordinates[hit.index][1]]
            : hit.kind === "piezo"
              ? [
                  activePiezoCoords[hit.index][0],
                  activePiezoCoords[hit.index][1],
                ]
              : hit.kind === "limit"
                ? [analysisLimits[hit.handle], 0]
                : hit.kind === "udl"
                  ? (() => {
                      const udl = udls.find((u) => u.id === hit.udlId);
                      const val = udl
                        ? hit.handle === "x1"
                          ? udl.x1
                          : udl.x2
                        : 0;
                      return [val, 0];
                    })()
                  : hit.kind === "lineLoad"
                    ? [lineLoads.find((l) => l.id === hit.loadId)!.x, 0]
                    : hit.kind === "boundary"
                      ? (() => {
                          const b = materialBoundaries.find(
                            (mb) => mb.id === hit.boundaryId,
                          )!;
                          return [
                            b.coordinates[hit.pointIndex][0],
                            b.coordinates[hit.pointIndex][1],
                          ];
                        })()
                      : [0, 0];

        dragRef.current = {
          hit,
          startWorld,
          startPx: [e.clientX, e.clientY],
        };
        beginDragHistoryBatch();
        startAutoPan();
        if (hit.kind === "external") {
          setSelectedPoint(hit.index);
        }
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
      } else if (panActive) {
        panRef.current = {
          startPx: [e.clientX, e.clientY],
          startOffset: [...viewOffset],
        };
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        return;
      } else {
        const region = findRegionAtPoint(wx, wy);
        if (region) {
          if (assigningMaterialId) {
            setRegionMaterial([wx, wy], assigningMaterialId);
            setAssigningMaterial(null);
          } else if (editingAssignment) {
            // Open the material picker popup at the click position so the
            // user can assign a material to the point they clicked.
            setSelectedRegionKey(region.regionKey);
            const rect = canvasRef.current?.getBoundingClientRect();
            if (rect) {
              setMaterialPicker({
                screenX: e.clientX - rect.left,
                screenY: e.clientY - rect.top,
                worldPoint: [wx, wy],
              });
            }
          }
        } else if (assigningMaterialId) {
          setAssigningMaterial(null);
        }
        setSelectedPoint(null);
      }
    },
    [
      activePiezoCoords,
      analysisLimits,
      assigningMaterialId,
      canvasRef,
      coordinates,
      editingAssignment,
      findNearPointUnified,
      findRegionAtPoint,
      getEventWorldPos,
      lineLoads,
      materialBoundaries,
      mode,
      panActive,
      selectedAnnotationIds,
      setAssigningMaterial,
      setContextMenu,
      setMaterialPicker,
      setSelectedAnnotations,
      setSelectedPoint,
      setSelectedRegionKey,
      setRegionMaterial,
      startAutoPan,
      toggleAnnotationSelection,
      udls,
      viewOffset,
      beginDragHistoryBatch,
    ],
  );

  const handlePointerMove = useCallback(
    (e: RPointerEvent<HTMLCanvasElement>) => {
      const [wx, wy] = getEventWorldPos(e);
      setMouseWorld([wx, wy]);
      lastPointerRef.current = { x: e.clientX, y: e.clientY };

      const s = useAppStore.getState();
      const currentViewScale =
        (s.mode === "result" ? s.resultViewScale : s.editViewScale) || 1;

      if (dragRef.current) applyEdgePan();

      if (panRef.current) {
        const dx = (e.clientX - panRef.current.startPx[0]) / currentViewScale;
        const dy = -(e.clientY - panRef.current.startPx[1]) / currentViewScale;
        setActiveViewOffset([
          panRef.current.startOffset[0] + dx,
          panRef.current.startOffset[1] + dy,
        ]);
        return;
      }

      if (dragRef.current) {
        updateDragAtPointer(e.clientX, e.clientY);
        return;
      }

      let hit: PointHit | null = null;
      if (mode === "result") {
        const canvas = canvasRef.current!;
        const rect = canvas.getBoundingClientRect();
        const cxPx = e.clientX - rect.left;
        const cyPx = e.clientY - rect.top;
        const pf = computePaperFrame(
          rect.width,
          rect.height,
          useAppStore.getState().resultViewSettings.paperFrame.paperSize,
          useAppStore.getState().resultViewSettings.paperFrame.landscape,
        );
        const fx = (cxPx - pf.x) / pf.w;
        const fy = (cyPx - pf.y) / pf.h;
        const annos = useAppStore.getState().resultViewSettings.annotations;
        for (let i = annos.length - 1; i >= 0; i--) {
          const a = annos[i];
          const dx = (fx - a.x) * pf.w;
          const dy = (fy - a.y) * pf.h;
          if (Math.hypot(dx, dy) < 15) {
            hit = { kind: "annotation", annoId: a.id };
            break;
          }
        }
      } else {
        hit = findNearPointUnified(wx, wy);
      }
      if (!isSameHit(hoverHitRef.current, hit)) {
        hoverHitRef.current = hit;
        setHoverHit(hit);
      }
    },
    [
      canvasRef,
      applyEdgePan,
      findNearPointUnified,
      getEventWorldPos,
      mode,
      setActiveViewOffset,
      updateDragAtPointer,
    ],
  );

  const handlePointerUp = useCallback(
    (e: RPointerEvent<HTMLCanvasElement>) => {
      if (dragRef.current) commitDragHistoryBatch();
      dragRef.current = null;
      panRef.current = null;
      lastPointerRef.current = null;
      stopAutoPan();
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    },
    [commitDragHistoryBatch, stopAutoPan],
  );

  const handlePointerCancel = useCallback(
    (e: RPointerEvent<HTMLCanvasElement>) => {
      if (dragRef.current) commitDragHistoryBatch();
      dragRef.current = null;
      panRef.current = null;
      lastPointerRef.current = null;
      stopAutoPan();
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    },
    [commitDragHistoryBatch, stopAutoPan],
  );

  const handleWheel = useCallback(
    (e: RWheelEvent<HTMLCanvasElement>) => {
      e.preventDefault();
      e.stopPropagation();
      const state = useAppStore.getState();
      if (state.mode === "result" && state.resultViewSettings.viewLock?.enabled)
        return;

      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const w = rect.width;
      const h = rect.height;
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;

      const oldScale =
        state.mode === "result" ? state.resultViewScale : state.editViewScale;
      if (oldScale <= 0) return;

      const [ox, oy] =
        state.mode === "result" ? state.resultViewOffset : state.editViewOffset;

      if (e.ctrlKey) {
        const factor = e.deltaY > 0 ? 0.8 : 1.2;
        const newScale = Math.max(0.1, Math.min(200, oldScale * factor));
        setActiveViewOffset([
          ox + (mx - w / 2) / newScale - (mx - w / 2) / oldScale,
          oy - (my - h / 2) / newScale + (my - h / 2) / oldScale,
        ]);
        setActiveViewScale(newScale);
        onZoomCompleted?.();
      } else {
        // Pan
        setActiveViewOffset([
          ox - e.deltaX / oldScale,
          oy + e.deltaY / oldScale,
        ]);
      }
    },
    [canvasRef, onZoomCompleted, setActiveViewOffset, setActiveViewScale],
  );

  return {
    mouseWorld,
    hoverHit,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    handlePointerCancel,
    handleWheel,
    setMouseWorld,
    setHoverHit,
  };
}
