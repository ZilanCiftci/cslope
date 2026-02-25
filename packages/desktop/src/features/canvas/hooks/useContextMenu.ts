import {
  useCallback,
  useState,
  type RefObject,
  type MouseEvent as RMouseEvent,
} from "react";
import { computePaperFrame } from "../helpers";
import { useAppStore } from "../../../store/app-store";
import type { AppMode } from "../../../store/types";
import type {
  ContextMenuState,
  EdgeHit,
  MaterialPickerState,
  PointHit,
} from "../types";

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
  activePiezoCoords: [number, number][];
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
    activePiezoCoords,
    removeCoordinate,
    removeBoundaryPoint,
    removePiezoPoint,
    insertCoordinateAt,
    insertBoundaryPointAt,
    insertPiezoPointAt,
    setSelectedPoint,
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
        const canvasRect = canvas.getBoundingClientRect();
        const cxPx = e.clientX - canvasRect.left;
        const cyPx = e.clientY - canvasRect.top;
        const pf = computePaperFrame(
          canvasRect.width,
          canvasRect.height,
          useAppStore.getState().resultViewSettings.paperFrame.paperSize,
        );
        const fx = (cxPx - pf.x) / pf.w;
        const fy = (cyPx - pf.y) / pf.h;

        const annos = useAppStore.getState().resultViewSettings.annotations;
        let hitAnno: string | null = null;
        for (let i = annos.length - 1; i >= 0; i--) {
          const a = annos[i];
          const dx = (fx - a.x) * pf.w;
          const dy = (fy - a.y) * pf.h;
          if (Math.hypot(dx, dy) < 15) {
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
            setAnnoStyleMenu({ screenX: cxPx, screenY: cyPx, annoId: hitAnno });
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
          items.push({
            label: "Delete Point",
            danger: true,
            disabled: activePiezoCoords.length <= 2,
            action: () => {
              if (activePiezoCoords.length > 2) {
                removePiezoPoint(pointHit.index);
              }
              setContextMenu(null);
            },
          });
        } else if (pointHit.kind === "boundary") {
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
          items.push({
            label: "Add Point",
            action: () => {
              insertPiezoPointAt(edgeHit.insertIndex, edgeHit.snapPoint);
              setContextMenu(null);
            },
          });
        } else {
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
      activePiezoCoords,
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
      removeBoundaryPoint,
      removeCoordinate,
      removePiezoPoint,
      selectedAnnotationIds,
      setMaterialPicker,
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
