import {
  useCallback,
  useState,
  type RefObject,
  type MouseEvent as RMouseEvent,
} from "react";
import { computePaperFrame, getAnnotationBoundsPx } from "../helpers";
import { useAppStore } from "../../../store/app-store";
import type { AppMode } from "../../../store/types";
import type {
  ContextMenuState,
  EdgeHit,
  MaterialPickerState,
  PointHit,
} from "../types";
import type { PiezometricLineState } from "../../../store/types";
import { isClosedBoundary } from "../../../utils/regions";
import { findReferenceEdgeAt, findReferenceHitAt, referenceHitId } from "../reference-geometry";

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
  findNearPointUnified: (wx: number, wy: number) => PointHit | null;
  findNearEdgeUnified: (wx: number, wy: number) => EdgeHit | null;
  coordinates: [number, number][];
  materialBoundaries: { id: string; coordinates: [number, number][] }[];
  piezometricLine: PiezometricLineState;
  setActivePiezoLine: (lineId: string | null) => void;
  removeCoordinate: (idx: number) => void;
  removeBoundaryPoint: (boundaryId: string, idx: number) => void;
  removePiezoPoint: (idx: number) => void;
  insertCoordinateAt: (idx: number, pt: [number, number]) => void;
  insertBoundaryPointAt: (
    boundaryId: string,
    idx: number,
    pt: [number, number],
  ) => void;
  insertPiezoPointAt: (idx: number, pt: [number, number]) => void;
  setSelectedPoint: (idx: number | null) => void;
  setSelectedMaterialBoundary: (boundaryId: string | null) => void;
  setMaterialPicker: (picker: MaterialPickerState | null) => void;
  customSearchPlanes: { id: string; points?: [number, number][] }[];
  removeCustomSearchPlane: (id: string) => void;
  removeCustomPlanePoint: (id: string, pointIndex: number) => void;
  insertCustomPlanePointAt: (
    id: string,
    pointIndex: number,
    point: [number, number],
  ) => void;
  setSelectedCustomPlane: (id: string | null) => void;
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
    findNearPointUnified,
    findNearEdgeUnified,
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
    customSearchPlanes,
    removeCustomSearchPlane,
    removeCustomPlanePoint,
    insertCustomPlanePointAt,
    setSelectedCustomPlane,
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
                label: "Delete Point",
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
                  label: "Add Point",
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
            label: anno?.type === "reference" && anno.shape === "circle" ? "Delete Reference Circle" : "Delete Reference Line",
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
                label: "Align Left",
                action: () => {
                  alignAnnotations("left");
                  setContextMenu(null);
                },
              },
              {
                label: "Align Right",
                action: () => {
                  alignAnnotations("right");
                  setContextMenu(null);
                },
              },
              {
                label: "Align Top",
                action: () => {
                  alignAnnotations("top");
                  setContextMenu(null);
                },
              },
              {
                label: "Align Bottom",
                action: () => {
                  alignAnnotations("bottom");
                  setContextMenu(null);
                },
              },
              {
                label: "Center Horizontally",
                action: () => {
                  alignAnnotations("center-h");
                  setContextMenu(null);
                },
              },
              {
                label: "Center Vertically",
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

      const pointHit = findNearPointUnified(wx, wy);
      if (pointHit) {
        const items: ContextMenuState["items"] = [];
        if (pointHit.kind === "external") {
          items.push({
            label: "Delete Point",
            danger: true,
            disabled: coordinates.length <= 3,
            action: () => {
              if (coordinates.length > 3) {
                removeCoordinate(pointHit.index);
                setSelectedPoint(null);
              }
              setContextMenu(null);
            },
          });
        } else if (pointHit.kind === "piezo") {
          setActivePiezoLine(pointHit.lineId);
          const piezoLine = piezometricLine.lines.find(
            (l) => l.id === pointHit.lineId,
          );
          const lineLen = piezoLine?.coordinates.length ?? 0;
          items.push({
            label: "Delete Point",
            danger: true,
            disabled: lineLen <= 2,
            action: () => {
              if (lineLen > 2) {
                removePiezoPoint(pointHit.index);
              }
              setContextMenu(null);
            },
          });
        } else if (pointHit.kind === "boundary") {
          setSelectedMaterialBoundary(pointHit.boundaryId);
          const b = materialBoundaries.find(
            (mb) => mb.id === pointHit.boundaryId,
          );
          items.push({
            label: "Delete Point",
            danger: true,
            // Open polyline: at least 2 points; closed: at least a triangle.
            disabled:
              !b ||
              b.coordinates.length <= (isClosedBoundary(b.coordinates) ? 4 : 2),
            action: () => {
              if (b && b.coordinates.length > 2) {
                removeBoundaryPoint(pointHit.boundaryId, pointHit.pointIndex);
              }
              setContextMenu(null);
            },
          });
        } else if (pointHit.kind === "customVertex") {
          setSelectedCustomPlane(pointHit.planeId);
          const plane = customSearchPlanes.find((p) => p.id === pointHit.planeId);
          const count = plane?.points?.length ?? 0;
          items.push({
            label: "Delete Point",
            danger: true,
            // A non-circular surface keeps at least two points.
            disabled: count <= 2,
            action: () => {
              if (count > 2) {
                removeCustomPlanePoint(pointHit.planeId, pointHit.pointIndex);
              }
              setContextMenu(null);
            },
          });
          items.push({
            label: "Delete Surface",
            danger: true,
            action: () => {
              removeCustomSearchPlane(pointHit.planeId);
              setContextMenu(null);
            },
          });
          if (addReferenceFromCustomPlane) {
            items.push({
              label: "Add as Reference Line",
              action: () => {
                addReferenceFromCustomPlane(pointHit.planeId);
                setContextMenu(null);
              },
            });
          }
        } else if (pointHit.kind === "customCircle") {
          setSelectedCustomPlane(pointHit.planeId);
          items.push({
            label: "Delete Circle",
            danger: true,
            action: () => {
              removeCustomSearchPlane(pointHit.planeId);
              setContextMenu(null);
            },
          });
          if (addReferenceFromCustomPlane) {
            items.push({
              label: "Add as Reference Line",
              action: () => {
                addReferenceFromCustomPlane(pointHit.planeId);
                setContextMenu(null);
              },
            });
          }
        }
        setContextMenu({ screenX, screenY, items });
        return;
      }

      const edgeHit = findNearEdgeUnified(wx, wy);
      if (edgeHit) {
        const items: ContextMenuState["items"] = [];
        if (edgeHit.kind === "external") {
          items.push({
            label: "Add Point",
            action: () => {
              insertCoordinateAt(edgeHit.insertIndex, edgeHit.snapPoint);
              setSelectedPoint(edgeHit.insertIndex);
              setContextMenu(null);
            },
          });
        } else if (edgeHit.kind === "piezo") {
          setActivePiezoLine(edgeHit.lineId);
          items.push({
            label: "Add Point",
            action: () => {
              insertPiezoPointAt(edgeHit.insertIndex, edgeHit.snapPoint);
              setContextMenu(null);
            },
          });
        } else if (edgeHit.kind === "customPlane") {
          setSelectedCustomPlane(edgeHit.planeId);
          items.push({
            label: "Add Point",
            action: () => {
              insertCustomPlanePointAt(
                edgeHit.planeId,
                edgeHit.insertIndex,
                edgeHit.snapPoint,
              );
              setContextMenu(null);
            },
          });
          if (addReferenceFromCustomPlane) {
            items.push({
              label: "Add as Reference Line",
              action: () => {
                addReferenceFromCustomPlane(edgeHit.planeId);
                setContextMenu(null);
              },
            });
          }
        } else if (edgeHit.kind === "boundary") {
          setSelectedMaterialBoundary(edgeHit.boundaryId);
          items.push({
            label: "Add Point",
            action: () => {
              insertBoundaryPointAt(
                edgeHit.boundaryId,
                edgeHit.insertIndex,
                edgeHit.snapPoint,
              );
              setContextMenu(null);
            },
          });
        }
        setContextMenu({ screenX, screenY, items });
        return;
      }

      setContextMenu(null);
    },
    [
      addReferenceFromCustomPlane,
      alignAnnotations,
      canvasRef,
      coordinates,
      customSearchPlanes,
      findNearEdgeUnified,
      findNearPointUnified,
      getEventWorldPos,
      insertBoundaryPointAt,
      insertCoordinateAt,
      insertCustomPlanePointAt,
      insertPiezoPointAt,
      materialBoundaries,
      mode,
      piezometricLine.lines,
      removeBoundaryPoint,
      removeCoordinate,
      removeCustomPlanePoint,
      removeCustomSearchPlane,
      removePiezoPoint,
      selectedAnnotationIds,
      setSelectedAnnotations,
      setActivePiezoLine,
      setMaterialPicker,
      setSelectedCustomPlane,
      setSelectedMaterialBoundary,
      setSelectedPoint,
      snapValue,
    ],
  );

  return {
    contextMenu,
    setContextMenu,
    handleContextMenu,
  };
}
