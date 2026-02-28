/**
 * ResultPanel — dark-themed analysis results display.
 */

import type { ReactNode } from "react";
import { useAppStore } from "../../store/app-store";

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div
      className="flex justify-between py-0.5"
      style={{ borderBottom: "1px solid var(--color-vsc-border)" }}
    >
      <span style={{ color: "var(--color-vsc-text-muted)" }}>{label}</span>
      <span>{children}</span>
    </div>
  );
}

export function ResultPanel() {
  const runState = useAppStore((s) => s.runState);
  const progress = useAppStore((s) => s.progress);
  const result = useAppStore((s) => s.result);
  const errorMessage = useAppStore((s) => s.errorMessage);

  return (
    <div
      className="h-full overflow-y-auto p-3"
      style={{
        background: "var(--color-vsc-panel)",
        color: "var(--color-vsc-text)",
      }}
    >
      <div
        className="text-[11px] font-semibold uppercase tracking-wider mb-2 select-none"
        style={{ color: "var(--color-vsc-text-muted)" }}
      >
        Results
      </div>

      {runState === "idle" && (
        <p
          className="text-[12px]"
          style={{ color: "var(--color-vsc-text-muted)" }}
        >
          Click &ldquo;Run Analysis&rdquo; to see results.
        </p>
      )}

      {runState === "running" && (
        <div className="space-y-2">
          <p
            className="text-[12px] font-medium"
            style={{ color: "var(--color-vsc-accent)" }}
          >
            Analysing…
          </p>
          <div
            className="w-full h-1.5 rounded-full overflow-hidden"
            style={{ background: "var(--color-vsc-input-bg)" }}
          >
            <div
              className="h-1.5 rounded-full transition-all duration-150"
              style={{
                width: `${Math.max(2, Math.round(progress * 100))}%`,
                background: "var(--color-vsc-accent)",
              }}
            />
          </div>
          <p
            className="text-[11px]"
            style={{ color: "var(--color-vsc-text-muted)" }}
          >
            {Math.round(progress * 100)}%
          </p>
        </div>
      )}

      {runState === "done" && result && (
        <div className="space-y-1 text-[12px]">
          <Row label="Min FOS">
            <span
              className="font-bold tabular-nums"
              style={{
                color:
                  result.minFOS < 1.0
                    ? "var(--color-vsc-error)"
                    : result.minFOS < 1.5
                      ? "var(--color-vsc-warning)"
                      : "var(--color-vsc-success)",
              }}
            >
              {result.minFOS.toFixed(3)}
            </span>
          </Row>
          <Row label="Max FOS">
            <span className="tabular-nums">{result.maxFOS.toFixed(3)}</span>
          </Row>
          <Row label="Method">{result.method}</Row>
          <Row label="Surfaces">
            <span className="tabular-nums">{result.allSurfaces.length}</span>
          </Row>
          <Row label="Elapsed">
            <span className="tabular-nums">
              {result.elapsedMs.toFixed(0)} ms
            </span>
          </Row>
          {result.nonConvergedSurfaces && result.nonConvergedSurfaces > 0 && (
            <Row label="Convergence">
              <span style={{ color: "var(--color-vsc-warning)" }}>
                {result.nonConvergedSurfaces} surface(s) with weak equilibrium
                fit
              </span>
            </Row>
          )}
          {result.splitFailureCount && result.splitFailureCount > 0 && (
            <Row label="Geometry Split">
              <span style={{ color: "var(--color-vsc-warning)" }}>
                {result.splitFailureCount} split operation(s) failed
              </span>
            </Row>
          )}
          {result.criticalSurface && (
            <div
              className="mt-2 p-2 rounded text-[11px]"
              style={{ background: "var(--color-vsc-list-hover)" }}
            >
              <p
                className="font-medium mb-1"
                style={{ color: "var(--color-vsc-text-bright)" }}
              >
                Critical Surface
              </p>
              <p>
                Centre: ({result.criticalSurface.cx.toFixed(2)},{" "}
                {result.criticalSurface.cy.toFixed(2)})
              </p>
              <p>Radius: {result.criticalSurface.radius.toFixed(2)} m</p>
            </div>
          )}
        </div>
      )}

      {runState === "error" && (
        <p
          className="text-[12px] font-medium"
          style={{ color: "var(--color-vsc-error)" }}
        >
          Error: {errorMessage}
        </p>
      )}
    </div>
  );
}
