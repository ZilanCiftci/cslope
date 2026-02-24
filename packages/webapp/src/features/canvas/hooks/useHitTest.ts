import { useCallback, type RefObject } from "react";
import { isPointInPolygon } from "@cslope/engine";
import { computeRegions } from "../../../utils/regions";
import type { AppState } from "../../../store/types";
import { EDGE_THRESHOLD, SNAP_THRESHOLD } from "../constants";
import type { EdgeHit, LimitHandle, PointHit, UdlHandle } from "../types";

function pointToSegmentDist(
  mx: number,
  my: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): { dist: number; projX: number; projY: number } {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  let t = lenSq === 0 ? 0 : ((mx - ax) * dx + (my - ay) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const projX = ax + t * dx;
  const projY = ay + t * dy;
  return { dist: Math.hypot(mx - projX, my - projY), projX, projY };
}

interface UseHitTestParams {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  worldToCanvas: (
    wx: number,
    wy: number,
    w: number,
    h: number,
  ) => [number, number];
  canvasToWorld: (
    cx: number,
    cy: number,
    w: number,
    h: number,
  ) => [number, number];
  coordinates: AppState["coordinates"];
  materials: AppState["materials"];
  materialBoundaries: AppState["materialBoundaries"];
  regionMaterials: AppState["regionMaterials"];
  piezometricLine: AppState["piezometricLine"];
  activePiezoCoords: [number, number][];
  analysisLimits: AppState["analysisLimits"];
  udls: AppState["udls"];
  lineLoads: AppState["lineLoads"];
  surfaceYAtX: (x: number) => number | null;
  snapValue: (v: number) => number;
  viewScale: number;
  snapToGrid: boolean;
  gridSnapSize: number;
  editingExterior: boolean;
  editingBoundaries: boolean;
  editingPiezo: boolean;
  editingLimits: boolean;
  editingLoads: boolean;
}

export function useHitTest({
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
}: UseHitTestParams) {
  /** Unified point hit-test — checks external boundary AND all material boundaries. */
  const findNearPointUnified = useCallback(
    (wx: number, wy: number): PointHit | null => {
      const canvas = canvasRef.current!;
      const rect = canvas.getBoundingClientRect();
      const [mx, my] = worldToCanvas(wx, wy, rect.width, rect.height);

      // External boundary points (only when editing exterior)
      if (editingExterior) {
        for (let i = 0; i < coordinates.length; i++) {
          const [px, py] = worldToCanvas(
            coordinates[i][0],
            coordinates[i][1],
            rect.width,
            rect.height,
          );
          if (Math.hypot(px - mx, py - my) < SNAP_THRESHOLD) {
            return { kind: "external", index: i };
          }
        }
      }

      // Material boundary points (only when editing boundaries)
      if (editingBoundaries) {
        for (const b of materialBoundaries) {
          for (let i = 0; i < b.coordinates.length; i++) {
            const [px, py] = worldToCanvas(
              b.coordinates[i][0],
              b.coordinates[i][1],
              rect.width,
              rect.height,
            );
            if (Math.hypot(px - mx, py - my) < SNAP_THRESHOLD) {
              return { kind: "boundary", boundaryId: b.id, pointIndex: i };
            }
          }
        }
      }

      // Piezometric line points (only when editing piezo)
      if (editingPiezo && piezometricLine.lines.length > 0) {
        for (let i = 0; i < activePiezoCoords.length; i++) {
          const [px, py] = worldToCanvas(
            activePiezoCoords[i][0],
            activePiezoCoords[i][1],
            rect.width,
            rect.height,
          );
          if (Math.hypot(px - mx, py - my) < SNAP_THRESHOLD) {
            return { kind: "piezo", index: i };
          }
        }
      }

      // Search limit arrows (only active when limits enabled AND Search Limits panel is open)
      if (analysisLimits.enabled && coordinates.length >= 3 && editingLimits) {
        const handles: LimitHandle[] = [
          "entryLeftX",
          "entryRightX",
          "exitLeftX",
          "exitRightX",
        ];
        for (const handle of handles) {
          const limitX = analysisLimits[handle];
          const limitY = surfaceYAtX(limitX);
          if (limitY === null) continue;
          const [px, py] = worldToCanvas(
            limitX,
            limitY,
            rect.width,
            rect.height,
          );
          if (Math.hypot(px - mx, py - my) < SNAP_THRESHOLD + 4) {
            return { kind: "limit", handle };
          }
        }
      }

      // UDL load arrows (only active when loads enabled and Load panel is open)
      // Hit-test the full vertical arrow shaft, not just the tip
      if (udls.length > 0 && coordinates.length >= 3 && editingLoads) {
        const UDL_ARROW_H = 38; // must match ARROW_HEIGHT_PX in draw code
        for (const u of udls) {
          const udlHandles: UdlHandle[] = ["x1", "x2"];
          for (const handle of udlHandles) {
            const ux = u[handle];
            const uy = surfaceYAtX(ux);
            if (uy === null) continue;
            const [px, py] = worldToCanvas(ux, uy, rect.width, rect.height);
            const topPy = py - UDL_ARROW_H;
            if (
              Math.abs(px - mx) < SNAP_THRESHOLD + 4 &&
              my >= topPy - 4 &&
              my <= py + 4
            ) {
              return { kind: "udl", udlId: u.id, handle };
            }
          }
        }
      }

      // Line load arrows (only active when loads enabled and Load panel is open)
      if (lineLoads.length > 0 && coordinates.length >= 3 && editingLoads) {
        const LL_ARROW_H = 38; // must match ARROW_HEIGHT_PX in draw code
        for (const ll of lineLoads) {
          const ly = surfaceYAtX(ll.x);
          if (ly === null) continue;
          const [px, py] = worldToCanvas(ll.x, ly, rect.width, rect.height);
          const topPy = py - LL_ARROW_H;
          if (
            Math.abs(px - mx) < SNAP_THRESHOLD + 4 &&
            my >= topPy - 4 &&
            my <= py + 4
          ) {
            return { kind: "lineLoad", loadId: ll.id };
          }
        }
      }

      return null;
    },
    [
      coordinates,
      materialBoundaries,
      piezometricLine,
      activePiezoCoords,
      analysisLimits,
      udls,
      lineLoads,
      surfaceYAtX,
      worldToCanvas,
      editingExterior,
      editingBoundaries,
      editingPiezo,
      editingLimits,
      editingLoads,
      canvasRef,
    ],
  );

  /** Unified edge hit-test — finds nearest edge across all polylines. */
  const findNearEdgeUnified = useCallback(
    (wx: number, wy: number): EdgeHit | null => {
      const canvas = canvasRef.current!;
      const rect = canvas.getBoundingClientRect();
      const [mx, my] = worldToCanvas(wx, wy, rect.width, rect.height);

      let bestHit: EdgeHit | null = null;
      let bestDist = EDGE_THRESHOLD;

      // External boundary edges (only when editing exterior)
      if (editingExterior) {
        for (let i = 0; i < coordinates.length; i++) {
          const ni = (i + 1) % coordinates.length;
          const [ax, ay] = worldToCanvas(
            coordinates[i][0],
            coordinates[i][1],
            rect.width,
            rect.height,
          );
          const [bx, by] = worldToCanvas(
            coordinates[ni][0],
            coordinates[ni][1],
            rect.width,
            rect.height,
          );
          const { dist, projX, projY } = pointToSegmentDist(
            mx,
            my,
            ax,
            ay,
            bx,
            by,
          );
          if (dist < bestDist) {
            bestDist = dist;
            const [swx, swy] = canvasToWorld(
              projX,
              projY,
              rect.width,
              rect.height,
            );
            const insertIdx = ni === 0 ? coordinates.length : ni;
            bestHit = {
              kind: "external",
              insertIndex: insertIdx,
              snapPoint: [snapValue(swx), snapValue(swy)],
            };
          }
        }
      }

      // Material boundary edges (only when editing boundaries)
      if (editingBoundaries) {
        for (const b of materialBoundaries) {
          for (let i = 0; i < b.coordinates.length - 1; i++) {
            const [ax, ay] = worldToCanvas(
              b.coordinates[i][0],
              b.coordinates[i][1],
              rect.width,
              rect.height,
            );
            const [bx, by] = worldToCanvas(
              b.coordinates[i + 1][0],
              b.coordinates[i + 1][1],
              rect.width,
              rect.height,
            );
            const { dist, projX, projY } = pointToSegmentDist(
              mx,
              my,
              ax,
              ay,
              bx,
              by,
            );
            if (dist < bestDist) {
              bestDist = dist;
              const [swx, swy] = canvasToWorld(
                projX,
                projY,
                rect.width,
                rect.height,
              );
              bestHit = {
                kind: "boundary",
                boundaryId: b.id,
                insertIndex: i + 1,
                snapPoint: [snapValue(swx), snapValue(swy)],
              };
            }
          }
        }
      }

      // Piezometric line edges (only when editing piezo)
      if (editingPiezo && piezometricLine.lines.length > 0) {
        for (let i = 0; i < activePiezoCoords.length - 1; i++) {
          const [ax, ay] = worldToCanvas(
            activePiezoCoords[i][0],
            activePiezoCoords[i][1],
            rect.width,
            rect.height,
          );
          const [bx, by] = worldToCanvas(
            activePiezoCoords[i + 1][0],
            activePiezoCoords[i + 1][1],
            rect.width,
            rect.height,
          );
          const { dist, projX, projY } = pointToSegmentDist(
            mx,
            my,
            ax,
            ay,
            bx,
            by,
          );
          if (dist < bestDist) {
            bestDist = dist;
            const [swx, swy] = canvasToWorld(
              projX,
              projY,
              rect.width,
              rect.height,
            );
            bestHit = {
              kind: "piezo",
              insertIndex: i + 1,
              snapPoint: [snapValue(swx), snapValue(swy)],
            };
          }
        }
      }

      return bestHit;
    },
    [
      coordinates,
      materialBoundaries,
      piezometricLine,
      activePiezoCoords,
      worldToCanvas,
      canvasToWorld,
      snapValue,
      editingExterior,
      editingBoundaries,
      editingPiezo,
      canvasRef,
    ],
  );

  /** Find which material region contains a world point. */
  const findRegionAtPoint = useCallback(
    (wx: number, wy: number): { regionKey: string } | null => {
      if (coordinates.length < 3) return null;
      const defaultMatId = materials[0]?.id ?? "";
      const regions = computeRegions(
        coordinates,
        materialBoundaries,
        regionMaterials,
        defaultMatId,
      );
      // Iterate backward: regions are sorted largest-first, so smaller
      // (inner) regions at the end take precedence for hit testing.
      for (let i = regions.length - 1; i >= 0; i--) {
        const r = regions[i];
        if (isPointInPolygon(wx, wy, r.px, r.py)) {
          return { regionKey: r.regionKey };
        }
      }
      return null;
    },
    [coordinates, materialBoundaries, regionMaterials, materials],
  );

  /** When dragging, snap to nearby points from OTHER polylines. */
  const findSnapTarget = useCallback(
    (wx: number, wy: number, excludeHit: PointHit): [number, number] | null => {
      // Use the larger of pixel-based threshold and grid size so that
      // boundary snap beats grid snap even at coarse grid settings.
      const pixelRadius = SNAP_THRESHOLD / viewScale;
      const worldSnapRadius = snapToGrid
        ? Math.max(pixelRadius, gridSnapSize)
        : pixelRadius;

      let bestDist = worldSnapRadius;
      let bestSnap: [number, number] | null = null;

      // Check external boundary points
      for (let i = 0; i < coordinates.length; i++) {
        if (excludeHit.kind === "external" && excludeHit.index === i) continue;
        const d = Math.hypot(coordinates[i][0] - wx, coordinates[i][1] - wy);
        if (d < bestDist) {
          bestDist = d;
          bestSnap = [coordinates[i][0], coordinates[i][1]];
        }
      }

      // Check material boundary points
      for (const b of materialBoundaries) {
        for (let j = 0; j < b.coordinates.length; j++) {
          if (
            excludeHit.kind === "boundary" &&
            excludeHit.boundaryId === b.id &&
            excludeHit.pointIndex === j
          )
            continue;
          const d = Math.hypot(
            b.coordinates[j][0] - wx,
            b.coordinates[j][1] - wy,
          );
          if (d < bestDist) {
            bestDist = d;
            bestSnap = [b.coordinates[j][0], b.coordinates[j][1]];
          }
        }
      }

      // Check piezometric line points
      if (piezometricLine.lines.length > 0) {
        for (const line of piezometricLine.lines) {
          for (let i = 0; i < line.coordinates.length; i++) {
            if (
              line.id === piezometricLine.activeLineId &&
              excludeHit.kind === "piezo" &&
              excludeHit.index === i
            )
              continue;
            const d = Math.hypot(
              line.coordinates[i][0] - wx,
              line.coordinates[i][1] - wy,
            );
            if (d < bestDist) {
              bestDist = d;
              bestSnap = [line.coordinates[i][0], line.coordinates[i][1]];
            }
          }
        }
      }

      return bestSnap;
    },
    [
      coordinates,
      materialBoundaries,
      piezometricLine,
      viewScale,
      snapToGrid,
      gridSnapSize,
    ],
  );

  return {
    findNearPointUnified,
    findNearEdgeUnified,
    findRegionAtPoint,
    findSnapTarget,
  };
}
