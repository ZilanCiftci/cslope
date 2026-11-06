/**
 * The colors of the charts in the result windows (Results plot,
 * Sensitivity, Probabilistic): series and grid from the theme tokens, one
 * set per theme. Text is never drawn in these colors (see ChartTooltip).
 */
export const CHART = {
  /** The one series of a chart (a slice value, the FOS, the histogram). */
  series: "var(--color-chart-1)",
  /** Moment equilibrium (Fm). */
  moment: "var(--color-chart-2)",
  /** Force equilibrium (Ff). */
  force: "var(--color-chart-3)",
  /** A marked point: where Fm = Ff. */
  mark: "var(--color-chart-4)",
  grid: "var(--color-chart-grid)",
} as const;
