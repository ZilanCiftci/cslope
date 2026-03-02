import { useState } from "react";
import type { AnalysisMethod, IntersliceFunctionType } from "@cslope/engine";
import { useAppStore } from "../../../store/app-store";
import { Section } from "../../../components/ui/Section";
import { Label } from "../../../components/ui/Label";

const METHODS: AnalysisMethod[] = ["Bishop", "Janbu", "Morgenstern-Price"];
const INTERSLICE_FUNCTIONS: IntersliceFunctionType[] = [
  "constant",
  "half-sine",
  "clipped-sine",
  "trapezoidal",
  "data-point-specified",
];

function parseInterslicePoints(input: string): [number, number][] {
  return input
    .split(";")
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => {
      const [xRaw, yRaw] = chunk.split(",").map((v) => v.trim());
      const x = Number(xRaw);
      const y = Number(yRaw);
      return [x, y] as [number, number];
    })
    .filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
}

function formatInterslicePoints(
  points: [number, number][] | undefined,
): string {
  if (!points || points.length === 0) return "";
  return points.map(([x, y]) => `${x},${y}`).join("; ");
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function OptionsSection() {
  const options = useAppStore((s) => s.options);
  const setOptions = useAppStore((s) => s.setOptions);
  const intersliceFunction = options.intersliceFunction ?? "half-sine";
  const interslicePointsValue = formatInterslicePoints(
    options.intersliceDataPoints,
  );

  const [slicesDraft, setSlicesDraft] = useState(String(options.slices));
  const [iterationsDraft, setIterationsDraft] = useState(
    String(options.iterations),
  );
  const [refinedIterationsDraft, setRefinedIterationsDraft] = useState(
    String(options.refinedIterations),
  );
  const [toleranceDraft, setToleranceDraft] = useState(
    String(options.tolerance),
  );

  const slicesParsed = Number(slicesDraft);
  const iterationsParsed = Number(iterationsDraft);
  const refinedParsed = Number(refinedIterationsDraft);
  const toleranceParsed = Number(toleranceDraft);

  const slicesInvalid =
    slicesDraft.trim() === "" || slicesParsed < 10 || slicesParsed > 500;
  const iterationsInvalid =
    iterationsDraft.trim() === "" ||
    iterationsParsed < 100 ||
    iterationsParsed > 100000;
  const refinedIterationsInvalid =
    refinedIterationsDraft.trim() === "" ||
    refinedParsed < 0 ||
    refinedParsed > 100000;
  const toleranceInvalid =
    toleranceDraft.trim() === "" ||
    toleranceParsed < 0.001 ||
    toleranceParsed > 0.1;

  return (
    <Section title="Analysis Options">
      <div className="grid grid-cols-2 gap-3 text-[12px]">
        <label className="flex flex-col gap-0.5">
          <Label>Method</Label>
          <select
            value={options.method}
            onChange={(e) =>
              setOptions({ method: e.target.value as AnalysisMethod })
            }
            aria-label="Analysis method"
          >
            {METHODS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-0.5">
          <Label>Slices</Label>
          <input
            type="number"
            min={10}
            max={500}
            step={5}
            value={slicesDraft}
            onChange={(e) => {
              const value = e.target.value;
              setSlicesDraft(value);
              const parsed = Number(value);
              if (!Number.isFinite(parsed)) return;
              setOptions({ slices: Math.round(clampNumber(parsed, 10, 500)) });
            }}
            onBlur={(e) => {
              const parsed = Number(e.target.value);
              const normalized = Number.isFinite(parsed)
                ? Math.round(clampNumber(parsed, 10, 500))
                : options.slices;
              setOptions({ slices: normalized });
              setSlicesDraft(String(normalized));
            }}
            aria-invalid={slicesInvalid}
            style={
              slicesInvalid
                ? { borderColor: "var(--color-vsc-error)" }
                : undefined
            }
            aria-label="Number of slices"
          />
        </label>
        <label className="flex flex-col gap-0.5">
          <Label>Iterations</Label>
          <input
            type="number"
            min={100}
            max={100000}
            step={100}
            value={iterationsDraft}
            onChange={(e) => {
              const value = e.target.value;
              setIterationsDraft(value);
              const parsed = Number(value);
              if (!Number.isFinite(parsed)) return;
              setOptions({
                iterations: Math.round(clampNumber(parsed, 100, 100000)),
              });
            }}
            onBlur={(e) => {
              const parsed = Number(e.target.value);
              const normalized = Number.isFinite(parsed)
                ? Math.round(clampNumber(parsed, 100, 100000))
                : options.iterations;
              setOptions({ iterations: normalized });
              setIterationsDraft(String(normalized));
            }}
            aria-invalid={iterationsInvalid}
            style={
              iterationsInvalid
                ? { borderColor: "var(--color-vsc-error)" }
                : undefined
            }
            aria-label="Number of iterations"
          />
        </label>
        <label className="flex flex-col gap-0.5">
          <Label>Refined Iterations</Label>
          <input
            type="number"
            min={0}
            max={100000}
            step={50}
            value={refinedIterationsDraft}
            onChange={(e) => {
              const value = e.target.value;
              setRefinedIterationsDraft(value);
              const parsed = Number(value);
              if (!Number.isFinite(parsed)) return;
              setOptions({
                refinedIterations: Math.round(clampNumber(parsed, 0, 100000)),
              });
            }}
            onBlur={(e) => {
              const parsed = Number(e.target.value);
              const normalized = Number.isFinite(parsed)
                ? Math.round(clampNumber(parsed, 0, 100000))
                : options.refinedIterations;
              setOptions({ refinedIterations: normalized });
              setRefinedIterationsDraft(String(normalized));
            }}
            aria-invalid={refinedIterationsInvalid}
            style={
              refinedIterationsInvalid
                ? { borderColor: "var(--color-vsc-error)" }
                : undefined
            }
            aria-label="Number of refined iterations"
          />
        </label>
        <label className="flex flex-col gap-0.5">
          <Label>Tolerance</Label>
          <input
            type="number"
            min={0.001}
            max={0.1}
            step={0.001}
            value={toleranceDraft}
            onChange={(e) => {
              const value = e.target.value;
              setToleranceDraft(value);
              const parsed = Number(value);
              if (!Number.isFinite(parsed)) return;
              setOptions({ tolerance: clampNumber(parsed, 0.001, 0.1) });
            }}
            onBlur={(e) => {
              const parsed = Number(e.target.value);
              const normalized = Number.isFinite(parsed)
                ? clampNumber(parsed, 0.001, 0.1)
                : options.tolerance;
              setOptions({ tolerance: normalized });
              setToleranceDraft(String(normalized));
            }}
            aria-invalid={toleranceInvalid}
            style={
              toleranceInvalid
                ? { borderColor: "var(--color-vsc-error)" }
                : undefined
            }
            aria-label="Tolerance"
          />
        </label>
        {options.method === "Janbu" && (
          <label className="col-span-2 flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={options.janbuCorrection ?? false}
              onChange={(e) =>
                setOptions({ janbuCorrection: e.target.checked })
              }
              aria-label="Apply Janbu correction factor"
            />
            <Label>
              Apply correction factor f<sub>0</sub>
            </Label>
          </label>
        )}
        {options.method === "Morgenstern-Price" && (
          <label className="flex flex-col gap-0.5">
            <Label>Interslice Function</Label>
            <select
              value={intersliceFunction}
              onChange={(e) =>
                setOptions({
                  intersliceFunction: e.target.value as IntersliceFunctionType,
                })
              }
              aria-label="Morgenstern-Price interslice function"
            >
              {INTERSLICE_FUNCTIONS.map((fn) => (
                <option key={fn} value={fn}>
                  {fn}
                </option>
              ))}
            </select>
          </label>
        )}
        {options.method === "Morgenstern-Price" &&
          intersliceFunction === "data-point-specified" && (
            <label className="col-span-2 flex flex-col gap-0.5">
              <Label>Data Points (x,f)</Label>
              <input
                type="text"
                value={interslicePointsValue}
                onChange={(e) =>
                  setOptions({
                    intersliceDataPoints: parseInterslicePoints(e.target.value),
                  })
                }
                placeholder="0,0; 0.2,0.6; 0.5,1; 0.8,0.6; 1,0"
                aria-label="Interslice data points"
              />
            </label>
          )}
      </div>
    </Section>
  );
}
