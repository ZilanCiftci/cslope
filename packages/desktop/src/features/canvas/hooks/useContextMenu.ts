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

interface ContextMenuParams {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  mode: AppMode;
  selectedAnnotationIds: string[];
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
}

export function useContextMenu(params: ContextMenuParams) {
  const {
    canvasRef,
    mode,
    selectedAnnotationIds,
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
  } = params;

  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [annoStyleMenu, setAnnoStyleMenu] = useState<{
    screenX: number;
    screenY: number;
    annoId: string;
  } | null>(null);

  const handleContextMenu = useCallback(
    (e: RMouseEvent<HTMLCanvasElement>) => {
      e.preventDefault();
      setAnnoStyleMenu(null);

      if (mode === "result") {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext("2d");
        const canvasRect = canvas.getBoundingClientRect();
        const cxPx = e.clientX - canvasRect.left;
        const cyPx = e.clientY - canvasRect.top;

        // Use true window coordinates for the floating dialog
        const windowX = e.clientX;
        const windowY = e.clientY;
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
        let hitAnno: string | null = null;
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
                    parameters: state.parameters,
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
            setAnnoStyleMenu({
              screenX: windowX,
              screenY: windowY,
              annoId: hitAnno,
            });
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
            disabled: !b || b.coordinates.length <= 2,
            action: () => {
              if (b && b.coordinates.length > 2) {
                removeBoundaryPoint(pointHit.boundaryId, pointHit.pointIndex);
              }
              setContextMenu(null);
            },
          });
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
        } else {
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
      alignAnnotations,
      canvasRef,
      coordinates,
      findNearEdgeUnified,
      findNearPointUnified,
      getEventWorldPos,
      insertBoundaryPointAt,
      insertCoordinateAt,
      insertPiezoPointAt,
      materialBoundaries,
      mode,
      piezometricLine.lines,
      removeBoundaryPoint,
      removeCoordinate,
      removePiezoPoint,
      selectedAnnotationIds,
      setActivePiezoLine,
      setMaterialPicker,
      setSelectedMaterialBoundary,
      setSelectedPoint,
    ],
  );

  return {
    contextMenu,
    annoStyleMenu,
    setContextMenu,
    setAnnoStyleMenu,
    handleContextMenu,
  };
}
