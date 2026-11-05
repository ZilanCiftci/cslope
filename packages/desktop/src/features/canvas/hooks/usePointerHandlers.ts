import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent as RMouseEvent,
  type PointerEvent as RPointerEvent,
  type RefObject,
} from "react";
import { computePaperFrame, getAnnotationBoundsPx } from "../helpers";
import { useAppStore } from "../../../store/app-store";
import { VIEW_SCALE_MAX, VIEW_SCALE_MIN } from "../constants";
import type { CanvasWheelEvent } from "./useNonPassiveWheel";
import type { ContextMenuState, MaterialPickerState, PointHit } from "../types";
import type {
  AnalysisLimitsState,
  AppState,
  CanvasObjectRef,
  CanvasPointKey,
  CustomSearchPlane,
  LineLoadRow,
  PileRow,
  ReinforcementRow,
  UdlRow,
} from "../../../store/types";
import {
  circleRadiusFromPointer,
  isSameCustomPlaneHit,
} from "../custom-plane-geometry";
import { findReferenceHitAt, isSameReferenceHit, referenceHitId } from "../reference-geometry";
import { isPaperAnnotation, MIN_REFERENCE_RADIUS, translateReference } from "../../annotations/reference";
import type { Annotation, ReferenceAnnotation } from "../../../store/types";
import { bodyDraggable, dragHitOf, type CanvasCandidate } from "../object-hits";
import { isObjectLocked, nextCycleIndex, sameObject } from "../../../store/canvas-selection";
import { handleAxes, moveHandleTo, type HandleActions } from "../handle-edit";

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
  | "reinforcements"
  | "piles"
  | "customSearchPlanes"
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
    reinforcements: state.reinforcements,
    piles: state.piles,
    customSearchPlanes: state.customSearchPlanes,
    analysisLimits: state.analysisLimits,
    options: state.options,
    resultViewSettings: state.resultViewSettings,
  };
}

/** What a drag shows beside the pointer: the point's coordinates, or a circle's centre and radius. */
export interface DragTip {
  text: string;
  /** Canvas px. */
  x: number;
  y: number;
}

function circleTipText(p: CustomSearchPlane): string {
  return `cx ${p.cx.toFixed(2)}  cy ${p.cy.toFixed(2)}  R ${p.radius.toFixed(2)} m`;
}

function isSameUndoableSnapshot(a: UndoableSnapshot, b: UndoableSnapshot) {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** The object under the pointer on the edit canvas, for the hover highlight and the cursor. */
export interface HoverObject extends CanvasCandidate {
  locked: boolean;
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
  /** Edit view: every object under the pointer, topmost first. */
  findObjectsAt?: (wx: number, wy: number) => CanvasCandidate[];
  findRegionAtPoint: (wx: number, wy: number) => { regionKey: string } | null;
  findSnapTarget: (
    wx: number,
    wy: number,
    hit: PointHit,
  ) => [number, number] | null;
  snapValue: (v: number) => number;
  assigningMaterialId: string | null;
  panActive: boolean;
  setRegionMaterial: (point: [number, number], materialId: string) => void;
  setAssigningMaterial: (materialId: string | null) => void;
  setSelectedRegionKey: (key: string | null) => void;
  updateAnnotation: (id: string, patch: Partial<Annotation>) => void;
  setSelectedAnnotations: (ids: string[]) => void;
  toggleAnnotationSelection: (id: string, add: boolean) => void;
  setSelectedResultObject: (target: "paper-frame" | null) => void;
  selectedAnnotationIds: string[];
  mode: "edit" | "result";
  setAnalysisLimits: (patch: Partial<AnalysisLimitsState>) => void;
  updateUdl: (id: string, patch: Partial<UdlRow>) => void;
  updateLineLoad: (id: string, patch: Partial<LineLoadRow>) => void;
  setCoordinate: (index: number, coord: [number, number]) => void;
  setPiezoCoordinate: (index: number, coord: [number, number]) => void;
  setActivePiezoLine?: (lineId: string | null) => void;
  updateBoundaryPoint: (
    boundaryId: string,
    pointIndex: number,
    coord: [number, number],
  ) => void;
  updateCustomSearchPlane?: (id: string, patch: Partial<CustomSearchPlane>) => void;
  updateCustomPlanePoint?: (id: string, pointIndex: number, point: [number, number]) => void;
  updateReinforcement?: (id: string, patch: Partial<ReinforcementRow>) => void;
  updatePile?: (id: string, patch: Partial<PileRow>) => void;
  setContextMenu: (menu: ContextMenuState | null) => void;
  setMaterialPicker: (picker: MaterialPickerState | null) => void;
  /** Edit view: a double-click on a point of the selected object (canvas px). */
  onEditPoint?: (object: CanvasObjectRef, point: CanvasPointKey, at: { x: number; y: number }) => void;
}

/** Pointer travel (px) before a press becomes a drag: a click never moves anything. */
export const DRAG_THRESHOLD_PX = 4;

export function usePointerHandlers(deps: PointerDeps) {
  const {
    canvasRef,
    containerRef,
    getEventWorldPos,
    viewOffset,
    setActiveViewOffset,
    setActiveViewScale,
    onZoomCompleted,
    findObjectsAt,
    findRegionAtPoint,
    findSnapTarget,
    snapValue,
    assigningMaterialId,
    panActive,
    setRegionMaterial,
    setAssigningMaterial,
    setSelectedRegionKey,
    updateAnnotation,
    setSelectedAnnotations,
    toggleAnnotationSelection,
    setSelectedResultObject,
    selectedAnnotationIds,
    mode,
    setContextMenu,
    setMaterialPicker,
    onEditPoint,
  } = deps;

  // The store's actions, unless the caller gives its own (tests).
  const depsRef = useRef(deps);
  useEffect(() => {
    depsRef.current = deps;
  });
  const handleActions = useCallback((): HandleActions => {
    const s = useAppStore.getState();
    const d = depsRef.current;
    return {
      setCoordinate: d.setCoordinate,
      updateBoundaryPoint: d.updateBoundaryPoint,
      setPiezoCoordinate: d.setPiezoCoordinate,
      setActivePiezoLine: d.setActivePiezoLine ?? s.setActivePiezoLine,
      updateUdl: d.updateUdl,
      updateLineLoad: d.updateLineLoad,
      setAnalysisLimits: d.setAnalysisLimits,
      updateCustomSearchPlane: d.updateCustomSearchPlane ?? s.updateCustomSearchPlane,
      updateCustomPlanePoint: d.updateCustomPlanePoint ?? s.updateCustomPlanePoint,
      updateReinforcement: d.updateReinforcement ?? s.updateReinforcement,
      updatePile: d.updatePile ?? s.updatePile,
    };
  }, []);

  const dragRef = useRef<{
    hit: PointHit;
    startWorld: [number, number];
    startPx: [number, number];
    /** Pointer position at pointer-down (not shifted by edge panning). */
    downPx: [number, number];
    /** True once the pointer has moved past the drag threshold. */
    moved: boolean;
    /** The reference annotation as it was when its drag began. */
    reference?: ReferenceAnnotation;
    /** Edit view: the object and the handle (null: its body) dragged. */
    object?: CanvasObjectRef;
    point?: CanvasPointKey | null;
    /** A load or surface moved whole, as it was when the drag began. */
    udl?: UdlRow;
    plane?: CustomSearchPlane;
  } | null>(null);
  /**
   * Edit view: a press that is a click until the pointer moves past the
   * drag threshold, with the objects that were under it.
   */
  const pressRef = useRef<{
    downPx: [number, number];
    candidates: CanvasCandidate[];
    moved: boolean;
  } | null>(null);
  /** Edit view: where the last click was, to cycle through overlapping objects. */
  const lastClickRef = useRef<{ px: [number, number]; candidates: CanvasCandidate[] } | null>(null);
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
  const [hoverObject, setHoverObject] = useState<HoverObject | null>(null);
  const hoverObjectRef = useRef<HoverObject | null>(null);
  const [dragTip, setDragTip] = useState<DragTip | null>(null);
  const [dragging, setDragging] = useState(false);

  const isSameHit = (a: PointHit | null, b: PointHit | null) => {
    if (!a || !b) return a === b;
    switch (a.kind) {
      case "customCircle":
      case "customVertex":
        return isSameCustomPlaneHit(a, b);
      case "referenceVertex":
      case "referenceCircle":
      case "referenceLine":
        return isSameReferenceHit(a, b);
      case "external":
        return b.kind === "external" && a.index === b.index;
      case "piezo":
        return b.kind === "piezo" && a.lineId === b.lineId && a.index === b.index;
      case "limit":
        return b.kind === "limit" && a.handle === b.handle;
      case "udl":
        return b.kind === "udl" && a.udlId === b.udlId && a.handle === b.handle;
      case "udlBody":
        return b.kind === "udlBody" && a.udlId === b.udlId;
      case "lineLoad":
        return b.kind === "lineLoad" && a.loadId === b.loadId;
      case "elementEnd":
        return b.kind === "elementEnd" && a.id === b.id && a.end === b.end;
      case "customPlaneBody":
        return b.kind === "customPlaneBody" && a.planeId === b.planeId;
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
    // The result view is the paper: nothing pans while an annotation moves.
    if (!drag || drag.hit.kind === "annotation" || referenceHitId(drag.hit) || !last) return;

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

      // A click selects without moving anything: ignore the drag (and the
      // grid/neighbour snapping it applies) until the pointer really moves.
      if (!drag.moved) {
        const moved = Math.hypot(
          clientX - drag.downPx[0],
          clientY - drag.downPx[1],
        );
        if (moved < DRAG_THRESHOLD_PX) return;
        drag.moved = true;
        if (pressRef.current) pressRef.current.moved = true;
        setDragging(true);
        // The point dragged is the point selected.
        const st = useAppStore.getState();
        if (drag.object && drag.point !== undefined && drag.point !== null && sameObject(st.canvasSelection?.object, drag.object)) {
          st.selectCanvasPoint(drag.point);
        }
      }

      const s = useAppStore.getState();
      const currentViewScale =
        (s.mode === "result" ? s.resultViewScale : s.editViewScale) || 1;

      const dx = (clientX - drag.startPx[0]) / currentViewScale;
      const dy = -(clientY - drag.startPx[1]) / currentViewScale;
      const rawX = drag.startWorld[0] + dx;
      const rawY = drag.startWorld[1] + dy;

      // A circle's centre is no geometry point: it snaps to the grid only;
      // so does a reference circle, a reference line moved whole, and an
      // object moved whole (by a whole number of grid steps).
      const gridOnly =
        drag.hit.kind === "customCircle" ||
        drag.hit.kind === "referenceCircle" ||
        drag.hit.kind === "referenceLine" ||
        drag.hit.kind === "udlBody" ||
        drag.hit.kind === "customPlaneBody";
      const snap = gridOnly ? null : findSnapTarget(rawX, rawY, drag.hit);
      const newX = snap ? snap[0] : snapValue(rawX);
      const newY = snap ? snap[1] : snapValue(rawY);

      // Show the snapped coordinate in the status bar, not the raw mouse position
      if (drag.hit.kind !== "annotation") {
        setMouseWorld([newX, newY]);
      }
      const rect = canvasRef.current?.getBoundingClientRect();
      const tipAt = { x: clientX - (rect?.left ?? 0), y: clientY - (rect?.top ?? 0) };

      if (drag.hit.kind === "customCircle") {
        const hit = drag.hit;
        const plane = s.customSearchPlanes.find((p) => p.id === hit.planeId);
        if (!plane || plane.points) return;
        const patch =
          hit.handle === "centre"
            ? { cx: newX, cy: newY }
            : { radius: circleRadiusFromPointer(plane.cx, plane.cy, rawX, rawY, snapValue) };
        handleActions().updateCustomSearchPlane(hit.planeId, patch);
        setDragTip({ text: circleTipText({ ...plane, ...patch }), ...tipAt });
        return;
      }

      // A reference annotation (result view): a vertex or centre follows
      // the (snapped) pointer, a rim sets the radius, a line moves whole by
      // the pointer's travel since the press. One undo step per drag.
      if (drag.hit.kind === "referenceVertex" || drag.hit.kind === "referenceCircle" || drag.hit.kind === "referenceLine") {
        const start = drag.reference;
        if (!start) return;
        const hit = drag.hit;
        if (hit.kind === "referenceVertex" && start.shape === "polyline") {
          const points = start.points.map((p, i): [number, number] => (i === hit.pointIndex ? [newX, newY] : p));
          updateAnnotation(start.id, { points });
        } else if (hit.kind === "referenceCircle" && start.shape === "circle") {
          if (hit.handle === "centre") updateAnnotation(start.id, { cx: newX, cy: newY });
          else updateAnnotation(start.id, { radius: Math.max(MIN_REFERENCE_RADIUS, snapValue(Math.hypot(rawX - start.cx, rawY - start.cy))) });
        } else if (hit.kind === "referenceLine") {
          const moved = translateReference(start, rawX - drag.startWorld[0], rawY - drag.startWorld[1]);
          updateAnnotation(start.id, moved.shape === "polyline" ? { points: moved.points } : { cx: moved.cx, cy: moved.cy });
        }
        return;
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
          s.resultViewSettings.paperFrame.zoom ?? 1,
          s.resultViewSettings.paperFrame.offsetX ?? 0,
          s.resultViewSettings.paperFrame.offsetY ?? 0,
        );
        const cxPx = clientX - rect.left;
        const cyPx = clientY - rect.top;
        const startCxPx = drag.startPx[0] - rect.left;
        const startCyPx = drag.startPx[1] - rect.top;
        const dxFrac = (cxPx - startCxPx) / pf.w;
        const dyFrac = (cyPx - startCyPx) / pf.h;
        const draggedId = drag.hit.annoId;

        if (selectedAnnotationIds.includes(draggedId)) {
          if (selectedAnnotationIds.length > 1) {
            const draggedAnno = s.resultViewSettings.annotations.find(
              (a) => a.id === draggedId,
            );
            if (draggedAnno && isPaperAnnotation(draggedAnno)) {
              const ddx = drag.startWorld[0] + dxFrac - draggedAnno.x;
              const ddy = drag.startWorld[1] + dyFrac - draggedAnno.y;
              for (const sid of selectedAnnotationIds) {
                const sa = s.resultViewSettings.annotations.find(
                  (a) => a.id === sid,
                );
                if (sa && isPaperAnnotation(sa)) {
                  updateAnnotation(sid, { x: sa.x + ddx, y: sa.y + ddy });
                }
              }
            }
          } else {
            updateAnnotation(draggedId, {
              x: drag.startWorld[0] + dxFrac,
              y: drag.startWorld[1] + dyFrac,
            });
          }
        } else {
          updateAnnotation(draggedId, {
            x: drag.startWorld[0] + dxFrac,
            y: drag.startWorld[1] + dyFrac,
          });
        }
        return;
      }

      // Objects moved whole (edit view): by the pointer's travel, in whole
      // grid steps, so points on the grid stay on it.
      if (drag.hit.kind === "udlBody") {
        const start = drag.udl;
        if (!start || start.expressions?.x1?.trim() || start.expressions?.x2?.trim()) return;
        const d = snapValue(rawX - drag.startWorld[0]);
        handleActions().updateUdl(start.id, { x1: start.x1 + d, x2: start.x2 + d });
        setDragTip({ text: `x ${(start.x1 + d).toFixed(2)} to ${(start.x2 + d).toFixed(2)} m`, ...tipAt });
        return;
      }
      if (drag.hit.kind === "customPlaneBody") {
        const start = drag.plane;
        if (!start?.points) return;
        const ddx = snapValue(rawX - drag.startWorld[0]);
        const ddy = snapValue(rawY - drag.startWorld[1]);
        handleActions().updateCustomSearchPlane(start.id, {
          points: start.points.map(([x, y]): [number, number] => [x + ddx, y + ddy]),
        });
        setDragTip({ text: `moved ${ddx.toFixed(2)}, ${ddy.toFixed(2)} m`, ...tipAt });
        return;
      }

      // A handle (edit view): it follows the snapped pointer.
      if (drag.object && drag.point !== undefined && drag.point !== null) {
        const point = drag.point;
        const object = drag.object;
        moveHandleTo(useAppStore.getState(), handleActions(), object, point, [newX, newY]);
        // The exterior's and the water lines' points carry their own
        // coordinate labels; other handles show theirs beside the pointer.
        if (object.type !== "exterior" && object.type !== "waterLine") {
          const axes = handleAxes(object, point);
          setDragTip({
            text: axes === "x" ? `x ${newX.toFixed(2)} m` : `${newX.toFixed(2)}, ${newY.toFixed(2)}`,
            ...tipAt,
          });
        }
      }
    },
    [
      canvasRef,
      findSnapTarget,
      handleActions,
      selectedAnnotationIds,
      snapValue,
      updateAnnotation,
    ],
  );

  /**
   * Topmost annotation under the pointer, using its drawn bounding box
   * (the anchor point within 15 px when there is no result to measure).
   */
  const findAnnotationAt = useCallback(
    (clientX: number, clientY: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return null;
      const ctx = canvas.getContext("2d");
      const rect = canvas.getBoundingClientRect();
      const state = useAppStore.getState();
      const frame = state.resultViewSettings.paperFrame;
      const pf = computePaperFrame(
        rect.width,
        rect.height,
        frame.paperSize,
        frame.landscape,
        frame.zoom ?? 1,
        frame.offsetX ?? 0,
        frame.offsetY ?? 0,
      );
      const cxPx = clientX - rect.left;
      const cyPx = clientY - rect.top;
      const annos = state.resultViewSettings.annotations;
      for (let i = annos.length - 1; i >= 0; i--) {
        const a = annos[i];
        // Reference annotations are hit through findReferenceAt.
        if (a.type === "reference") continue;
        if (ctx && state.result) {
          const b = getAnnotationBoundsPx(ctx, {
            annotation: a,
            paperFrame: pf,
            result: state.result,
            materials: state.materials,
            piezometricLine: state.piezometricLine,
            projectInfo: state.projectInfo,
            parameters: state.parameters,
            resultView: state.resultViewSettings,
          });
          if (
            cxPx >= b.x &&
            cxPx <= b.x + b.w &&
            cyPx >= b.y &&
            cyPx <= b.y + b.h
          ) {
            return a;
          }
        } else {
          const dx = cxPx - (pf.x + a.x * pf.w);
          const dy = cyPx - (pf.y + a.y * pf.h);
          if (Math.hypot(dx, dy) < 15) return a;
        }
      }
      return null;
    },
    [canvasRef],
  );

  /** The reference annotation (its handle, line or arc) under the pointer in the result view. */
  const findReferenceAt = useCallback(
    (clientX: number, clientY: number): PointHit | null => {
      const canvas = canvasRef.current;
      if (!canvas) return null;
      return findReferenceHitAt(useAppStore.getState(), canvas.getBoundingClientRect(), clientX, clientY);
    },
    [canvasRef],
  );

  // The animation loop outlives the render it started in; read the latest
  // callbacks through refs instead of the ones captured at pointer-down.
  const updateDragRef = useRef(updateDragAtPointer);
  const applyEdgePanRef = useRef(applyEdgePan);
  useEffect(() => {
    updateDragRef.current = updateDragAtPointer;
    applyEdgePanRef.current = applyEdgePan;
  }, [updateDragAtPointer, applyEdgePan]);

  const startAutoPan = useCallback(() => {
    if (autoPanRafRef.current !== null) return;
    const tick = () => {
      const drag = dragRef.current;
      if (!drag) {
        autoPanRafRef.current = null;
        return;
      }
      if (drag.moved) applyEdgePanRef.current();
      const last = lastPointerRef.current;
      if (last) updateDragRef.current(last.x, last.y);
      autoPanRafRef.current = requestAnimationFrame(tick);
    };
    autoPanRafRef.current = requestAnimationFrame(tick);
  }, []);

  /** Edit view: the drag a press on the selected object would start (null: none). */
  const editDragAt = useCallback(
    (candidates: CanvasCandidate[], wx: number, wy: number) => {
      const st = useAppStore.getState();
      const sel = st.canvasSelection;
      if (!sel) return null;
      const own = candidates.find((c) => sameObject(c.object, sel.object));
      if (!own || isObjectLocked(st.locks, sel.object)) return null;
      if (own.point === null && !bodyDraggable(sel.object)) return null;
      const hit = dragHitOf(st, sel.object, own.point);
      if (!hit) return null;
      // A handle starts from its own position (it snaps from there); a
      // rim or a body from the pointer.
      let startWorld: [number, number] = [wx, wy];
      if (own.point !== null && own.point !== "rim") {
        const at = handleStart(st, sel.object, own.point);
        if (at) startWorld = at;
      }
      return {
        hit,
        startWorld,
        object: sel.object,
        point: own.point,
        udl: hit.kind === "udlBody" ? st.udls.find((u) => u.id === hit.udlId) : undefined,
        plane: hit.kind === "customPlaneBody" ? st.customSearchPlanes.find((p) => p.id === hit.planeId) : undefined,
      };
    },
    [],
  );

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
          // A paper annotation (colour bar, text, ...) is drawn over the
          // reference lines, so it takes the pointer first.
          const a = findAnnotationAt(e.clientX, e.clientY);
          const refHit = a ? null : findReferenceAt(e.clientX, e.clientY);
          const refId = referenceHitId(refHit);
          if (refHit && refId) {
            // Select first, then drag: a press on a line that is not
            // selected selects it and moves nothing.
            const wasSelected = selectedAnnotationIds.includes(refId);
            if (e.ctrlKey || e.shiftKey) {
              toggleAnnotationSelection(refId, true);
            } else if (!wasSelected) {
              setSelectedAnnotations([refId]);
            }
            if (e.button !== 0 || !wasSelected) return;
            const anno = useAppStore.getState().resultViewSettings.annotations.find((an) => an.id === refId);
            if (!anno || anno.type !== "reference") return;
            // A handle starts from its own point (it snaps from there); a
            // line or rim from the pointer itself.
            const startWorld: [number, number] =
              refHit.kind === "referenceVertex" && anno.shape === "polyline"
                ? [anno.points[refHit.pointIndex][0], anno.points[refHit.pointIndex][1]]
                : refHit.kind === "referenceCircle" && refHit.handle === "centre" && anno.shape === "circle"
                  ? [anno.cx, anno.cy]
                  : [wx, wy];
            dragRef.current = {
              hit: refHit,
              startWorld,
              startPx: [e.clientX, e.clientY],
              downPx: [e.clientX, e.clientY],
              moved: false,
              reference: anno,
            };
            beginDragHistoryBatch();
            (e.target as HTMLElement).setPointerCapture(e.pointerId);
            return;
          }
          if (a) {
            if (e.ctrlKey || e.shiftKey) {
              toggleAnnotationSelection(a.id, true);
            } else if (!selectedAnnotationIds.includes(a.id)) {
              setSelectedAnnotations([a.id]);
            }
            // Only the primary button drags (right-click opens a menu).
            if (e.button !== 0) return;
            const hit: PointHit = { kind: "annotation", annoId: a.id };
            dragRef.current = {
              hit,
              startWorld: [a.x, a.y],
              startPx: [e.clientX, e.clientY],
              downPx: [e.clientX, e.clientY],
              moved: false,
            };
            beginDragHistoryBatch();
            (e.target as HTMLElement).setPointerCapture(e.pointerId);
            return;
          }
          setSelectedResultObject("paper-frame");
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

      setSelectedResultObject(null);

      if (e.button !== 0) return;

      // Assigning a material (armed in the Assign window): the click goes
      // to the region under it.
      if (assigningMaterialId) {
        if (findRegionAtPoint(wx, wy)) setRegionMaterial([wx, wy], assigningMaterialId);
        setAssigningMaterial(null);
        return;
      }

      const candidates = findObjectsAt?.(wx, wy) ?? [];
      pressRef.current = { downPx: [e.clientX, e.clientY], candidates, moved: false };
      (e.target as HTMLElement).setPointerCapture(e.pointerId);

      // A press on a handle (or the movable body) of the selected, unlocked
      // object drags it once the pointer moves; on anything else a drag
      // moves nothing (or pans, with the pan tool).
      const drag = editDragAt(candidates, wx, wy);
      if (drag) {
        dragRef.current = {
          ...drag,
          startPx: [e.clientX, e.clientY],
          downPx: [e.clientX, e.clientY],
          moved: false,
        };
        beginDragHistoryBatch();
        startAutoPan();
        return;
      }
      if (panActive) {
        panRef.current = {
          startPx: [e.clientX, e.clientY],
          startOffset: [...viewOffset],
        };
      }
    },
    [
      assigningMaterialId,
      beginDragHistoryBatch,
      canvasRef,
      editDragAt,
      findAnnotationAt,
      findObjectsAt,
      findReferenceAt,
      findRegionAtPoint,
      getEventWorldPos,
      mode,
      panActive,
      selectedAnnotationIds,
      setAssigningMaterial,
      setContextMenu,
      setMaterialPicker,
      setRegionMaterial,
      setSelectedAnnotations,
      setSelectedResultObject,
      startAutoPan,
      toggleAnnotationSelection,
      viewOffset,
    ],
  );

  /** Edit view: what the hover highlights and the cursor shows, from the objects under the pointer. */
  const updateEditHover = useCallback((candidates: CanvasCandidate[]) => {
    const st = useAppStore.getState();
    const sel = st.canvasSelection;
    // The selected object's handle wins where it overlaps others.
    const top = (sel && candidates.find((c) => sameObject(c.object, sel.object))) ?? candidates[0] ?? null;
    const next: HoverObject | null = top ? { ...top, locked: isObjectLocked(st.locks, top.object) } : null;
    const prev = hoverObjectRef.current;
    if (!(prev === next || (prev && next && sameObject(prev.object, next.object) && prev.point === next.point && prev.locked === next.locked))) {
      hoverObjectRef.current = next;
      setHoverObject(next);
    }
    // A locked object's handles show no hover: they cannot be dragged.
    const hit = top && top.point !== null && !next?.locked ? dragHitOf(st, top.object, top.point) : null;
    if (!isSameHit(hoverHitRef.current, hit)) {
      hoverHitRef.current = hit;
      setHoverHit(hit);
    }
  }, []);

  const handlePointerMove = useCallback(
    (e: RPointerEvent<HTMLCanvasElement>) => {
      const [wx, wy] = getEventWorldPos(e);
      setMouseWorld([wx, wy]);
      lastPointerRef.current = { x: e.clientX, y: e.clientY };

      const s = useAppStore.getState();
      const currentViewScale =
        (s.mode === "result" ? s.resultViewScale : s.editViewScale) || 1;

      const press = pressRef.current;
      if (press && !press.moved && Math.hypot(e.clientX - press.downPx[0], e.clientY - press.downPx[1]) >= DRAG_THRESHOLD_PX) {
        press.moved = true;
      }

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
      // A press that is no drag moves nothing; the hover stays as it was.
      if (press) return;

      if (mode === "result") {
        // Same hit area as a click, so the cursor matches what a click does.
        // Paper annotations first: they are drawn over the reference lines.
        const a = findAnnotationAt(e.clientX, e.clientY);
        const ref = a ? null : findReferenceAt(e.clientX, e.clientY);
        const hit: PointHit | null = a ? { kind: "annotation", annoId: a.id } : ref;
        if (!isSameHit(hoverHitRef.current, hit)) {
          hoverHitRef.current = hit;
          setHoverHit(hit);
        }
        return;
      }
      updateEditHover(findObjectsAt?.(wx, wy) ?? []);
    },
    [
      applyEdgePan,
      findAnnotationAt,
      findObjectsAt,
      findReferenceAt,
      getEventWorldPos,
      mode,
      setActiveViewOffset,
      updateDragAtPointer,
      updateEditHover,
    ],
  );

  /**
   * Edit view: a click (a press without a drag). On the selected object's
   * point: that point is selected. Again at the same spot: the next of the
   * objects under the pointer. On another object: it is selected. On empty
   * canvas: the selection is cleared.
   */
  const handleEditClick = useCallback((press: { downPx: [number, number]; candidates: CanvasCandidate[] }) => {
    const st = useAppStore.getState();
    const { candidates } = press;
    const last = lastClickRef.current;
    const repeat =
      !!last &&
      Math.hypot(last.px[0] - press.downPx[0], last.px[1] - press.downPx[1]) <= DRAG_THRESHOLD_PX &&
      last.candidates.length === candidates.length &&
      last.candidates.every((c, i) => sameObject(c.object, candidates[i].object));
    lastClickRef.current = { px: press.downPx, candidates };
    if (candidates.length === 0) {
      st.clearCanvasSelection();
      setSelectedRegionKey(null);
      return;
    }
    const sel = st.canvasSelection;
    const own = sel ? candidates.find((c) => sameObject(c.object, sel.object)) : undefined;
    const cycleOf = (i: number) => (candidates.length > 1 ? { position: i + 1, count: candidates.length } : null);
    if (sel && own) {
      if (own.point !== null && own.point !== sel.point) {
        st.selectCanvasPoint(own.point);
      } else if (repeat && candidates.length > 1) {
        const i = nextCycleIndex(candidates.map((c) => c.object), sel.object);
        st.selectCanvasObject(candidates[i].object, null, cycleOf(i));
      } else if (own.point === null && sel.point !== null) {
        st.selectCanvasPoint(null);
      }
      return;
    }
    st.selectCanvasObject(candidates[0].object, null, cycleOf(0));
  }, [setSelectedRegionKey]);

  const endPointer = useCallback(
    (e: RPointerEvent<HTMLCanvasElement>, click: boolean) => {
      const press = pressRef.current;
      const drag = dragRef.current;
      if (drag) commitDragHistoryBatch();
      dragRef.current = null;
      panRef.current = null;
      pressRef.current = null;
      lastPointerRef.current = null;
      setDragTip(null);
      setDragging(false);
      stopAutoPan();
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
      if (click && press && !press.moved && !drag?.moved) handleEditClick(press);
    },
    [commitDragHistoryBatch, handleEditClick, stopAutoPan],
  );

  const handlePointerUp = useCallback(
    (e: RPointerEvent<HTMLCanvasElement>) => endPointer(e, true),
    [endPointer],
  );

  const handlePointerCancel = useCallback(
    (e: RPointerEvent<HTMLCanvasElement>) => endPointer(e, false),
    [endPointer],
  );

  /**
   * Edit view: a double-click on a point of the selected object opens its
   * editor; on empty canvas in a region, the material picker.
   */
  const handleDoubleClick = useCallback(
    (e: RMouseEvent<HTMLCanvasElement>) => {
      if (mode !== "edit") return;
      const [wx, wy] = getEventWorldPos(e);
      const candidates = findObjectsAt?.(wx, wy) ?? [];
      const rect = canvasRef.current?.getBoundingClientRect();
      const at = { x: e.clientX - (rect?.left ?? 0), y: e.clientY - (rect?.top ?? 0) };
      const st = useAppStore.getState();
      const sel = st.canvasSelection;
      const own = sel ? candidates.find((c) => sameObject(c.object, sel.object)) : undefined;
      if (sel && own && own.point !== null) {
        st.selectCanvasPoint(own.point);
        onEditPoint?.(sel.object, own.point, at);
        return;
      }
      if (candidates.length === 0) {
        const region = findRegionAtPoint(wx, wy);
        if (region) {
          setSelectedRegionKey(region.regionKey);
          setMaterialPicker({ screenX: at.x, screenY: at.y, worldPoint: [wx, wy] });
        }
      }
    },
    [canvasRef, findObjectsAt, findRegionAtPoint, getEventWorldPos, mode, onEditPoint, setMaterialPicker, setSelectedRegionKey],
  );

  const handleWheel = useCallback(
    (e: CanvasWheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const state = useAppStore.getState();
      if (state.mode === "result" && state.resultViewSettings.viewLock) return;

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
        const newScale = Math.max(VIEW_SCALE_MIN, Math.min(VIEW_SCALE_MAX, oldScale * factor));
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

  /** The cursor over the edit canvas: grab a draggable handle, point at a selectable object. */
  const editCursor = (): string => {
    if (dragging) return "grabbing";
    const h = hoverObject;
    if (!h) return "default";
    const sel = useAppStore.getState().canvasSelection;
    if (!sel || !sameObject(sel.object, h.object)) return "pointer";
    if (h.locked) return h.point !== null || bodyDraggable(h.object) ? "not-allowed" : "pointer";
    if (h.point === null) return bodyDraggable(h.object) ? "move" : "pointer";
    if (h.point === "rim") return "crosshair";
    return handleAxes(h.object, h.point) === "x" ? "ew-resize" : "grab";
  };

  return {
    mouseWorld,
    hoverHit,
    hoverObject,
    dragTip,
    dragging,
    cursor: mode === "edit" ? editCursor() : hoverHit ? "grab" : "default",
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    handlePointerCancel,
    handleDoubleClick,
    handleWheel,
    setMouseWorld,
    setHoverHit,
  };
}

/** Where a handle drag starts: the handle's own position (a load end on the ground line's x). */
function handleStart(st: AppState, object: CanvasObjectRef, point: CanvasPointKey): [number, number] | null {
  switch (object.type) {
    case "exterior":
      return typeof point === "number" ? [...st.coordinates[point]] : null;
    case "boundary": {
      const p = typeof point === "number" ? st.materialBoundaries.find((b) => b.id === object.id)?.coordinates[point] : undefined;
      return p ? [p[0], p[1]] : null;
    }
    case "waterLine": {
      const p = typeof point === "number" ? st.piezometricLine.lines.find((l) => l.id === object.id)?.coordinates[point] : undefined;
      return p ? [p[0], p[1]] : null;
    }
    case "searchLimits":
      return point === "entryLeftX" || point === "entryRightX" || point === "exitLeftX" || point === "exitRightX"
        ? [st.analysisLimits[point], 0]
        : null;
    case "udl": {
      const u = st.udls.find((v) => v.id === object.id);
      return u && (point === "x1" || point === "x2") ? [u[point], 0] : null;
    }
    case "lineLoad": {
      const l = st.lineLoads.find((v) => v.id === object.id);
      return l ? [l.x, 0] : null;
    }
    case "reinforcement":
    case "pile": {
      const r = (object.type === "pile" ? st.piles : st.reinforcements).find((v) => v.id === object.id);
      if (!r) return null;
      return point === "end1" ? [r.x1, r.y1] : point === "end2" ? [r.x2, r.y2] : null;
    }
    case "customPlane": {
      const p = st.customSearchPlanes.find((v) => v.id === object.id);
      if (!p) return null;
      if (p.points) return typeof point === "number" && p.points[point] ? [p.points[point][0], p.points[point][1]] : null;
      return point === "centre" ? [p.cx, p.cy] : null;
    }
  }
}
