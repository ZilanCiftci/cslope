import { PLOT_MARGINS } from "../../store/app-store";
import type { AppState } from "../../store/types";
import { circleArcPoints } from "../../utils/arc";
import { fosColor } from "../../utils/fos-color";
import { computeRegions } from "../../utils/regions";
import {
  ARROW_HEAD_LEN_PX,
  ARROW_HEAD_PX,
  ARROW_HEIGHT_PX,
  GRID_STEP_MIN,
  HATCH_SPACING_PX,
  LL_COLOR,
  POINT_COLOR,
  POINT_COLOR_HOVER,
  POINT_COLOR_SELECTED,
  POINT_RADIUS,
  UDL_COLOR,
  cssVar,
} from "./constants";
import { GRID_RAW_STEP_PX } from "../../constants";
import { computePaperFrame, drawParamBlock, drawTable } from "./helpers";
import type { PointHit } from "./types";

const arcPointCache = new WeakMap<object, Map<string, [number, number][]>>();

type ArcSurface = {
  cx: number;
  cy: number;
  radius: number;
  entryPoint: [number, number];
  exitPoint: [number, number];
};

function getArcCache(result: AppState["result"]) {
  if (!result || typeof result !== "object") return null;
  const key = result as object;
  const existing = arcPointCache.get(key);
  if (existing) return existing;
  const created = new Map<string, [number, number][]>();
  arcPointCache.set(key, created);
  return created;
}

function getArcKey(surf: ArcSurface): string {
  return [
    surf.cx,
    surf.cy,
    surf.radius,
    surf.entryPoint[0],
    surf.entryPoint[1],
    surf.exitPoint[0],
    surf.exitPoint[1],
  ].join("|");
}

export interface DrawCanvasParams {
  w: number;
  h: number;
  mode: AppState["mode"];
  result: AppState["result"];
  resultViewSettings: AppState["resultViewSettings"];
  orientation: AppState["orientation"];
  coordinates: AppState["coordinates"];
  materials: AppState["materials"];
  materialBoundaries: AppState["materialBoundaries"];
  regionMaterials: AppState["regionMaterials"];
  selectedRegionKey: AppState["selectedRegionKey"];
  editingAssignment: boolean;
  selectedAnnotationIds: AppState["selectedAnnotationIds"];
  projectInfo: AppState["projectInfo"];
  analysisLimits: AppState["analysisLimits"];
  udls: AppState["udls"];
  lineLoads: AppState["lineLoads"];
  piezometricLine: AppState["piezometricLine"];
  viewScale: number;
  mouseWorld: [number, number] | null;
  hoverHit: PointHit | null;
  selectedPointIndex: number | null;
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
  surfaceYAtX: (x: number) => number | null;
  editingExterior: boolean;
  editingBoundaries: boolean;
  editingPiezo: boolean;
}

export function drawCanvas(
  ctx: CanvasRenderingContext2D,
  {
    w,
    h,
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
    mouseWorld,
    hoverHit,
    selectedPointIndex,
    worldToCanvas,
    canvasToWorld,
    surfaceYAtX,
    editingExterior,
    editingBoundaries,
    editingPiezo,
  }: DrawCanvasParams,
) {
  // Read theme-aware colors
  const BG_COLOR = cssVar("--color-canvas-bg");
  const GRID_COLOR = cssVar("--color-canvas-grid");
  const GRID_TEXT_COLOR = cssVar("--color-canvas-grid-text");
  const AXIS_COLOR = cssVar("--color-canvas-axis");
  const POLY_STROKE = cssVar("--color-canvas-poly-stroke");
  const STROKE_ACTIVE = cssVar("--color-canvas-stroke-active");
  const STROKE_INACTIVE = cssVar("--color-canvas-stroke-inactive");
  const LABEL_COLOR = cssVar("--color-canvas-label");
  const REGION_SELECT = cssVar("--color-canvas-region-select");
  const CROSSHAIR_COLOR = cssVar("--color-canvas-crosshair");

  // Background
  ctx.fillStyle = BG_COLOR;
  ctx.fillRect(0, 0, w, h);

  // ── Paper background (result mode) — drawn before grid so geometry appears on top ──
  if (mode === "result" && result) {
    const { paperFrame: pf0Frame } = resultViewSettings;
    if (pf0Frame.showFrame) {
      const pf0 = computePaperFrame(w, h, pf0Frame.paperSize);
      // Gray background outside paper
      ctx.save();
      ctx.fillStyle = "#d0d0d0";
      ctx.beginPath();
      ctx.rect(0, 0, w, h);
      ctx.rect(pf0.x, pf0.y, pf0.w, pf0.h);
      ctx.fill("evenodd");
      ctx.restore();

      // Paper shadow
      ctx.save();
      ctx.shadowColor = "rgba(0,0,0,0.35)";
      ctx.shadowBlur = 12;
      ctx.shadowOffsetX = 4;
      ctx.shadowOffsetY = 4;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(pf0.x, pf0.y, pf0.w, pf0.h);
      ctx.restore();

      // Clip geometry to an inset plot area (leaves room for ticks+labels)
      // Use standardized percentage margins (same as pdf-export and view-lock logic)
      const PLOT_PAD_L = pf0.w * PLOT_MARGINS.L;
      const PLOT_PAD_B = pf0.h * PLOT_MARGINS.B;
      const PLOT_PAD_T = pf0.h * PLOT_MARGINS.T;
      const PLOT_PAD_R = pf0.w * PLOT_MARGINS.R;

      ctx.save();
      ctx.beginPath();
      ctx.rect(
        pf0.x + PLOT_PAD_L,
        pf0.y + PLOT_PAD_T,
        pf0.w - PLOT_PAD_L - PLOT_PAD_R,
        pf0.h - PLOT_PAD_T - PLOT_PAD_B,
      );
      ctx.clip();
    }
  }

  // ── Grid ───────────────────────────────────────────────
  const showGrid = mode !== "result" || !result || resultViewSettings.showGrid;
  const rawStep = GRID_RAW_STEP_PX / viewScale;
  const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const steps = [1, 2, 5, 10];
  const gridStep = Math.max(
    GRID_STEP_MIN,
    steps.find((s) => s * mag >= rawStep)! * mag,
  );

  const [tlx, tly] = canvasToWorld(0, 0, w, h);
  const [brx, bry] = canvasToWorld(w, h, w, h);
  const worldLeft = Math.min(tlx, brx);
  const worldRight = Math.max(tlx, brx);
  const worldBottom = Math.min(tly, bry);
  const worldTop = Math.max(tly, bry);

  ctx.strokeStyle = GRID_COLOR;
  ctx.lineWidth = 1;
  ctx.font = "10px 'Segoe UI', sans-serif";
  ctx.fillStyle = GRID_TEXT_COLOR;
  ctx.textAlign = "center";

  if (showGrid) {
    // Vertical grid lines
    const startX = Math.floor(worldLeft / gridStep) * gridStep;
    for (let gx = startX; gx <= worldRight; gx += gridStep) {
      const [px] = worldToCanvas(gx, 0, w, h);
      ctx.beginPath();
      ctx.moveTo(px, 0);
      ctx.lineTo(px, h);
      ctx.stroke();
    }

    // Horizontal grid lines
    const startY = Math.floor(worldBottom / gridStep) * gridStep;
    for (let gy = startY; gy <= worldTop; gy += gridStep) {
      const [, py] = worldToCanvas(0, gy, w, h);
      ctx.beginPath();
      ctx.moveTo(0, py);
      ctx.lineTo(w, py);
      ctx.stroke();
    }
  }

  // Axes (origin lines)
  if (showGrid) {
    ctx.strokeStyle = AXIS_COLOR;
    ctx.lineWidth = 1;
    const [ax0] = worldToCanvas(0, 0, w, h);
    const [, ay0] = worldToCanvas(0, 0, w, h);
    ctx.beginPath();
    ctx.moveTo(ax0, 0);
    ctx.lineTo(ax0, h);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, ay0);
    ctx.lineTo(w, ay0);
    ctx.stroke();
  }

  // ── Material region fills ─────────────────────────────
  if (coordinates.length >= 3) {
    const defaultMatId = materials[0]?.id ?? "";
    const regions = computeRegions(
      coordinates,
      materialBoundaries,
      regionMaterials,
      defaultMatId,
    );
    for (const region of regions) {
      const mat = materials.find((m) => m.id === region.materialId);
      if (!mat || region.px.length < 3) continue;

      ctx.beginPath();
      // Outer boundary
      const [sx, sy] = worldToCanvas(region.px[0], region.py[0], w, h);
      ctx.moveTo(sx, sy);
      for (let i = 1; i < region.px.length; i++) {
        const [rpx, rpy] = worldToCanvas(region.px[i], region.py[i], w, h);
        ctx.lineTo(rpx, rpy);
      }
      ctx.closePath();

      // Inner holes (for donut regions created by closed boundaries)
      if (region.holes) {
        for (const hole of region.holes) {
          if (hole.px.length < 3) continue;
          const [hx0, hy0] = worldToCanvas(hole.px[0], hole.py[0], w, h);
          ctx.moveTo(hx0, hy0);
          for (let i = 1; i < hole.px.length; i++) {
            const [hx, hy] = worldToCanvas(hole.px[i], hole.py[i], w, h);
            ctx.lineTo(hx, hy);
          }
          ctx.closePath();
        }
      }

      ctx.fillStyle = mat.color + "55";
      ctx.fill(region.holes ? "evenodd" : "nonzero");
    }

    // ── Highlight selected region (only when Material Assignment is open) ──
    if (selectedRegionKey && editingAssignment) {
      const sel = regions.find((r) => r.regionKey === selectedRegionKey);
      if (sel && sel.px.length >= 3) {
        // Helper to build the combined outer+holes path
        const buildSelPath = () => {
          ctx.beginPath();
          const [sx0, sy0] = worldToCanvas(sel.px[0], sel.py[0], w, h);
          ctx.moveTo(sx0, sy0);
          for (let i = 1; i < sel.px.length; i++) {
            const [rpx, rpy] = worldToCanvas(sel.px[i], sel.py[i], w, h);
            ctx.lineTo(rpx, rpy);
          }
          ctx.closePath();
          if (sel.holes) {
            for (const hole of sel.holes) {
              if (hole.px.length < 3) continue;
              const [hx0, hy0] = worldToCanvas(hole.px[0], hole.py[0], w, h);
              ctx.moveTo(hx0, hy0);
              for (let i = 1; i < hole.px.length; i++) {
                const [hx, hy] = worldToCanvas(hole.px[i], hole.py[i], w, h);
                ctx.lineTo(hx, hy);
              }
              ctx.closePath();
            }
          }
        };

        ctx.save();

        // Clip to region shape so border only appears within it
        buildSelPath();
        ctx.clip("evenodd");

        // Solid accent border (width doubled since half is clipped)
        ctx.strokeStyle = REGION_SELECT;
        ctx.lineWidth = 6;
        buildSelPath();
        ctx.stroke();

        ctx.restore();
      }
    }
  }

  // ── External boundary stroke ─────────────────────────
  if (coordinates.length >= 3) {
    ctx.beginPath();
    const [sx, sy] = worldToCanvas(coordinates[0][0], coordinates[0][1], w, h);
    ctx.moveTo(sx, sy);
    for (let i = 1; i < coordinates.length; i++) {
      const [px, py] = worldToCanvas(
        coordinates[i][0],
        coordinates[i][1],
        w,
        h,
      );
      ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.strokeStyle = POLY_STROKE;
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  // ── Material boundary lines ─────────────────────────────
  if (materialBoundaries.length > 0 && coordinates.length >= 3) {
    for (const b of materialBoundaries) {
      if (b.coordinates.length < 2) continue;
      // Draw polyline
      ctx.strokeStyle = POLY_STROKE;
      ctx.lineWidth = 2;
      ctx.beginPath();
      const [sx, sy] = worldToCanvas(
        b.coordinates[0][0],
        b.coordinates[0][1],
        w,
        h,
      );
      ctx.moveTo(sx, sy);
      for (let i = 1; i < b.coordinates.length; i++) {
        const [px, py] = worldToCanvas(
          b.coordinates[i][0],
          b.coordinates[i][1],
          w,
          h,
        );
        ctx.lineTo(px, py);
      }
      ctx.stroke();
    }
  }

  // ── Entry / Exit range markers ──────────────────────────
  if (analysisLimits.enabled && coordinates.length >= 3) {
    // Helper: draw an arrow marker on the surface.
    //   dir = "right" means >|   dir = "left" means |<
    const drawArrow = (
      worldX: number,
      worldY: number,
      dir: "left" | "right",
      handle: "entryLeftX" | "entryRightX" | "exitLeftX" | "exitRightX",
    ) => {
      const [cx, cy] = worldToCanvas(worldX, worldY, w, h);
      const isHover = hoverHit?.kind === "limit" && hoverHit.handle === handle;
      const sz = 7; // half-size of arrowhead
      const barH = 10; // half-height of the bar |

      const color = isHover ? "#cc0000" : "#000000";
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.lineWidth = isHover ? 2.5 : 2;

      // Vertical bar |
      ctx.beginPath();
      ctx.moveTo(cx, cy - barH);
      ctx.lineTo(cx, cy + barH);
      ctx.stroke();

      // Triangle arrowhead pointing inward
      const tipX = dir === "right" ? cx - sz * 2 : cx + sz * 2;
      ctx.beginPath();
      ctx.moveTo(cx, cy); // tip at the bar
      ctx.lineTo(tipX, cy - sz);
      ctx.lineTo(tipX, cy + sz);
      ctx.closePath();
      ctx.fill();
    };

    // Helper: draw dotted markers along the surface between two Xs
    const drawDottedRange = (surfPts: [number, number][]) => {
      if (surfPts.length < 2) return;
      const canvasPts = surfPts.map(([sx, sy]) => worldToCanvas(sx, sy, w, h));
      const spacing = 12;
      const radius = 3.5;

      ctx.fillStyle = "#cc0000";

      // Always place dots at endpoints
      const placeDot = (x: number, y: number) => {
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fill();
      };

      placeDot(canvasPts[0][0], canvasPts[0][1]);

      let carry = 0; // leftover distance from prior segment
      for (let i = 0; i < canvasPts.length - 1; i++) {
        const [x1, y1] = canvasPts[i];
        const [x2, y2] = canvasPts[i + 1];
        const dx = x2 - x1;
        const dy = y2 - y1;
        const segLen = Math.hypot(dx, dy);
        if (segLen === 0) continue;

        let t = spacing - carry;
        while (t <= segLen) {
          const frac = t / segLen;
          const cx = x1 + dx * frac;
          const cy = y1 + dy * frac;
          placeDot(cx, cy);
          t += spacing;
        }
        carry = (carry + segLen) % spacing;
      }

      placeDot(
        canvasPts[canvasPts.length - 1][0],
        canvasPts[canvasPts.length - 1][1],
      );
    };

    const leftHandleDir: "left" | "right" =
      orientation === "rtl" ? "left" : "right";
    const rightHandleDir: "left" | "right" =
      orientation === "rtl" ? "right" : "left";

    // Entry range markers
    const entryLeftY = surfaceYAtX(analysisLimits.entryLeftX);
    const entryRightY = surfaceYAtX(analysisLimits.entryRightX);

    if (entryLeftY !== null) {
      drawArrow(
        analysisLimits.entryLeftX,
        entryLeftY,
        leftHandleDir,
        "entryLeftX",
      );
    }
    if (entryRightY !== null) {
      drawArrow(
        analysisLimits.entryRightX,
        entryRightY,
        rightHandleDir,
        "entryRightX",
      );
    }

    // Red dotted line between entry arrows along the surface
    if (entryLeftY !== null && entryRightY !== null) {
      // Walk along the surface segments between entryLeftX and entryRightX
      const leftX = Math.min(
        analysisLimits.entryLeftX,
        analysisLimits.entryRightX,
      );
      const rightX = Math.max(
        analysisLimits.entryLeftX,
        analysisLimits.entryRightX,
      );

      // Collect surface points in the range
      const surfPts: [number, number][] = [];
      surfPts.push([leftX, surfaceYAtX(leftX)!]);
      for (const [cx, cy] of coordinates) {
        if (cx > leftX && cx < rightX) {
          // Only include if it's on the top surface
          const topY = surfaceYAtX(cx);
          if (topY !== null && Math.abs(cy - topY) < 0.001) {
            surfPts.push([cx, cy]);
          }
        }
      }
      surfPts.push([rightX, surfaceYAtX(rightX)!]);
      surfPts.sort((a, b) => a[0] - b[0]);

      drawDottedRange(surfPts);
    }

    // Exit range markers
    const exitLeftY = surfaceYAtX(analysisLimits.exitLeftX);
    const exitRightY = surfaceYAtX(analysisLimits.exitRightX);

    if (exitLeftY !== null) {
      drawArrow(
        analysisLimits.exitLeftX,
        exitLeftY,
        leftHandleDir,
        "exitLeftX",
      );
    }
    if (exitRightY !== null) {
      drawArrow(
        analysisLimits.exitRightX,
        exitRightY,
        rightHandleDir,
        "exitRightX",
      );
    }

    // Red dotted line between exit arrows along the surface
    if (exitLeftY !== null && exitRightY !== null) {
      const leftX = Math.min(
        analysisLimits.exitLeftX,
        analysisLimits.exitRightX,
      );
      const rightX = Math.max(
        analysisLimits.exitLeftX,
        analysisLimits.exitRightX,
      );

      const surfPts: [number, number][] = [];
      surfPts.push([leftX, surfaceYAtX(leftX)!]);
      for (const [cx, cy] of coordinates) {
        if (cx > leftX && cx < rightX) {
          const topY = surfaceYAtX(cx);
          if (topY !== null && Math.abs(cy - topY) < 0.001) {
            surfPts.push([cx, cy]);
          }
        }
      }
      surfPts.push([rightX, surfaceYAtX(rightX)!]);
      surfPts.sort((a, b) => a[0] - b[0]);

      drawDottedRange(surfPts);
    }
  }

  // ── UDL loads ────────────────────────────────────────────
  if (udls.length > 0 && coordinates.length >= 3) {
    for (const u of udls) {
      const y1 = surfaceYAtX(u.x1);
      const y2 = surfaceYAtX(u.x2);
      if (y1 === null || y2 === null) continue;

      // Collect surface points between x1 and x2 (following the slope)
      const leftX = Math.min(u.x1, u.x2);
      const rightX = Math.max(u.x1, u.x2);
      const surfPts: [number, number][] = [];
      surfPts.push([leftX, surfaceYAtX(leftX)!]);
      for (const [cx, cy] of coordinates) {
        if (cx > leftX && cx < rightX) {
          const topY = surfaceYAtX(cx);
          if (topY !== null && Math.abs(cy - topY) < 0.001) {
            surfPts.push([cx, cy]);
          }
        }
      }
      surfPts.push([rightX, surfaceYAtX(rightX)!]);
      surfPts.sort((a, b) => a[0] - b[0]);

      // Convert surface points to canvas coords
      const surfCanvas = surfPts.map(([sx, sy]) => worldToCanvas(sx, sy, w, h));
      // Top edge: offset each surface point upward by ARROW_HEIGHT_PX
      const topCanvas = surfCanvas.map(
        ([sx, sy]) => [sx, sy - ARROW_HEIGHT_PX] as [number, number],
      );

      // ── Draw hatched area between the arrows ──
      ctx.save();
      // Build clip path: top edge (left→right) then surface edge (right→left)
      ctx.beginPath();
      for (let i = 0; i < topCanvas.length; i++) {
        const [px, py] = topCanvas[i];
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      for (let i = surfCanvas.length - 1; i >= 0; i--) {
        ctx.lineTo(surfCanvas[i][0], surfCanvas[i][1]);
      }
      ctx.closePath();
      ctx.clip();

      // Draw diagonal hatch lines (top-left to bottom-right pattern)
      ctx.strokeStyle = UDL_COLOR;
      ctx.lineWidth = 1;
      ctx.globalAlpha = 0.5;
      const allXs = surfCanvas.map(([x]) => x);
      const allYs = [
        ...surfCanvas.map(([, y]) => y),
        ...topCanvas.map(([, y]) => y),
      ];
      const minX = Math.min(...allXs);
      const maxX = Math.max(...allXs);
      const minY = Math.min(...allYs);
      const maxY = Math.max(...allYs);
      const span = maxX - minX + (maxY - minY);
      for (let d = -span; d < span; d += HATCH_SPACING_PX) {
        ctx.beginPath();
        ctx.moveTo(minX + d, minY);
        ctx.lineTo(minX + d + (maxY - minY), maxY);
        ctx.stroke();
      }
      ctx.globalAlpha = 1.0;
      ctx.restore();

      // ── Outline the hatched area ──
      ctx.strokeStyle = UDL_COLOR;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      // Top edge (left→right)
      for (let i = 0; i < topCanvas.length; i++) {
        const [px, py] = topCanvas[i];
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      // Right vertical down to surface
      const last = surfCanvas.length - 1;
      ctx.lineTo(surfCanvas[last][0], surfCanvas[last][1]);
      // Surface edge (right→left)
      for (let i = last - 1; i >= 0; i--) {
        ctx.lineTo(surfCanvas[i][0], surfCanvas[i][1]);
      }
      // Left vertical back up
      ctx.closePath();
      ctx.stroke();

      // ── Draw downward arrow at x1 ──
      const [cx1, cy1] = worldToCanvas(u.x1, y1, w, h);
      const topY1 = cy1 - ARROW_HEIGHT_PX;
      const hoverX1 =
        hoverHit?.kind === "udl" &&
        hoverHit.udlId === u.id &&
        hoverHit.handle === "x1";
      const arrowColor1 = hoverX1 ? "#ff0000" : UDL_COLOR;
      ctx.strokeStyle = arrowColor1;
      ctx.lineWidth = hoverX1 ? 3 : 2;
      ctx.beginPath();
      ctx.moveTo(cx1, topY1);
      ctx.lineTo(cx1, cy1);
      ctx.stroke();
      // Arrowhead
      ctx.fillStyle = arrowColor1;
      ctx.beginPath();
      ctx.moveTo(cx1, cy1); // tip
      ctx.lineTo(cx1 - ARROW_HEAD_PX, cy1 - ARROW_HEAD_LEN_PX);
      ctx.lineTo(cx1 + ARROW_HEAD_PX, cy1 - ARROW_HEAD_LEN_PX);
      ctx.closePath();
      ctx.fill();

      // ── Draw downward arrow at x2 ──
      const [cx2, cy2] = worldToCanvas(u.x2, y2, w, h);
      const topY2 = cy2 - ARROW_HEIGHT_PX;
      const hoverX2 =
        hoverHit?.kind === "udl" &&
        hoverHit.udlId === u.id &&
        hoverHit.handle === "x2";
      const arrowColor2 = hoverX2 ? "#ff0000" : UDL_COLOR;
      ctx.strokeStyle = arrowColor2;
      ctx.lineWidth = hoverX2 ? 3 : 2;
      ctx.beginPath();
      ctx.moveTo(cx2, topY2);
      ctx.lineTo(cx2, cy2);
      ctx.stroke();
      ctx.fillStyle = arrowColor2;
      ctx.beginPath();
      ctx.moveTo(cx2, cy2); // tip
      ctx.lineTo(cx2 - ARROW_HEAD_PX, cy2 - ARROW_HEAD_LEN_PX);
      ctx.lineTo(cx2 + ARROW_HEAD_PX, cy2 - ARROW_HEAD_LEN_PX);
      ctx.closePath();
      ctx.fill();

      // ── Label above ──
      const labelX = (cx1 + cx2) / 2;
      const labelY = Math.min(topY1, topY2) - 8;
      ctx.fillStyle = UDL_COLOR;
      ctx.font = "bold 13px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      ctx.fillText(`q = ${u.magnitude} kPa`, labelX, labelY);
    }
  }

  // ── Line loads ──────────────────────────────────────────
  if (lineLoads.length > 0 && coordinates.length >= 3) {
    for (const ll of lineLoads) {
      const sy = surfaceYAtX(ll.x);
      if (sy === null) continue;

      const [cx, cy] = worldToCanvas(ll.x, sy, w, h);
      const topY = cy - ARROW_HEIGHT_PX;

      const isHover =
        hoverHit?.kind === "lineLoad" && hoverHit.loadId === ll.id;
      const color = isHover ? "#3b82f6" : LL_COLOR;

      // Shaft
      ctx.strokeStyle = color;
      ctx.lineWidth = isHover ? 3 : 2;
      ctx.beginPath();
      ctx.moveTo(cx, topY);
      ctx.lineTo(cx, cy);
      ctx.stroke();

      // Arrowhead
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(cx, cy); // tip
      ctx.lineTo(cx - ARROW_HEAD_PX, cy - ARROW_HEAD_LEN_PX);
      ctx.lineTo(cx + ARROW_HEAD_PX, cy - ARROW_HEAD_LEN_PX);
      ctx.closePath();
      ctx.fill();

      // Label above
      ctx.fillStyle = color;
      ctx.font = "bold 13px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      ctx.fillText(`P = ${ll.magnitude} kN/m`, cx, topY - 4);
    }
  }

  // ── Piezometric lines ──────────────────────────────────
  if (piezometricLine.lines.length > 0) {
    const multiLine = piezometricLine.lines.length > 1;
    const piezoBlue = "#1a3a8a";
    for (let lineIdx = 0; lineIdx < piezometricLine.lines.length; lineIdx++) {
      const line = piezometricLine.lines[lineIdx];
      if (line.coordinates.length < 2) continue;
      const isActive = line.id === piezometricLine.activeLineId;
      const plCoords = line.coordinates;

      // Stroke: solid blue polyline
      ctx.strokeStyle = piezoBlue;
      ctx.lineWidth = isActive && editingPiezo ? 2 : 1.5;
      ctx.beginPath();
      for (let i = 0; i < plCoords.length; i++) {
        const [px, py] = worldToCanvas(plCoords[i][0], plCoords[i][1], w, h);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();

      // Symbol at the midpoint of each segment:
      // inverted triangle with bottom vertex on the line + two horizontal lines below
      const triHalf = 6; // half-width of triangle base
      const triH = 10; // triangle height
      const labelNum = String(lineIdx + 1);
      for (let i = 0; i < plCoords.length - 1; i++) {
        const [ax, ay] = worldToCanvas(plCoords[i][0], plCoords[i][1], w, h);
        const [bx, by] = worldToCanvas(
          plCoords[i + 1][0],
          plCoords[i + 1][1],
          w,
          h,
        );
        const mx = (ax + bx) / 2;
        const my = (ay + by) / 2;

        // Triangle: top-left, top-right, bottom-center (bottom vertex sits on the line)
        const triTop = my - triH; // top edge of triangle
        ctx.beginPath();
        ctx.moveTo(mx - triHalf, triTop);
        ctx.lineTo(mx + triHalf, triTop);
        ctx.lineTo(mx, my);
        ctx.closePath();
        ctx.fillStyle = piezoBlue;
        ctx.fill();

        // Two horizontal lines below the triangle tip
        const barW = triHalf + 1;
        ctx.strokeStyle = piezoBlue;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(mx - barW, my + 3);
        ctx.lineTo(mx + barW, my + 3);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(mx - barW, my + 6);
        ctx.lineTo(mx + barW, my + 6);
        ctx.stroke();

        // Line number above the triangle (only if multiple lines)
        if (multiLine) {
          ctx.fillStyle = piezoBlue;
          ctx.font = "bold 10px 'Segoe UI', sans-serif";
          ctx.textAlign = "center";
          ctx.textBaseline = "bottom";
          ctx.fillText(labelNum, mx, triTop - 2);
          ctx.textBaseline = "alphabetic";
        }
      }

      // Circle node markers (draggable points)
      const piezoRadius = editingPiezo && isActive ? POINT_RADIUS : 3;
      for (let i = 0; i < plCoords.length; i++) {
        const [px, py] = worldToCanvas(plCoords[i][0], plCoords[i][1], w, h);
        const isHover =
          editingPiezo &&
          isActive &&
          hoverHit?.kind === "piezo" &&
          hoverHit.index === i;

        ctx.beginPath();
        ctx.arc(px, py, piezoRadius, 0, Math.PI * 2);
        ctx.fillStyle = isHover
          ? POINT_COLOR_HOVER
          : editingPiezo && isActive
            ? piezoBlue
            : piezoBlue + "99";
        ctx.fill();
        ctx.strokeStyle =
          editingPiezo && isActive ? STROKE_ACTIVE : STROKE_INACTIVE;
        ctx.lineWidth = editingPiezo && isActive ? 1.5 : 1;
        ctx.stroke();

        if (editingPiezo && isActive) {
          ctx.fillStyle = LABEL_COLOR;
          ctx.font = "10px 'Segoe UI', sans-serif";
          ctx.textAlign = "center";
          ctx.fillText(
            `(${plCoords[i][0].toFixed(1)}, ${plCoords[i][1].toFixed(1)})`,
            px,
            py - 12,
          );
        }
      }
    }
  }

  // ── External boundary points ─────────────────────────
  const extRadius = editingExterior ? POINT_RADIUS : 3;
  for (let i = 0; i < coordinates.length; i++) {
    const [px, py] = worldToCanvas(coordinates[i][0], coordinates[i][1], w, h);
    const isSelected = editingExterior && i === selectedPointIndex;
    const isHover =
      editingExterior && hoverHit?.kind === "external" && hoverHit.index === i;

    ctx.beginPath();
    ctx.arc(px, py, extRadius, 0, Math.PI * 2);
    ctx.fillStyle = isSelected
      ? POINT_COLOR_SELECTED
      : isHover
        ? POINT_COLOR_HOVER
        : editingExterior
          ? POINT_COLOR
          : STROKE_INACTIVE;
    ctx.fill();
    ctx.strokeStyle = editingExterior ? STROKE_ACTIVE : STROKE_INACTIVE;
    ctx.lineWidth = editingExterior ? 1.5 : 1;
    ctx.stroke();

    // Coordinate label — only when editing
    if (editingExterior) {
      ctx.fillStyle = LABEL_COLOR;
      ctx.font = "10px 'Segoe UI', sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(
        `(${coordinates[i][0].toFixed(1)}, ${coordinates[i][1].toFixed(1)})`,
        px,
        py - 12,
      );
    }
  }

  // ── Material boundary points (interactive) ──────────
  const bndRadius = editingBoundaries ? POINT_RADIUS - 1 : 3;
  for (const b of materialBoundaries) {
    const belowMatId = regionMaterials[`below-${b.id}`] ?? materials[0]?.id;
    const mat = materials.find((m) => m.id === belowMatId);
    const color = mat?.color ?? "#888";

    for (let i = 0; i < b.coordinates.length; i++) {
      const [px, py] = worldToCanvas(
        b.coordinates[i][0],
        b.coordinates[i][1],
        w,
        h,
      );
      const isHover =
        editingBoundaries &&
        hoverHit?.kind === "boundary" &&
        hoverHit.boundaryId === b.id &&
        hoverHit.pointIndex === i;

      ctx.beginPath();
      ctx.arc(px, py, bndRadius, 0, Math.PI * 2);
      ctx.fillStyle = isHover
        ? POINT_COLOR_HOVER
        : editingBoundaries
          ? color
          : STROKE_INACTIVE;
      ctx.fill();
      ctx.strokeStyle = editingBoundaries ? STROKE_ACTIVE : STROKE_INACTIVE;
      ctx.lineWidth = editingBoundaries ? 1.5 : 1;
      ctx.stroke();
    }
  }

  // ── Analysis result surfaces ─────────────────────────
  if (mode === "result" && result) {
    const rvs = resultViewSettings;
    const arcCache = getArcCache(result);
    const getArcPoints = (surf: ArcSurface) => {
      if (!arcCache) {
        return circleArcPoints(
          surf.cx,
          surf.cy,
          surf.radius,
          surf.entryPoint,
          surf.exitPoint,
        );
      }
      const key = getArcKey(surf);
      const cached = arcCache.get(key);
      if (cached) return cached;
      const points = circleArcPoints(
        surf.cx,
        surf.cy,
        surf.radius,
        surf.entryPoint,
        surf.exitPoint,
      );
      arcCache.set(key, points);
      return points;
    };

    // ── Paper background + shadow (drawn first, behind geometry) ──
    // (already drawn before grid above)

    // Non-critical surfaces (when "all" or "filter" mode)
    // Draw in reverse FOS order (high FOS first = behind, low FOS last = on top)
    if (rvs.surfaceDisplay !== "critical" && result.allSurfaces.length > 0) {
      for (let si = result.allSurfaces.length - 1; si >= 0; si--) {
        const surf = result.allSurfaces[si];
        // Skip critical (drawn separately) and filtered out
        if (
          result.criticalSurface &&
          surf.cx === result.criticalSurface.cx &&
          surf.cy === result.criticalSurface.cy &&
          surf.radius === result.criticalSurface.radius
        )
          continue;
        if (rvs.surfaceDisplay === "filter" && surf.fos > rvs.fosFilterMax)
          continue;

        const arcPts = getArcPoints(surf);
        ctx.strokeStyle = fosColor(surf.fos, result.minFOS, result.maxFOS);
        ctx.lineWidth = 1;
        ctx.globalAlpha = 0.6;
        ctx.beginPath();
        for (let i = 0; i < arcPts.length; i++) {
          const [px, py] = worldToCanvas(arcPts[i][0], arcPts[i][1], w, h);
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.stroke();
        ctx.globalAlpha = 1.0;
      }
    }

    // Critical surface
    if (result.criticalSurface) {
      const cs = result.criticalSurface;
      const arcPts = getArcPoints(cs);

      // Draw the failure mass region (area between slope surface and arc)
      // with semi-transparent fill
      ctx.save();
      ctx.globalAlpha = 0.12;
      ctx.fillStyle = "#000000";
      ctx.beginPath();
      // Top edge: walk the slope surface from entry to exit
      const entryX = cs.entryPoint[0];
      const exitX = cs.exitPoint[0];
      const minX = Math.min(entryX, exitX);
      const maxX = Math.max(entryX, exitX);

      // Find surface points between entry and exit
      const surfacePts: [number, number][] = [];
      // Add entry point
      surfacePts.push(cs.entryPoint);
      // Add intermediate boundary points that lie between entry and exit X
      for (let i = 0; i < coordinates.length; i++) {
        const [bx, by] = coordinates[i];
        if (bx > minX && bx < maxX) {
          surfacePts.push([bx, by]);
        }
      }
      // Add exit point
      surfacePts.push(cs.exitPoint);
      // Sort by X
      surfacePts.sort((a, b) => a[0] - b[0]);

      // Draw: surface line → then arc back
      for (let i = 0; i < surfacePts.length; i++) {
        const [px, py] = worldToCanvas(
          surfacePts[i][0],
          surfacePts[i][1],
          w,
          h,
        );
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      // Arc back (reverse)
      for (let i = arcPts.length - 1; i >= 0; i--) {
        const [px, py] = worldToCanvas(arcPts[i][0], arcPts[i][1], w, h);
        ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
      ctx.restore();

      // Slice lines (vertical lines within the failure mass)
      if (rvs.showSlices && result.criticalSlices.length > 0) {
        ctx.strokeStyle = "#000000";
        ctx.lineWidth = 0.8;
        ctx.globalAlpha = 0.6;

        // Helper: compute the arc Y (bottom of circle) at a given X
        const arcYAtX = (x: number): number | null => {
          const dx = x - cs.cx;
          if (Math.abs(dx) > cs.radius) return null;
          // Two solutions; pick the lower one (failure arc goes below center)
          return cs.cy - Math.sqrt(cs.radius * cs.radius - dx * dx);
        };

        // Collect all unique X boundaries from slices
        const xBounds = new Set<number>();
        for (const slice of result.criticalSlices) {
          xBounds.add(slice.xLeft);
          xBounds.add(slice.xRight);
        }

        // Draw vertical lines at each slice boundary
        for (const x of xBounds) {
          const topY = surfaceYAtX(x);
          const botY = arcYAtX(x);
          if (topY === null || botY === null) continue;
          const [sx, sy] = worldToCanvas(x, topY, w, h);
          const [, ey] = worldToCanvas(x, botY, w, h);
          ctx.beginPath();
          ctx.moveTo(sx, sy);
          ctx.lineTo(sx, ey);
          ctx.stroke();
        }
        ctx.globalAlpha = 1.0;
      }

      // Arc stroke (bold black like reference image)
      ctx.strokeStyle = "#000000";
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let i = 0; i < arcPts.length; i++) {
        const [px, py] = worldToCanvas(arcPts[i][0], arcPts[i][1], w, h);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();

      // Centre dot and radius lines to entry/exit
      if (rvs.showCentreMarker) {
        const [ccx, ccy] = worldToCanvas(cs.cx, cs.cy, w, h);
        const [epx, epy] = worldToCanvas(
          cs.entryPoint[0],
          cs.entryPoint[1],
          w,
          h,
        );
        const [xpx, xpy] = worldToCanvas(
          cs.exitPoint[0],
          cs.exitPoint[1],
          w,
          h,
        );

        // Radius lines (solid, bold — same style as the arc)
        ctx.strokeStyle = "#000000";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(ccx, ccy);
        ctx.lineTo(epx, epy);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(ccx, ccy);
        ctx.lineTo(xpx, xpy);
        ctx.stroke();

        // Small filled circle at centre
        ctx.fillStyle = "#000000";
        ctx.beginPath();
        ctx.arc(ccx, ccy, 3, 0, Math.PI * 2);
        ctx.fill();
      }

      // FOS label to the right of the circle centre
      if (rvs.showFosLabel) {
        const [ccx2, ccy2] = worldToCanvas(cs.cx, cs.cy, w, h);
        const fosText = cs.fos.toFixed(3);
        ctx.font = "bold 14px sans-serif";
        const tw = ctx.measureText(fosText).width;
        const labelX = ccx2 + 10;

        // Background for readability
        ctx.fillStyle = "rgba(255,255,255,0.85)";
        ctx.fillRect(labelX - 3, ccy2 - 16, tw + 6, 20);

        // Text
        ctx.fillStyle = "#000000";
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.fillText(fosText, labelX, ccy2 - 4);

        // Underline
        ctx.strokeStyle = "#000000";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(labelX - 1, ccy2 + 2);
        ctx.lineTo(labelX + tw + 1, ccy2 + 2);
        ctx.stroke();
      }
    }

    // ── Paper frame ──────────────────────────────────────
    const { paperFrame } = rvs;
    const pf = computePaperFrame(w, h, paperFrame.paperSize);

    if (paperFrame.showFrame) {
      // Restore clip (ticks draw inside paper, on top of geometry)
      ctx.restore();

      // Inner frame (plot area) inset from paper (using standardized percentages)
      const PLOT_PAD_L = pf.w * PLOT_MARGINS.L;
      const PLOT_PAD_B = pf.h * PLOT_MARGINS.B;
      const PLOT_PAD_T = pf.h * PLOT_MARGINS.T;
      const PLOT_PAD_R = pf.w * PLOT_MARGINS.R;

      const ifx = pf.x + PLOT_PAD_L;
      const ify = pf.y + PLOT_PAD_T;
      const ifw = pf.w - PLOT_PAD_L - PLOT_PAD_R;
      const ifh = pf.h - PLOT_PAD_T - PLOT_PAD_B;

      // ── Ticks + labels between paper edge and inner frame ──
      const TICK_LEN = 6;
      const MINI_TICK = 3;
      const rulerFont = "10px 'Segoe UI', sans-serif";

      // World coords at inner frame edges
      const [worldLeftTick] = canvasToWorld(ifx, ify, w, h);
      const [worldRightTick] = canvasToWorld(ifx + ifw, ify, w, h);
      const [, worldTopTick] = canvasToWorld(ifx, ify, w, h);
      const [, worldBottomTick] = canvasToWorld(ifx, ify + ifh, w, h);

      // Compute tick spacing
      const pixelsPerWorldUnit = ifw / (worldRightTick - worldLeftTick);
      const rulerRawStep = 40 / pixelsPerWorldUnit;
      const rulerMag = Math.pow(10, Math.floor(Math.log10(rulerRawStep)));
      const rulerSteps = [1, 2, 5, 10];
      const rulerStep = Math.max(
        0.5,
        rulerSteps.find((s) => s * rulerMag >= rulerRawStep)! * rulerMag,
      );

      ctx.save();
      ctx.fillStyle = "#333";
      ctx.strokeStyle = "#333";
      ctx.lineWidth = 1;
      ctx.font = rulerFont;

      // ── Bottom ticks (X axis) — below inner frame ──
      const btmY = ify + ifh;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      const xStart = Math.ceil(worldLeftTick / rulerStep) * rulerStep;
      for (let gx = xStart; gx <= worldRightTick; gx += rulerStep) {
        const [px] = worldToCanvas(gx, 0, w, h);
        if (px < ifx || px > ifx + ifw) continue;
        ctx.beginPath();
        ctx.moveTo(px, btmY);
        ctx.lineTo(px, btmY + TICK_LEN);
        ctx.stroke();
        const label = Number.isInteger(gx) ? gx.toString() : gx.toFixed(1);
        ctx.fillText(label, px, btmY + TICK_LEN + 2);
      }
      // Minor ticks
      const xMinorStep = rulerStep / 2;
      const xMinorStart = Math.ceil(worldLeftTick / xMinorStep) * xMinorStep;
      for (let gx = xMinorStart; gx <= worldRightTick; gx += xMinorStep) {
        const [px] = worldToCanvas(gx, 0, w, h);
        if (px < ifx || px > ifx + ifw) continue;
        if (Math.abs(gx / rulerStep - Math.round(gx / rulerStep)) < 0.001)
          continue;
        ctx.beginPath();
        ctx.moveTo(px, btmY);
        ctx.lineTo(px, btmY + MINI_TICK);
        ctx.stroke();
      }

      // ── Left ticks (Y axis) — left of inner frame ──
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      const yStart = Math.ceil(worldBottomTick / rulerStep) * rulerStep;
      for (let gy = yStart; gy <= worldTopTick; gy += rulerStep) {
        const [, py] = worldToCanvas(0, gy, w, h);
        if (py < ify || py > ify + ifh) continue;
        ctx.beginPath();
        ctx.moveTo(ifx, py);
        ctx.lineTo(ifx - TICK_LEN, py);
        ctx.stroke();
        const label = Number.isInteger(gy) ? gy.toString() : gy.toFixed(1);
        ctx.fillText(label, ifx - TICK_LEN - 3, py);
      }
      // Minor ticks
      const yMinorStep = rulerStep / 2;
      const yMinorStart = Math.ceil(worldBottomTick / yMinorStep) * yMinorStep;
      for (let gy = yMinorStart; gy <= worldTopTick; gy += yMinorStep) {
        const [, py] = worldToCanvas(0, gy, w, h);
        if (py < ify || py > ify + ifh) continue;
        if (Math.abs(gy / rulerStep - Math.round(gy / rulerStep)) < 0.001)
          continue;
        ctx.beginPath();
        ctx.moveTo(ifx, py);
        ctx.lineTo(ifx - MINI_TICK, py);
        ctx.stroke();
      }
      ctx.restore();

      // Inner frame border (plot area)
      ctx.strokeStyle = "#000000";
      ctx.lineWidth = 1.5;
      ctx.strokeRect(ifx, ify, ifw, ifh);
    }

    // ── Annotations ──────────────────────────────────────
    const annotations = resultViewSettings.annotations;
    // Scale factor for annotations based on paper frame size
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

    for (const anno of annotations) {
      // Convert fractional paper-frame coordinates to canvas pixels
      const ax = pf.x + anno.x * pf.w;
      const ay = pf.y + anno.y * pf.h;
      const fontSize = (anno.fontSize ?? 12) * annoScale;

      if (anno.type === "text") {
        const family = anno.fontFamily ?? "sans-serif";
        const weight = anno.bold ? "bold" : "normal";
        const style = anno.italic ? "italic" : "normal";
        const resolvedText = resolveAnnotationText(anno.text ?? "");
        ctx.fillStyle = anno.color ?? "#000000";
        ctx.font = `${style} ${weight} ${fontSize}px ${family}`;
        ctx.textAlign = "left";
        ctx.textBaseline = "top";

        const lines = resolvedText.split("\n");
        const lineHeight = fontSize * 1.2;
        lines.forEach((line, i) => {
          ctx.fillText(line, ax, ay + i * lineHeight);
        });
      } else if (anno.type === "color-bar") {
        const barW = 20 * annoScale;
        const barH = 200 * annoScale;
        // Use anno position as top-left of color bar
        const barX = ax;
        const barY = ay;

        const fosMin = result.minFOS;
        const fosMax = result.maxFOS;
        const numSteps = Math.floor(barH);

        // Draw gradient bar
        for (let i = 0; i < numSteps; i++) {
          const t = i / (numSteps - 1);
          const fos = fosMax - t * (fosMax - fosMin);
          ctx.fillStyle = fosColor(fos, fosMin, fosMax);
          ctx.fillRect(barX, barY + i, barW, 2);
        }

        // Border
        ctx.strokeStyle = "#000000";
        ctx.lineWidth = 1;
        ctx.strokeRect(barX, barY, barW, barH);

        // Labels
        ctx.fillStyle = "#000000";
        ctx.font = `${Math.max(10, 11 * annoScale)}px 'Segoe UI', sans-serif`;
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        const labelX2 = barX + barW + 5 * annoScale;

        // Title
        ctx.font = `bold ${Math.max(10, 11 * annoScale)}px 'Segoe UI', sans-serif`;
        ctx.textBaseline = "bottom";
        ctx.fillText("FOS", barX, barY - 4 * annoScale);
        ctx.font = `${Math.max(10, 11 * annoScale)}px 'Segoe UI', sans-serif`;
        ctx.textBaseline = "middle";

        // Tick marks and labels
        const numTicks = 5;
        for (let t = 0; t <= numTicks; t++) {
          const frac = t / numTicks;
          const y = barY + frac * barH;
          const fos = fosMax - frac * (fosMax - fosMin);

          // Tick
          ctx.strokeStyle = "#000000";
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(barX + barW, y);
          ctx.lineTo(barX + barW + 3, y);
          ctx.stroke();

          // Label
          ctx.fillStyle = "#000000";
          ctx.fillText(fos.toFixed(2), labelX2, y);
        }
      } else if (anno.type === "input-params") {
        drawParamBlock(
          ctx,
          ax,
          ay,
          "Input Parameters",
          [
            `Method: ${result.method}`,
            `Slices: ${result.criticalSlices.length}`,
            `Surfaces: ${result.allSurfaces.length}`,
          ],
          annoScale,
        );
      } else if (anno.type === "output-params") {
        const lines = [`FOS = ${result.minFOS.toFixed(3)}`];
        if (result.criticalSurface) {
          lines.push(
            `Centre: (${result.criticalSurface.cx.toFixed(1)}, ${result.criticalSurface.cy.toFixed(1)})`,
          );
          lines.push(`Radius: ${result.criticalSurface.radius.toFixed(2)} m`);
        }
        lines.push(`Time: ${result.elapsedMs.toFixed(0)} ms`);
        drawParamBlock(ctx, ax, ay, "Results", lines, annoScale);
      } else if (anno.type === "material-table") {
        const header = ["Material", "γ", "φ", "c"];
        const rows = materials.map((m) => [
          m.name,
          `${m.unitWeight}`,
          `${m.frictionAngle}°`,
          `${m.cohesion}`,
        ]);
        drawTable(ctx, ax, ay, header, rows, materials, annoScale);
      }

      // Selection highlight for selected annotations
      if (selectedAnnotationIds.includes(anno.id)) {
        ctx.save();
        ctx.strokeStyle = "#0078d4";
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 3]);
        // Draw a small selection indicator at the annotation origin
        ctx.strokeRect(ax - 3, ay - 3, 6, 6);
        ctx.setLineDash([]);
        ctx.restore();
      }
    }
  }

  // ── Mouse crosshair (edit mode only) ───────────────────
  if (mode === "edit" && mouseWorld) {
    const [mx, my] = worldToCanvas(mouseWorld[0], mouseWorld[1], w, h);
    ctx.strokeStyle = CROSSHAIR_COLOR;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(mx, 0);
    ctx.lineTo(mx, h);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, my);
    ctx.lineTo(w, my);
    ctx.stroke();
    ctx.setLineDash([]);
  }
}
