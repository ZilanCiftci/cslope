/**
 * SlopePlot — Plotly.js visualization of slope geometry and failure surfaces.
 *
 * Shows:
 * - Slope boundary as filled polygon
 * - Material colours
 * - Water table line
 * - All evaluated slip surfaces (colour coded by FOS via chroma-js)
 * - Critical failure circle highlighted
 * - UDL and line load indicators
 */

import { useMemo } from "react";
import Plot from "react-plotly.js";
import type { Data, Layout } from "plotly.js";
import { useAppStore } from "../../store/app-store";
import { circleArcPoints } from "../../utils/arc";
import { fosColor } from "../../utils/fos-color";

// ── Component ─────────────────────────────────────────────────

export function SlopePlot() {
  const coordinates = useAppStore((s) => s.coordinates);
  const materials = useAppStore((s) => s.materials);
  const materialBoundaries = useAppStore((s) => s.materialBoundaries);
  const regionMaterials = useAppStore((s) => s.regionMaterials);
  const analysisLimits = useAppStore((s) => s.analysisLimits);
  const piezometricLine = useAppStore((s) => s.piezometricLine);
  const udls = useAppStore((s) => s.udls);
  const lineLoads = useAppStore((s) => s.lineLoads);
  const result = useAppStore((s) => s.result);
  const theme = useAppStore((s) => s.theme);
  const orientation = useAppStore((s) => s.orientation);

  const traces = useMemo(() => {
    const data: Data[] = [];
    const crestSide = orientation === "rtl" ? "right" : "left";
    const toeSide = orientation === "rtl" ? "left" : "right";

    // ── Slope boundary fill ─────────────────────────────────
    // Coordinates already define the complete closed boundary —
    // Plotly's fill: "toself" connects last to first automatically.
    const xs = coordinates.map((c) => c[0]);
    const ys = coordinates.map((c) => c[1]);

    data.push({
      x: xs,
      y: ys,
      type: "scatter",
      mode: "lines",
      fill: "toself",
      fillcolor: materials[0]?.color ?? "#d4a373",
      line: { color: "#333", width: 2 },
      name: "Slope",
      hoverinfo: "skip",
    } as Data);

    // ── Boundary points ─────────────────────────────────────
    data.push({
      x: xs,
      y: ys,
      type: "scatter",
      mode: "markers",
      marker: { color: "#1e293b", size: 6 },
      name: "Points",
      hovertemplate: "(%{x:.1f}, %{y:.1f})<extra></extra>",
    } as Data);

    // ── Piezometric lines ───────────────────────────────────
    if (piezometricLine.lines.length > 0) {
      const piezoBlue = "#1a3a8a";
      const multiLine = piezometricLine.lines.length > 1;
      for (const line of piezometricLine.lines) {
        if (line.coordinates.length < 2) continue;
        // Solid blue line
        data.push({
          x: line.coordinates.map((c) => c[0]),
          y: line.coordinates.map((c) => c[1]),
          type: "scatter",
          mode: "lines",
          line: { color: piezoBlue, width: 2 },
          name: multiLine ? line.name : "Piezometric Line",
          legendgroup: `piezo-${line.id}`,
        } as Data);
        // Triangle-down symbols at segment midpoints
        const midX: number[] = [];
        const midY: number[] = [];
        for (let i = 0; i < line.coordinates.length - 1; i++) {
          midX.push((line.coordinates[i][0] + line.coordinates[i + 1][0]) / 2);
          midY.push((line.coordinates[i][1] + line.coordinates[i + 1][1]) / 2);
        }
        if (midX.length > 0) {
          data.push({
            x: midX,
            y: midY,
            type: "scatter",
            mode: "markers",
            marker: {
              symbol: "triangle-down",
              size: 10,
              color: piezoBlue,
            },
            showlegend: false,
            hoverinfo: "skip",
            legendgroup: `piezo-${line.id}`,
          } as Data);
        }
      }
    }

    // ── UDLs ────────────────────────────────────────────────
    for (const u of udls) {
      // Show as a line/bar above the slope
      const topY = Math.max(...ys) + 1;
      data.push({
        x: [u.x1, u.x1, u.x2, u.x2],
        y: [topY, topY + u.magnitude * 0.05, topY + u.magnitude * 0.05, topY],
        type: "scatter",
        mode: "lines",
        fill: "toself",
        fillcolor: "rgba(239, 68, 68, 0.3)",
        line: { color: "#ef4444", width: 1 },
        name: `UDL ${u.magnitude} kPa`,
        showlegend: false,
      } as Data);
    }

    // ── Line loads ──────────────────────────────────────────
    for (const l of lineLoads) {
      const topY = Math.max(...ys) + 1;
      data.push({
        x: [l.x, l.x],
        y: [topY, topY + l.magnitude * 0.02],
        type: "scatter",
        mode: "lines+markers",
        marker: { symbol: "triangle-down", size: 10, color: "#3b82f6" },
        line: { color: "#3b82f6", width: 2 },
        name: `Load ${l.magnitude} kN/m`,
        showlegend: false,
      } as Data);
    }

    // ── Material boundary lines ───────────────────────────────
    if (materialBoundaries.length > 0) {
      for (const b of materialBoundaries) {
        if (b.coordinates.length < 2) continue;
        const belowMatId = regionMaterials[`below-${b.id}`] ?? materials[0]?.id;
        const mat = materials.find((m) => m.id === belowMatId);
        const color = mat?.color ?? "#888";
        data.push({
          x: b.coordinates.map((c) => c[0]),
          y: b.coordinates.map((c) => c[1]),
          type: "scatter",
          mode: "lines+markers",
          line: { color, width: 2, dash: "dash" },
          marker: { color, size: 4 },
          name: `${mat?.name ?? "?"} boundary`,
          showlegend: true,
          hoverinfo: "skip",
        } as Data);
      }
    }

    // ── Entry/exit range markers ────────────────────────────
    if (analysisLimits.enabled) {
      // Helper: find the Y on the top surface at a given X
      const surfaceYAtX = (x: number): number | null => {
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
      };

      // Collect surface points between two X values
      const surfaceRange = (leftX: number, rightX: number) => {
        const pts: [number, number][] = [];
        const ly = surfaceYAtX(leftX);
        if (ly !== null) pts.push([leftX, ly]);
        for (const [cx, cy] of coordinates) {
          if (cx > leftX && cx < rightX) {
            const topY = surfaceYAtX(cx);
            if (topY !== null && Math.abs(cy - topY) < 0.001) {
              pts.push([cx, cy]);
            }
          }
        }
        const ry = surfaceYAtX(rightX);
        if (ry !== null) pts.push([rightX, ry]);
        pts.sort((a, b) => a[0] - b[0]);
        return pts;
      };

      // Entry range — red dotted line on surface
      const entryPts = surfaceRange(
        Math.min(analysisLimits.entryLeftX, analysisLimits.entryRightX),
        Math.max(analysisLimits.entryLeftX, analysisLimits.entryRightX),
      );
      if (entryPts.length >= 2) {
        data.push({
          x: entryPts.map((p) => p[0]),
          y: entryPts.map((p) => p[1]),
          type: "scatter",
          mode: "lines",
          line: { color: "#cc0000", width: 2, dash: "dot" },
          name: `Entry range (crest: ${crestSide})`,
          hoverinfo: "skip",
        } as Data);
      }

      // Exit range — red dotted line on surface
      const exitPts = surfaceRange(
        Math.min(analysisLimits.exitLeftX, analysisLimits.exitRightX),
        Math.max(analysisLimits.exitLeftX, analysisLimits.exitRightX),
      );
      if (exitPts.length >= 2) {
        data.push({
          x: exitPts.map((p) => p[0]),
          y: exitPts.map((p) => p[1]),
          type: "scatter",
          mode: "lines",
          line: { color: "#cc0000", width: 2, dash: "dot" },
          name: `Exit range (toe: ${toeSide})`,
          hoverinfo: "skip",
        } as Data);
      }
    }

    // ── All failure surfaces (semi-transparent) ─────────────
    if (result && result.allSurfaces.length > 0) {
      for (const surf of result.allSurfaces) {
        const arcPts = circleArcPoints(
          surf.cx,
          surf.cy,
          surf.radius,
          surf.entryPoint,
          surf.exitPoint,
        );
        const arcX = arcPts.map((p) => p[0]);
        const arcY = arcPts.map((p) => p[1]);
        data.push({
          x: arcX,
          y: arcY,
          type: "scatter",
          mode: "lines",
          line: { color: fosColor(surf.fos), width: 1 },
          opacity: 0.3,
          showlegend: false,
          hovertemplate: `FOS: ${surf.fos.toFixed(3)}<extra></extra>`,
        } as Data);
      }
    }

    // ── Critical surface (bold) ─────────────────────────────
    if (result?.criticalSurface) {
      const cs = result.criticalSurface;
      const arcPts = circleArcPoints(
        cs.cx,
        cs.cy,
        cs.radius,
        cs.entryPoint,
        cs.exitPoint,
      );
      const arcX = arcPts.map((p) => p[0]);
      const arcY = arcPts.map((p) => p[1]);
      data.push({
        x: arcX,
        y: arcY,
        type: "scatter",
        mode: "lines",
        line: { color: "#dc2626", width: 3 },
        name: `Critical (FOS ${cs.fos.toFixed(3)})`,
        hovertemplate: `Critical FOS: ${cs.fos.toFixed(3)}<extra></extra>`,
      } as Data);

      // Critical circle center
      data.push({
        x: [cs.cx],
        y: [cs.cy],
        type: "scatter",
        mode: "markers",
        marker: { symbol: "x", size: 8, color: "#dc2626" },
        showlegend: false,
        hovertemplate: `Centre (%{x:.1f}, %{y:.1f})<extra></extra>`,
      } as Data);
    }

    return data;
  }, [
    coordinates,
    materials,
    materialBoundaries,
    regionMaterials,
    analysisLimits,
    piezometricLine,
    udls,
    lineLoads,
    result,
    orientation,
  ]);

  const layout = useMemo((): Partial<Layout> => {
    const xs = coordinates.map((c) => c[0]);
    const ys = coordinates.map((c) => c[1]);
    const xMin = Math.min(...xs);
    const xMax = Math.max(...xs);
    const yMin = Math.min(...ys);
    const yMax = Math.max(...ys);
    const pad = Math.max(xMax - xMin, yMax - yMin) * 0.15;

    const isDark = theme === "dark";

    return {
      autosize: true,
      margin: { l: 50, r: 20, t: 10, b: 40 },
      paper_bgcolor: isDark ? "#1e1e1e" : "#ffffff",
      plot_bgcolor: isDark ? "#252526" : "#f8f8f8",
      font: { color: isDark ? "#cccccc" : "#333333", size: 11 },
      xaxis: {
        title: { text: "x (m)" },
        range: [xMin - pad, xMax + pad],
        scaleanchor: "y",
        scaleratio: 1,
        gridcolor: isDark ? "#3c3c3c" : "#e0e0e0",
        zerolinecolor: isDark ? "#555555" : "#bbb",
      },
      yaxis: {
        title: { text: "y (m)" },
        range: [yMin - pad - 2, yMax + pad + 2],
        gridcolor: isDark ? "#3c3c3c" : "#e0e0e0",
        zerolinecolor: isDark ? "#555555" : "#bbb",
      },
      showlegend: true,
      legend: {
        x: 1,
        y: 1,
        xanchor: "right",
        bgcolor: isDark ? "rgba(30,30,30,0.9)" : "rgba(255,255,255,0.9)",
        font: { size: 10, color: isDark ? "#cccccc" : "#333333" },
      },
      dragmode: "pan",
    };
  }, [coordinates, theme]);

  return (
    <Plot
      data={traces}
      layout={layout}
      config={{
        responsive: true,
        scrollZoom: true,
        displayModeBar: true,
        modeBarButtonsToRemove: ["lasso2d", "select2d"],
      }}
      useResizeHandler
      className="w-full h-full"
      style={{ minHeight: 400 }}
    />
  );
}
