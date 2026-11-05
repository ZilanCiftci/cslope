import {
  useCallback,
  useState,
  type RefObject,
  type MouseEvent as RMouseEvent,
} from "react";
import { computePaperFrame, getAnnotationBoundsPx } from "../helpers";
import { useAppStore } from "../../../store/app-store";
import type { AppMode, CanvasObjectRef } from "../../../store/types";
import type { ContextMenuItem, ContextMenuState, EdgeHit, MaterialPickerState } from "../types";
import { findReferenceEdgeAt, findReferenceHitAt, referenceHitId } from "../reference-geometry";
import type { CanvasCandidate } from "../object-hits";
import { openPlaceDrawing } from "../../drawings/window-sync";
import { peekSource } from "../../drawings/drawing-cache";
import { startLinePick } from "../../drawings/line-pick-store";
import {
  LOCK_GROUPS,
  canDeletePoint,
  canvasObjectLabel,
  groupHasUnlocked,
  hasLocks,
  isObjectLocked,
  sameObject,
} from "../../../store/canvas-selection";

interface ContextMenuParams {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  mode: AppMode;
  selectedAnnotationIds: string[];
  setSelectedAnnotations: (ids: string[]) => void;
  alignAnnotations: (
    dir: "left" | "right" | "top" | "bottom" | "center-h" | "center-v",
  ) => void;
  getEventWorldPos: (e: {
    clientX: number;
    clientY: number;
  }) => [number, number];
  /** Edit view: every object under the pointer, topmost first. */
  findObjectsAt?: (wx: number, wy: number) => CanvasCandidate[];
  /** Edit view: the topmost visible drawing under the pointer, locked or not. */
  findDrawingAt?: (wx: number, wy: number) => string | null;
  /** Edit view: where a point would be added on the object's line under the pointer. */
  edgeAt?: (object: CanvasObjectRef, wx: number, wy: number) => EdgeHit | null;
  /** Edit view: the material region under the pointer. */
  findRegionAtPoint?: (wx: number, wy: number) => { regionKey: string } | null;
  setMaterialPicker: (picker: MaterialPickerState | null) => void;
  /** Edit view: copies a custom search plane into a reference annotation (absent: no such item). */
  addReferenceFromCustomPlane?: (planeId: string) => void;
  /** Result view: snaps a point added to a reference polyline (absent: no snapping). */
  snapValue?: (v: number) => number;
}

export function useContextMenu(params: ContextMenuParams) {
  const {
    canvasRef,
    mode,
    selectedAnnotationIds,
    setSelectedAnnotations,
    alignAnnotations,
    getEventWorldPos,
    findObjectsAt,
    findDrawingAt,
    edgeAt,
    findRegionAtPoint,
    setMaterialPicker,
    addReferenceFromCustomPlane,
    snapValue,
  } = params;

  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  const handleContextMenu = useCallback(
    (e: RMouseEvent<HTMLCanvasElement>) => {
      e.preventDefault();

      if (mode === "result") {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext("2d");
        const canvasRect = canvas.getBoundingClientRect();
        const cxPx = e.clientX - canvasRect.left;
        const cyPx = e.clientY - canvasRect.top;
        const pf = computePaperFrame(
          canvasRect.width,
          canvasRect.height,
          useAppStore.getState().resultViewSettings.paperFrame.paperSize,
          useAppStore.getState().resultViewSettings.paperFrame.landscape,
          useAppStore.getState().resultViewSettings.paperFrame.zoom ?? 1,
          useAppStore.getState().resultViewSettings.paperFrame.offsetX ?? 0,
          useAppStore.getState().resultViewSettings.paperFrame.offsetY ?? 0,
        );
        const state = useAppStore.getState();
        const annos = state.resultViewSettings.annotations;
        const resultForBounds = state.result;

        // A paper annotation under the pointer: drawn over the reference
        // lines, so it is hit first.
        let hitAnno: string | null = null;
        for (let i = annos.length - 1; i >= 0; i--) {
          const a = annos[i];
          if (a.type === "reference") continue;
          const hit =
            ctx && resultForBounds
              ? (() => {
                  const b = getAnnotationBoundsPx(ctx, {
                    annotation: a,
                    paperFrame: pf,
                    result: resultForBounds,
                    materials: state.materials,
                    piezometricLine: state.piezometricLine,
                    projectInfo: state.projectInfo,
                    parameters: state.parameters,
                    resultView: state.resultViewSettings,
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
            hitAnno = a.id;
            break;
          }
        }

        // A reference annotation: its points (a polyline's vertex removed,
        // one added on a segment) and the annotation itself.
        const refHit = hitAnno ? null : findReferenceHitAt(state, canvasRect, e.clientX, e.clientY);
        const refId = referenceHitId(refHit);
        if (refHit && refId) {
          setSelectedAnnotations([refId]);
          const anno = annos.find((a) => a.id === refId);
          const items: ContextMenuState["items"] = [];
          if (anno?.type === "reference" && anno.shape === "polyline") {
            if (refHit.kind === "referenceVertex") {
              const count = anno.points.length;
              const at = refHit.pointIndex;
              items.push({
                label: "Delete point",
                danger: true,
                // A polyline keeps at least two points.
                disabled: count <= 2,
                action: () => {
                  if (count > 2) {
                    state.updateAnnotation(refId, { points: anno.points.filter((_, i) => i !== at) });
                  }
                  setContextMenu(null);
                },
              });
            } else if (refHit.kind === "referenceLine") {
              const edge = findReferenceEdgeAt(state, canvasRect, e.clientX, e.clientY, snapValue ?? ((v) => v));
              if (edge?.kind === "reference") {
                items.push({
                  label: "Add point",
                  action: () => {
                    state.updateAnnotation(refId, {
                      points: [...anno.points.slice(0, edge.insertIndex), edge.snapPoint, ...anno.points.slice(edge.insertIndex)],
                    });
                    setContextMenu(null);
                  },
                });
              }
            }
          }
          items.push({
            label: anno?.type === "reference" && anno.shape === "circle" ? "Delete reference circle" : "Delete reference line",
            danger: true,
            action: () => {
              state.removeAnnotation(refId);
              setContextMenu(null);
            },
          });
          setContextMenu({ screenX: cxPx, screenY: cyPx, items });
          return;
        }

        if (hitAnno) {
          if (
            selectedAnnotationIds.length >= 2 &&
            selectedAnnotationIds.includes(hitAnno)
          ) {
            const items: ContextMenuState["items"] = [
              {
                label: "Align left",
                action: () => {
                  alignAnnotations("left");
                  setContextMenu(null);
                },
              },
              {
                label: "Align right",
                action: () => {
                  alignAnnotations("right");
                  setContextMenu(null);
                },
              },
              {
                label: "Align top",
                action: () => {
                  alignAnnotations("top");
                  setContextMenu(null);
                },
              },
              {
                label: "Align bottom",
                action: () => {
                  alignAnnotations("bottom");
                  setContextMenu(null);
                },
              },
              {
                label: "Center horizontally",
                action: () => {
                  alignAnnotations("center-h");
                  setContextMenu(null);
                },
              },
              {
                label: "Center vertically",
                action: () => {
                  alignAnnotations("center-v");
                  setContextMenu(null);
                },
              },
            ];
            setContextMenu({ screenX: cxPx, screenY: cyPx, items });
          } else {
            setSelectedAnnotations([hitAnno]);
            setContextMenu(null);
          }
          return;
        }
        return;
      }

      setMaterialPicker(null);

      const [wx, wy] = getEventWorldPos(e);
      const canvas = canvasRef.current;
      if (!canvas) return;
      const canvasRect = canvas.getBoundingClientRect();
      const screenX = e.clientX - canvasRect.left;
      const screenY = e.clientY - canvasRect.top;
      const st = useAppStore.getState();
      const close = (fn: () => void) => () => {
        fn();
        setContextMenu(null);
      };

      // The object under the pointer: the selected one where it is there,
      // else the topmost. A right-click selects it (and the point under the
      // pointer), so the menu acts on what is shown as selected.
      const candidates = findObjectsAt?.(wx, wy) ?? [];
      const sel = st.canvasSelection;
      const target = (sel && candidates.find((c) => sameObject(c.object, sel.object))) ?? candidates[0];
      if (target) {
        const object = target.object;
        if (!sel || !sameObject(sel.object, object) || sel.point !== target.point) {
          st.selectCanvasObject(object, target.point);
        }
        const locked = isObjectLocked(st.locks, object);
        const items: ContextMenuItem[] = [];
        const point = target.point;
        if (typeof point === "number") {
          items.push({
            label: "Delete point",
            danger: true,
            disabled: locked || !canDeletePoint(st, object, point),
            action: close(() => {
              const s = useAppStore.getState();
              if (isObjectLocked(s.locks, object) || !canDeletePoint(s, object, point)) return;
              deletePoint(object, point);
              s.selectCanvasObject(object, null);
            }),
          });
        } else if (point === null) {
          const edge = edgeAt?.(object, wx, wy) ?? null;
          if (edge) {
            items.push({
              label: "Add point",
              disabled: locked,
              action: close(() => {
                if (isObjectLocked(useAppStore.getState().locks, object)) return;
                insertPoint(edge);
                useAppStore.getState().selectCanvasObject(object, edge.insertIndex);
              }),
            });
          }
        }
        if (object.type === "background") {
          setContextMenu({ screenX, screenY, items: drawingMenuItems(object.id, close) });
          return;
        }
        if (object.type === "customPlane") {
          const plane = st.customSearchPlanes.find((p) => p.id === object.id);
          items.push({
            label: plane?.points ? "Delete surface" : "Delete circle",
            danger: true,
            disabled: locked,
            action: close(() => {
              const s = useAppStore.getState();
              if (!isObjectLocked(s.locks, object)) s.removeCustomSearchPlane(object.id);
            }),
          });
          if (addReferenceFromCustomPlane) {
            items.push({
              label: "Add as reference line",
              action: close(() => addReferenceFromCustomPlane(object.id)),
            });
          }
        }
        // "Lock exterior boundary": the whole object, not the point.
        const name = canvasObjectLabel(st, object);
        const objectName = name.charAt(0).toLowerCase() + name.slice(1);
        items.push({
          label: `${locked ? "Unlock" : "Lock"} ${objectName}`,
          separator: items.length > 0,
          action: close(() => useAppStore.getState().setObjectLocked(object, !locked)),
        });
        setContextMenu({ screenX, screenY, items });
        return;
      }

      // Empty canvas: a drawing there (locked ones let clicks through, so
      // this is where they are unlocked), the material of the region there,
      // and the locks.
      const items: ContextMenuItem[] = [];
      const drawingId = findDrawingAt?.(wx, wy) ?? null;
      if (drawingId) items.push(...drawingMenuItems(drawingId, close));
      const region = findRegionAtPoint?.(wx, wy) ?? null;
      if (region) {
        items.push({
          label: "Assign material…",
          separator: items.length > 0,
          action: () => {
            st.setSelectedRegionKey(region.regionKey);
            setContextMenu(null);
            setMaterialPicker({ screenX, screenY, worldPoint: [wx, wy] });
          },
        });
      }
      const lockable = LOCK_GROUPS.filter(({ group }) => groupHasUnlocked(st.locks, st, group));
      items.push({
        label: "Lock all",
        separator: items.length > 0,
        disabled: lockable.length === 0,
        action: () => {},
        submenu: LOCK_GROUPS.map(({ group, label }) => ({
          label,
          disabled: !groupHasUnlocked(st.locks, st, group),
          action: close(() => useAppStore.getState().lockAllOfGroup(group)),
        })),
      });
      items.push({
        label: "Unlock all",
        disabled: !hasLocks(st.locks),
        action: close(() => useAppStore.getState().unlockAll()),
      });
      setContextMenu({ screenX, screenY, items });
    },
    [
      addReferenceFromCustomPlane,
      alignAnnotations,
      canvasRef,
      edgeAt,
      findObjectsAt,
      findDrawingAt,
      findRegionAtPoint,
      getEventWorldPos,
      mode,
      selectedAnnotationIds,
      setSelectedAnnotations,
      setMaterialPicker,
      snapValue,
    ],
  );

  return {
    contextMenu,
    setContextMenu,
    handleContextMenu,
  };
}

/** The menu of a drawing on the canvas: lock, recalibrate, hide, remove. */
function drawingMenuItems(id: string, close: (fn: () => void) => () => void): ContextMenuItem[] {
  const st = useAppStore.getState();
  const object: CanvasObjectRef = { type: "background", id };
  const locked = isObjectLocked(st.locks, object);
  return [
    {
      label: locked ? "Unlock drawing" : "Lock drawing",
      action: close(() => {
        const s = useAppStore.getState();
        s.setObjectLocked(object, !locked);
        // Unlocked: selected, so it can be moved at once.
        if (locked) s.selectCanvasObject(object);
      }),
    },
    { label: "Recalibrate…", action: close(() => openPlaceDrawing(id)) },
    ...(hasLineWork(st.backgrounds.find((b) => b.id === id)?.assetId)
      ? [{ label: "Pick lines…", action: close(() => startLinePick(id)) }]
      : []),
    { label: "Hide drawing", action: close(() => useAppStore.getState().updateBackground(id, { visible: false })) },
    { label: "Remove drawing", danger: true, action: close(() => useAppStore.getState().removeBackground(id)) },
  ];
}

/** A drawing that may have line work to pick (a DWG, DXF or PDF file, not an image). */
function hasLineWork(assetId: string | undefined): boolean {
  if (!assetId) return false;
  const kind = peekSource(assetId)?.kind;
  return kind === "vector" || kind === "pdf";
}

/** Remove a vertex of an object (the caller checks it may be removed). */
function deletePoint(object: CanvasObjectRef, index: number): void {
  const s = useAppStore.getState();
  switch (object.type) {
    case "exterior":
      s.removeCoordinate(index);
      break;
    case "boundary":
      s.removeBoundaryPoint(object.id, index);
      break;
    case "waterLine":
      if (s.piezometricLine.activeLineId !== object.id) s.setActivePiezoLine(object.id);
      useAppStore.getState().removePiezoPoint(index);
      break;
    case "customPlane":
      s.removeCustomPlanePoint(object.id, index);
      break;
  }
}

/** Add a vertex on a segment of an object's line. */
function insertPoint(edge: EdgeHit): void {
  const s = useAppStore.getState();
  switch (edge.kind) {
    case "external":
      s.insertCoordinateAt(edge.insertIndex, edge.snapPoint);
      break;
    case "boundary":
      s.insertBoundaryPointAt(edge.boundaryId, edge.insertIndex, edge.snapPoint);
      break;
    case "piezo":
      if (s.piezometricLine.activeLineId !== edge.lineId) s.setActivePiezoLine(edge.lineId);
      useAppStore.getState().insertPiezoPointAt(edge.insertIndex, edge.snapPoint);
      break;
    case "customPlane":
      s.insertCustomPlanePointAt(edge.planeId, edge.insertIndex, edge.snapPoint);
      break;
  }
}
