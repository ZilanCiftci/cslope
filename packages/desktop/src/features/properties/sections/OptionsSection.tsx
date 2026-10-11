import { useState } from "react";
import type { AnalysisMethod, IntersliceFunctionType } from "@cslope/engine";
import { ITERATIONS_RANGE } from "@cslope/engine";
import { useAppStore } from "../../../store/app-store";
import { Section } from "../../../components/ui/Section";
import { Label } from "../../../components/ui/Label";
import { DraftNumberInput } from "../../../components/ui/DraftNumberInput";

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

interface OptionsSectionProps {
  plain?: boolean;
}

export function OptionsSection({ plain = false }: OptionsSectionProps) {
  const options = useAppStore((s) => s.options);
  const setOptions = useAppStore((s) => s.setOptions);
  const orientation = useAppStore((s) => s.orientation);
  const setOrientation = useAppStore((s) => s.setOrientation);
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

  // Keep numeric drafts in sync when options are hydrated from another window.
  // React-recommended render-time state adjustment pattern.
  const [prevOptions, setPrevOptions] = useState(options);
  if (
    prevOptions.slices !== options.slices ||
    prevOptions.iterations !== options.iterations ||
    prevOptions.refinedIterations !== options.refinedIterations ||
    prevOptions.tolerance !== options.tolerance
  ) {
    setPrevOptions(options);
    setSlicesDraft(String(options.slices));
    setIterationsDraft(String(options.iterations));
    setRefinedIterationsDraft(String(options.refinedIterations));
    setToleranceDraft(String(options.tolerance));
  }

  /**
   * While typing, store a value only when it is already valid, unclamped,
   * and record it as "seen" so the resync above does not overwrite the
   * text being typed.  Clamping happens on blur.
   */
  const commitWhileTyping = (
    field: "slices" | "iterations" | "refinedIterations" | "tolerance",
    raw: string,
    min: number,
    max: number,
    integer: boolean,
  ) => {
    if (raw.trim() === "") return;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed < min || parsed > max) return;
    const value = integer ? Math.round(parsed) : parsed;
    setPrevOptions((prev) => ({ ...prev, [field]: value }));
    setOptions({ [field]: value });
  };

  // Free-text data points: keep the typed text while editing.
  const [pointsDraft, setPointsDraft] = useState<string | null>(null);

  const slicesParsed = Number(slicesDraft);
  const iterationsParsed = Number(iterationsDraft);
  const refinedParsed = Number(refinedIterationsDraft);
  const toleranceParsed = Number(toleranceDraft);

  const slicesInvalid =
    slicesDraft.trim() === "" || slicesParsed < 10 || slicesParsed > 500;
  const iterationsInvalid =
    iterationsDraft.trim() === "" ||
    iterationsParsed < ITERATIONS_RANGE.min ||
    iterationsParsed > 100000;
  const refinedIterationsInvalid =
    refinedIterationsDraft.trim() === "" ||
    refinedParsed < 0 ||
    refinedParsed > 100000;
  const toleranceInvalid =
    toleranceDraft.trim() === "" ||
    toleranceParsed < 0.001 ||
    toleranceParsed > 0.1;

  const content = (
    <>
      <div className="grid grid-cols-2 gap-3 text-[12px]">
        <div className="col-span-2 flex flex-col gap-1">
          <Label>Analysis Direction</Label>
          <div className="grid grid-cols-2 gap-1">
            <button
              type="button"
              onClick={() => setOrientation("ltr")}
              className="px-2 py-1 rounded border text-[11px] font-medium cursor-pointer"
              style={{
                borderColor:
                  orientation === "ltr"
                    ? "var(--color-vsc-accent)"
                    : "var(--color-vsc-border)",
                background:
                  orientation === "ltr"
                    ? "color-mix(in srgb, var(--color-vsc-accent) 18%, transparent)"
                    : "var(--color-vsc-input-bg)",
                color: "var(--color-vsc-text)",
              }}
              aria-pressed={orientation === "ltr"}
              aria-label="Analysis direction left to right"
            >
              Left to right
            </button>
            <button
              type="button"
              onClick={() => setOrientation("rtl")}
              className="px-2 py-1 rounded border text-[11px] font-medium cursor-pointer"
              style={{
                borderColor:
                  orientation === "rtl"
                    ? "var(--color-vsc-accent)"
                    : "var(--color-vsc-border)",
                background:
                  orientation === "rtl"
                    ? "color-mix(in srgb, var(--color-vsc-accent) 18%, transparent)"
                    : "var(--color-vsc-input-bg)",
                color: "var(--color-vsc-text)",
              }}
              aria-pressed={orientation === "rtl"}
              aria-label="Analysis direction right to left"
            >
              Right to left
            </button>
          </div>
        </div>

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
              commitWhileTyping("slices", value, 10, 500, true);
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
            min={ITERATIONS_RANGE.min}
            max={ITERATIONS_RANGE.max}
            step={100}
            value={iterationsDraft}
            onChange={(e) => {
              const value = e.target.value;
              setIterationsDraft(value);
              commitWhileTyping(
                "iterations",
                value,
                ITERATIONS_RANGE.min,
                ITERATIONS_RANGE.max,
                true,
              );
            }}
            onBlur={(e) => {
              const parsed = Number(e.target.value);
              const normalized = Number.isFinite(parsed)
                ? Math.round(
                    clampNumber(
                      parsed,
                      ITERATIONS_RANGE.min,
                      ITERATIONS_RANGE.max,
                    ),
                  )
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
              commitWhileTyping("refinedIterations", value, 0, 100000, true);
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
              commitWhileTyping("tolerance", value, 0.001, 0.1, false);
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
        <label className="col-span-2 flex flex-col gap-0.5">
          <Label>Pore pressure below an inclined water line</Label>
          <select
            value={options.porePressureHead ?? "vertical"}
            onChange={(e) =>
              setOptions({
                porePressureHead: e.target.value as
                  | "phreatic-correction"
                  | "vertical",
              })
            }
            aria-label="Pore pressure head"
            title="Vertical head is what Slide and SLOPE/W use for a piezometric line. The cos²θ correction assumes a free phreatic surface with parallel flow and gives a higher FOS below a steep line."
          >
            <option value="vertical">Vertical head (Slide, SLOPE/W)</option>
            <option value="phreatic-correction">
              Phreatic correction (vertical head × cos²θ)
            </option>
          </select>
        </label>
        <label className="flex flex-col gap-0.5">
          <Label>Tension crack depth (m)</Label>
          <DraftNumberInput
            value={options.tensionCrackDepth ?? 0}
            min={0}
            step={0.1}
            onValueChange={(v) =>
              v >= 0 && setOptions({ tensionCrackDepth: v })
            }
            aria-label="Tension crack depth"
            title="Depth of a tension crack below the ground; the slip surface ends at the crack on the upslope side. 0 = no crack. Undrained: about 2·cu/γ."
          />
        </label>
        <label className="flex flex-col gap-0.5">
          <Label>Water in crack (%)</Label>
          <DraftNumberInput
            value={Math.round((options.tensionCrackWater ?? 0) * 100)}
            min={0}
            max={100}
            step={10}
            disabled={!(options.tensionCrackDepth! > 0)}
            onValueChange={(v) =>
              v >= 0 &&
              v <= 100 &&
              setOptions({ tensionCrackWater: v / 100 })
            }
            aria-label="Water in crack"
            title="Part of the crack depth filled with water; its hydrostatic thrust pushes the sliding mass."
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
                value={pointsDraft ?? interslicePointsValue}
                onChange={(e) => {
                  setPointsDraft(e.target.value);
                  setOptions({
                    intersliceDataPoints: parseInterslicePoints(e.target.value),
                  });
                }}
                onBlur={() => setPointsDraft(null)}
                placeholder="0,0; 0.2,0.6; 0.5,1; 0.8,0.6; 1,0"
                aria-label="Interslice data points"
              />
            </label>
          )}
      </div>
    </>
  );

  if (plain) {
    return <div className="space-y-2.5">{content}</div>;
  }

  return <Section title="Analysis Options">{content}</Section>;
}
