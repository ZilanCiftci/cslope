import {
  useCallback,
  useRef,
  useState,
  type PointerEvent as RPointerEvent,
  type WheelEvent as RWheelEvent,
  type RefObject,
} from "react";
import { computePaperFrame } from "../helpers";
import { useAppStore } from "../../../store/app-store";
import type { ContextMenuState, MaterialPickerState, PointHit } from "../types";
import type {
  AnalysisLimitsState,
  LineLoadRow,
  MaterialBoundaryRow,
  UdlRow,
} from "../../../store/types";

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
  setRegionMaterial: (regionKey: string, materialId: string) => void;
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

  const [mouseWorld, setMouseWorld] = useState<[number, number] | null>(null);
  const [hoverHit, setHoverHit] = useState<PointHit | null>(null);

  const handlePointerDown = useCallback(
    (e: RPointerEvent<HTMLCanvasElement>) => {
      setContextMenu(null);
      setMaterialPicker(null);

      const [wx, wy] = getEventWorldPos(e);
      setMouseWorld([wx, wy]);

      if (e.button === 1) {
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
          const rect = canvas.getBoundingClientRect();
          const pf = computePaperFrame(
            rect.width,
            rect.height,
            useAppStore.getState().resultViewSettings.paperFrame.paperSize,
          );
          const cxPx = e.clientX - rect.left;
          const cyPx = e.clientY - rect.top;
          const fx = (cxPx - pf.x) / pf.w;
          const fy = (cyPx - pf.y) / pf.h;
          const annos = useAppStore.getState().resultViewSettings.annotations;
          for (let i = annos.length - 1; i >= 0; i--) {
            const a = annos[i];
            const dx = (fx - a.x) * pf.w;
            const dy = (fy - a.y) * pf.h;
            if (Math.hypot(dx, dy) < 15) {
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
            setRegionMaterial(region.regionKey, assigningMaterialId);
            setAssigningMaterial(null);
          } else if (editingAssignment) {
            setSelectedRegionKey(region.regionKey);
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
      containerRef,
      coordinates,
      editingAssignment,
      findNearPointUnified,
      findRegionAtPoint,
      getEventWorldPos,
      lineLoads,
      materialBoundaries,
      mode,
      selectedAnnotationIds,
      setAssigningMaterial,
      setContextMenu,
      setMaterialPicker,
      setSelectedAnnotations,
      setSelectedPoint,
      setSelectedRegionKey,
      setRegionMaterial,
      toggleAnnotationSelection,
      udls,
      viewOffset,
    ],
  );

  const handlePointerMove = useCallback(
    (e: RPointerEvent<HTMLCanvasElement>) => {
      const [wx, wy] = getEventWorldPos(e);
      setMouseWorld([wx, wy]);

      const s = useAppStore.getState();
      const currentViewScale =
        (s.mode === "result" ? s.resultViewScale : s.editViewScale) || 1;

      if (dragRef.current && dragRef.current.hit.kind !== "annotation") {
        const rect = containerRef?.current?.getBoundingClientRect();
        const canvasRect = canvasRef.current?.getBoundingClientRect();
        const viewRect = rect ?? canvasRect;
        if (viewRect) {
          const cx = e.clientX - viewRect.left;
          const cy = e.clientY - viewRect.top;
          const edgeMargin = 24;
          const maxPanPx = 18;

          let panPxX = 0;
          let panPxY = 0;

          if (cx < edgeMargin) {
            panPxX = Math.max(-maxPanPx, (cx - edgeMargin) * 0.35);
          } else if (cx > viewRect.width - edgeMargin) {
            panPxX = Math.min(
              maxPanPx,
              (cx - (viewRect.width - edgeMargin)) * 0.35,
            );
          }

          if (cy < edgeMargin) {
            panPxY = Math.max(-maxPanPx, (cy - edgeMargin) * 0.35);
          } else if (cy > viewRect.height - edgeMargin) {
            panPxY = Math.min(
              maxPanPx,
              (cy - (viewRect.height - edgeMargin)) * 0.35,
            );
          }

          if (panPxX !== 0 || panPxY !== 0) {
            const offset =
              s.mode === "result" ? s.resultViewOffset : s.editViewOffset;
            setActiveViewOffset([
              offset[0] - panPxX / currentViewScale,
              offset[1] + panPxY / currentViewScale,
            ]);

            dragRef.current.startPx = [
              dragRef.current.startPx[0] - panPxX,
              dragRef.current.startPx[1] - panPxY,
            ];
          }
        }
      }

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
        const dx = (e.clientX - dragRef.current.startPx[0]) / currentViewScale;
        const dy = -(e.clientY - dragRef.current.startPx[1]) / currentViewScale;
        const rawX = dragRef.current.startWorld[0] + dx;
        const rawY = dragRef.current.startWorld[1] + dy;

        const snap = findSnapTarget(rawX, rawY, dragRef.current.hit);
        const newX = snap ? snap[0] : snapValue(rawX);
        const newY = snap ? snap[1] : snapValue(rawY);

        if (dragRef.current.hit.kind === "annotation") {
          const canvas = canvasRef.current!;
          const rect = canvas.getBoundingClientRect();
          const pf = computePaperFrame(
            rect.width,
            rect.height,
            useAppStore.getState().resultViewSettings.paperFrame.paperSize,
          );
          const cxPx = e.clientX - rect.left;
          const cyPx = e.clientY - rect.top;
          const fx = (cxPx - pf.x) / pf.w;
          const fy = (cyPx - pf.y) / pf.h;
          const draggedId = dragRef.current.hit.annoId;

          if (
            selectedAnnotationIds.includes(draggedId) &&
            selectedAnnotationIds.length > 1
          ) {
            const draggedAnno = useAppStore
              .getState()
              .resultViewSettings.annotations.find((a) => a.id === draggedId);
            if (draggedAnno) {
              const ddx = fx - draggedAnno.x;
              const ddy = fy - draggedAnno.y;
              for (const sid of selectedAnnotationIds) {
                const sa = useAppStore
                  .getState()
                  .resultViewSettings.annotations.find((a) => a.id === sid);
                if (sa) {
                  updateAnnotation(sid, { x: sa.x + ddx, y: sa.y + ddy });
                }
              }
            }
          } else {
            updateAnnotation(draggedId, { x: fx, y: fy });
          }
        } else if (dragRef.current.hit.kind === "external") {
          setCoordinate(dragRef.current.hit.index, [newX, newY]);
        } else if (dragRef.current.hit.kind === "piezo") {
          setPiezoCoordinate(dragRef.current.hit.index, [newX, newY]);
        } else if (dragRef.current.hit.kind === "limit") {
          setAnalysisLimits({ [dragRef.current.hit.handle]: newX });
        } else if (dragRef.current.hit.kind === "udl") {
          updateUdl(dragRef.current.hit.udlId, {
            [dragRef.current.hit.handle]: newX,
          });
        } else if (dragRef.current.hit.kind === "lineLoad") {
          updateLineLoad(dragRef.current.hit.loadId, { x: newX });
        } else {
          updateBoundaryPoint(
            dragRef.current.hit.boundaryId,
            dragRef.current.hit.pointIndex,
            [newX, newY],
          );
        }
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
      setHoverHit(hit);
      const canvas = canvasRef.current;
      if (canvas) {
        if (panActive) {
          canvas.style.cursor = panRef.current ? "grabbing" : "grab";
        } else {
          canvas.style.cursor =
            hit?.kind === "annotation"
              ? "grab"
              : hit?.kind === "limit" ||
                  hit?.kind === "udl" ||
                  hit?.kind === "lineLoad"
                ? "ew-resize"
                : hit
                  ? "grab"
                  : "";
        }
      }
    },
    [
      canvasRef,
      containerRef,
      findNearPointUnified,
      findSnapTarget,
      getEventWorldPos,
      mode,
      selectedAnnotationIds,
      panActive,
      setActiveViewOffset,
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

  const handlePointerUp = useCallback((e: RPointerEvent<HTMLCanvasElement>) => {
    dragRef.current = null;
    panRef.current = null;
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
  }, []);

  const handleWheel = useCallback(
    (e: RWheelEvent<HTMLCanvasElement>) => {
      // Only zoom when Ctrl is held; otherwise let scrollbars move normally.
      if (!e.ctrlKey) return;

      e.preventDefault();
      e.stopPropagation();
      const state = useAppStore.getState();
      if (state.mode === "result" && state.resultViewSettings.viewLock?.enabled)
        return;

      const factor = e.deltaY > 0 ? 0.9 : 1.1;
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
      const newScale = Math.max(0.1, Math.min(200, oldScale * factor));
      const [ox, oy] =
        state.mode === "result" ? state.resultViewOffset : state.editViewOffset;
      setActiveViewOffset([
        ox + (mx - w / 2) / newScale - (mx - w / 2) / oldScale,
        oy - (my - h / 2) / newScale + (my - h / 2) / oldScale,
      ]);
      setActiveViewScale(newScale);
    },
    [canvasRef, setActiveViewOffset, setActiveViewScale],
  );

  return {
    mouseWorld,
    hoverHit,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    handleWheel,
    setMouseWorld,
    setHoverHit,
  };
}
