/**
 * LambdaFmFfChart — SVG chart of Lambda vs. Fm / Ff
 * for the Morgenstern-Price critical slip surface.
 *
 * Shows the moment-equilibrium (Fm) and force-equilibrium (Ff) FOS values
 * at each lambda, with the intersection (equilibrium) point highlighted.
 */

import { useMemo } from "react";

/** A single [lambda, Fm, Ff, gap] tuple produced by the M-P solver. */
type LffRow = [number, number, number, number];

interface Props {
  /** Lambda–Fm–Ff–gap data from the critical surface. */
  data: LffRow[];
  /** Chart width in CSS px (default 260). */
  width?: number;
  /** Chart height in CSS px (default 200). */
  height?: number;
}

// ── layout constants ────────────────────────────────────────────
const PAD = { top: 24, right: 16, bottom: 36, left: 44 };
const TICK_LEN = 4;

function niceStep(range: number, targetTicks: number): number {
  const raw = range / targetTicks;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  let step: number;
  if (norm <= 1.5) step = 1;
  else if (norm <= 3) step = 2;
  else if (norm <= 7) step = 5;
  else step = 10;
  return step * mag;
}

function makeTicks(min: number, max: number, targetTicks: number): number[] {
  const step = niceStep(max - min, targetTicks);
  const start = Math.ceil(min / step) * step;
  const ticks: number[] = [];
  for (let v = start; v <= max + step * 0.001; v += step) {
    ticks.push(parseFloat(v.toPrecision(10)));
  }
  return ticks;
}

export function LambdaFmFfChart({ data, width = 260, height = 200 }: Props) {
  const sorted = useMemo(() => [...data].sort((a, b) => a[0] - b[0]), [data]);

  const plotW = width - PAD.left - PAD.right;
  const plotH = height - PAD.top - PAD.bottom;

  // ── compute domains ──────────────────────────────────────────
  const { xMin, xMax, yMin, yMax, xTicks, yTicks, eqLambda, eqFOS } =
    useMemo(() => {
      const lambdas = sorted.map((r) => r[0]);
      const allFos = sorted.flatMap((r) => [r[1], r[2]]);

      let xLo = Math.min(...lambdas);
      let xHi = Math.max(...lambdas);
      let yLo = Math.min(...allFos);
      let yHi = Math.max(...allFos);

      // Add margins
      const xPad = (xHi - xLo) * 0.12 || 0.1;
      const yPad = (yHi - yLo) * 0.1 || 0.05;
      xLo -= xPad;
      xHi += xPad;
      yLo -= yPad;
      yHi += yPad;

      // Find the row with smallest gap (equilibrium point)
      const best = [...sorted].sort((a, b) => a[3] - b[3])[0];
      const eqLambda = best[0];
      const eqFOS = (best[1] + best[2]) / 2;

      return {
        xMin: xLo,
        xMax: xHi,
        yMin: yLo,
        yMax: yHi,
        xTicks: makeTicks(xLo, xHi, 5),
        yTicks: makeTicks(yLo, yHi, 5),
        eqLambda,
        eqFOS,
      };
    }, [sorted]);

  // ── scale helpers ────────────────────────────────────────────
  const sx = (v: number) => PAD.left + ((v - xMin) / (xMax - xMin)) * plotW;
  const sy = (v: number) =>
    PAD.top + plotH - ((v - yMin) / (yMax - yMin)) * plotH;

  // ── style tokens (VS Code dark) ──────────────────────────────
  const axisColor = "var(--color-vsc-text-muted, #888)";
  const gridColor = "var(--color-vsc-border, #333)";
  const fmColor = "#e06c75"; // moment — warm red
  const ffColor = "#61afef"; // force  — cool blue
  const eqColor = "#98c379"; // equilibrium — green

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      style={{ userSelect: "none" }}
    >
      {/* ── Title ──────────────────────────────────────── */}
      <text
        x={width / 2}
        y={12}
        textAnchor="middle"
        fill="var(--color-vsc-text, #ccc)"
        fontSize={10}
        fontWeight={600}
      >
        Factor of Safety vs. Lambda
      </text>

      {/* ── Grid lines ─────────────────────────────────── */}
      {xTicks.map((t) => (
        <line
          key={`gx${t}`}
          x1={sx(t)}
          x2={sx(t)}
          y1={PAD.top}
          y2={PAD.top + plotH}
          stroke={gridColor}
          strokeWidth={0.5}
        />
      ))}
      {yTicks.map((t) => (
        <line
          key={`gy${t}`}
          x1={PAD.left}
          x2={PAD.left + plotW}
          y1={sy(t)}
          y2={sy(t)}
          stroke={gridColor}
          strokeWidth={0.5}
        />
      ))}

      {/* ── Axes ───────────────────────────────────────── */}
      <line
        x1={PAD.left}
        x2={PAD.left + plotW}
        y1={PAD.top + plotH}
        y2={PAD.top + plotH}
        stroke={axisColor}
        strokeWidth={1}
      />
      <line
        x1={PAD.left}
        x2={PAD.left}
        y1={PAD.top}
        y2={PAD.top + plotH}
        stroke={axisColor}
        strokeWidth={1}
      />

      {/* ── X tick labels ──────────────────────────────── */}
      {xTicks.map((t) => (
        <g key={`xt${t}`}>
          <line
            x1={sx(t)}
            x2={sx(t)}
            y1={PAD.top + plotH}
            y2={PAD.top + plotH + TICK_LEN}
            stroke={axisColor}
            strokeWidth={1}
          />
          <text
            x={sx(t)}
            y={PAD.top + plotH + TICK_LEN + 10}
            textAnchor="middle"
            fill={axisColor}
            fontSize={9}
          >
            {t.toFixed(2)}
          </text>
        </g>
      ))}

      {/* ── Y tick labels ──────────────────────────────── */}
      {yTicks.map((t) => (
        <g key={`yt${t}`}>
          <line
            x1={PAD.left - TICK_LEN}
            x2={PAD.left}
            y1={sy(t)}
            y2={sy(t)}
            stroke={axisColor}
            strokeWidth={1}
          />
          <text
            x={PAD.left - TICK_LEN - 3}
            y={sy(t) + 3}
            textAnchor="end"
            fill={axisColor}
            fontSize={9}
          >
            {t.toFixed(2)}
          </text>
        </g>
      ))}

      {/* ── Axis labels ────────────────────────────────── */}
      <text
        x={PAD.left + plotW / 2}
        y={height - 2}
        textAnchor="middle"
        fill={axisColor}
        fontSize={9}
      >
        Lambda (λ)
      </text>
      <text
        x={10}
        y={PAD.top + plotH / 2}
        textAnchor="middle"
        fill={axisColor}
        fontSize={9}
        transform={`rotate(-90 10 ${PAD.top + plotH / 2})`}
      >
        Factor of Safety
      </text>

      {/* ── Equilibrium vertical line ──────────────────── */}
      <line
        x1={sx(eqLambda)}
        x2={sx(eqLambda)}
        y1={PAD.top}
        y2={PAD.top + plotH}
        stroke={eqColor}
        strokeWidth={1}
        strokeDasharray="4 2"
        opacity={0.7}
      />

      {/* ── Fm data points (filled squares) ────────────── */}
      {sorted.map((r, i) => (
        <rect
          key={`fm${i}`}
          x={sx(r[0]) - 3.5}
          y={sy(r[1]) - 3.5}
          width={7}
          height={7}
          fill={fmColor}
        >
          <title>
            λ={r[0].toFixed(4)} Fm={r[1].toFixed(4)}
          </title>
        </rect>
      ))}

      {/* ── Ff data points (open squares) ──────────────── */}
      {sorted.map((r, i) => (
        <rect
          key={`ff${i}`}
          x={sx(r[0]) - 3.5}
          y={sy(r[2]) - 3.5}
          width={7}
          height={7}
          fill="none"
          stroke={ffColor}
          strokeWidth={1.5}
        >
          <title>
            λ={r[0].toFixed(4)} Ff={r[2].toFixed(4)}
          </title>
        </rect>
      ))}

      {/* ── Equilibrium point (filled triangle) ────────── */}
      <polygon
        points={`${sx(eqLambda)},${sy(eqFOS) - 5} ${sx(eqLambda) - 5},${sy(eqFOS) + 4} ${sx(eqLambda) + 5},${sy(eqFOS) + 4}`}
        fill={eqColor}
      >
        <title>
          λ={eqLambda.toFixed(4)} FOS={eqFOS.toFixed(4)}
        </title>
      </polygon>

      {/* ── Legend ──────────────────────────────────────── */}
      <g transform={`translate(${PAD.left + plotW - 65}, ${PAD.top + 6})`}>
        {/* Fm */}
        <rect x={0} y={0} width={7} height={7} fill={fmColor} />
        <text x={11} y={7} fill="var(--color-vsc-text, #ccc)" fontSize={8}>
          Moment
        </text>
        {/* Ff */}
        <rect
          x={0}
          y={12}
          width={7}
          height={7}
          fill="none"
          stroke={ffColor}
          strokeWidth={1.5}
        />
        <text x={11} y={19} fill="var(--color-vsc-text, #ccc)" fontSize={8}>
          Force
        </text>
        {/* Eq */}
        <polygon points="3.5,24 0,31 7,31" fill={eqColor} />
        <text x={11} y={31} fill="var(--color-vsc-text, #ccc)" fontSize={8}>
          F of S
        </text>
      </g>
    </svg>
  );
}
