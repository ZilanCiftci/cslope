/**
 * Mock for react-plotly.js — renders a simple div in tests
 * since Plotly requires a real browser environment.
 */

import { forwardRef } from "react";

const MockPlot = forwardRef<HTMLDivElement, Record<string, unknown>>(
  function MockPlot(props, ref) {
    return (
      <div
        ref={ref}
        data-testid="plotly-chart"
        data-traces={JSON.stringify((props as { data?: unknown }).data ?? [])}
      />
    );
  },
);

export default MockPlot;
