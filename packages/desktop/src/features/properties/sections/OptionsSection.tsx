import { useState } from "react";
import type {
  AnalysisMethod,
  IntersliceFunctionType,
  PartialFactors,
} from "@cslope/engine";
import { EC7_DA3_FACTORS, ITERATIONS_RANGE } from "@cslope/engine";
import { useAppStore } from "../../../store/app-store";
import { Section } from "../../../components/ui/Section";
import { Label } from "../../../components/ui/Label";
import { DraftNumberInput } from "../../../components/ui/DraftNumberInput";
import { GroupHeading } from "../GroupHeading";
import { BlockSearchSection } from "./BlockSearchSection";

const METHODS: AnalysisMethod[] = ["Bishop", "Janbu", "Morgenstern-Price"];
const INTERSLICE_FUNCTIONS: IntersliceFunctionType[] = [
  "constant",
  "half-sine",
  "clipped-sine",
  "trapezoidal",
  "data-point-specified",
];
const INTERSLICE_FUNCTION_LABELS: Record<IntersliceFunctionType, string> = {
  constant: "Constant",
  "half-sine": "Half-sine",
  "clipped-sine": "Clipped sine",
  trapezoidal: "Trapezoidal",
  "data-point-specified": "Specified by data points",
};

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

  const directionButton = (
    value: "ltr" | "rtl",
    label: string,
    ariaLabel: string,
  ) => (
    <button
      type="button"
      onClick={() => setOrientation(value)}
      className="px-2 py-1 rounded border text-[11px] font-medium cursor-pointer"
      style={{
        borderColor:
          orientation === value
            ? "var(--color-vsc-accent)"
            : "var(--color-vsc-border)",
        background:
          orientation === value
            ? "color-mix(in srgb, var(--color-vsc-accent) 18%, transparent)"
            : "var(--color-vsc-input-bg)",
        color: "var(--color-vsc-text)",
      }}
      aria-pressed={orientation === value}
      aria-label={ariaLabel}
    >
      {label}
    </button>
  );

  const content = (
    <div className="space-y-3 text-[12px]">
      <section>
        <GroupHeading>Method</GroupHeading>
        <div className="grid grid-cols-2 gap-x-3 gap-y-2">
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
          {options.method === "Morgenstern-Price" && (
            <label className="flex flex-col gap-0.5">
              <Label>Interslice function</Label>
              <select
                value={intersliceFunction}
                onChange={(e) =>
                  setOptions({
                    intersliceFunction: e.target
                      .value as IntersliceFunctionType,
                  })
                }
                aria-label="Morgenstern-Price interslice function"
              >
                {INTERSLICE_FUNCTIONS.map((fn) => (
                  <option key={fn} value={fn}>
                    {INTERSLICE_FUNCTION_LABELS[fn]}
                  </option>
                ))}
              </select>
            </label>
          )}
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
          {options.method === "Morgenstern-Price" &&
            intersliceFunction === "data-point-specified" && (
              <label className="col-span-2 flex flex-col gap-0.5">
                <Label>Data points (x, f)</Label>
                <input
                  type="text"
                  value={pointsDraft ?? interslicePointsValue}
                  onChange={(e) => {
                    setPointsDraft(e.target.value);
                    setOptions({
                      intersliceDataPoints: parseInterslicePoints(
                        e.target.value,
                      ),
                    });
                  }}
                  onBlur={() => setPointsDraft(null)}
                  placeholder="0,0; 0.2,0.6; 0.5,1; 0.8,0.6; 1,0"
                  title="x from 0 at the left end to 1 at the right end of the slip surface, whatever the sliding direction"
                  aria-label="Interslice data points"
                />
              </label>
            )}
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
        </div>
      </section>

      <section>
        <GroupHeading>Search</GroupHeading>
        <div className="grid grid-cols-2 gap-x-3 gap-y-2">
          <div className="col-span-2 flex flex-col gap-1">
            <Label>Analysis direction</Label>
            <div className="grid grid-cols-2 gap-1">
              {directionButton(
                "ltr",
                "Left to right",
                "Analysis direction left to right",
              )}
              {directionButton(
                "rtl",
                "Right to left",
                "Analysis direction right to left",
              )}
            </div>
          </div>
          <label
            className="col-span-2 flex items-center gap-1.5"
            title="Also search for sliding in the opposite direction (with automatic search limits) and report the lower FOS."
          >
            <input
              type="checkbox"
              checked={options.bothDirections === true}
              onChange={(e) => setOptions({ bothDirections: e.target.checked })}
              aria-label="Analyse both directions"
            />
            <Label>Analyse both sliding directions</Label>
          </label>
          <label className="col-span-2 flex flex-col gap-0.5">
            <Label>Search method</Label>
            <select
              value={options.searchMethod ?? "circular"}
              onChange={(e) =>
                setOptions({ searchMethod: e.target.value as "circular" | "block" })
              }
              aria-label="Search method"
              title="Circular: circles through a grid of entry and exit points. Block: surfaces through block search objects (points, lines, windows), e.g. along a weak layer."
            >
              <option value="circular">Circular (grid of entry and exit points)</option>
              <option value="block">Block (through search objects)</option>
            </select>
          </label>
          {options.searchMethod === "block" && <BlockSearchSection />}
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
            <Label>Refined iterations</Label>
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
          <label
            className="col-span-2 flex items-center gap-1.5"
            title={
              options.searchMethod === "block"
                ? "After the block search, optimise the best block surfaces as free non-circular surfaces (they may leave the search objects)."
                : "After the circular search, optimise the best circles as non-circular surfaces, which can follow weak layers and stiff bases."
            }
          >
            <input
              type="checkbox"
              checked={options.nonCircularOptimization === true}
              onChange={(e) =>
                setOptions({ nonCircularOptimization: e.target.checked })
              }
              aria-label="Non-circular optimisation"
            />
            <Label>Non-circular optimisation</Label>
          </label>
          {options.method === "Bishop" &&
            options.nonCircularOptimization === true && (
              <p
                className="col-span-2 text-[10px] italic"
                style={{ color: "var(--color-vsc-text-muted)" }}
              >
                Bishop&apos;s method is defined for circular surfaces; on a
                non-circular surface its FOS depends on the moment axis. Use
                Morgenstern-Price (constant function for Spencer).
              </p>
            )}
          <label className="flex flex-col gap-0.5">
            <Label>Min. slip depth (m)</Label>
            <DraftNumberInput
              value={options.minSlipDepth ?? 0}
              min={0}
              step={0.5}
              onValueChange={(v) => v >= 0 && setOptions({ minSlipDepth: v })}
              aria-label="Minimum slip depth"
              title="Surfaces less deep than this below the ground are not analysed (e.g. shallow slivers under line loads). 0 = no limit."
            />
          </label>
          <label className="flex flex-col gap-0.5">
            <Label>Min. slip area (m²)</Label>
            <DraftNumberInput
              value={options.minSlipArea ?? undefined}
              min={0}
              step={0.5}
              placeholder="Auto"
              onValueChange={(v) => v >= 0 && setOptions({ minSlipArea: v })}
              onClear={() => setOptions({ minSlipArea: undefined })}
              aria-label="Minimum sliding area"
              title="Surfaces whose sliding mass is smaller than this are not analysed. Empty = automatic (1 % of the squared ground relief, e.g. 1 m² for a 10 m slope; skips micro-surfaces); 0 = no limit."
            />
          </label>
        </div>
      </section>

      <section>
        <GroupHeading>Water and tension crack</GroupHeading>
        <div className="grid grid-cols-2 gap-x-3 gap-y-2">
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
              title="Vertical head is the usual convention for a piezometric line. The cos²θ correction assumes a free phreatic surface with parallel flow and gives a higher FOS below a steep line."
            >
              <option value="vertical">Vertical head (conventional)</option>
              <option value="phreatic-correction">
                Phreatic correction (vertical head × cos²θ)
              </option>
            </select>
          </label>
          <label
            className="col-span-2 flex items-center gap-1.5"
            title="Crack depth from the soil just below the ground at each surface's entry: z = 2c/(γ√Ka) − q/γ, Ka = tan²(45° − φ/2); 2·cu/γ − q/γ for undrained clay. Uses the same (design) strengths as the analysis."
          >
            <input
              type="checkbox"
              checked={options.tensionCrackAuto === true}
              onChange={(e) =>
                setOptions({ tensionCrackAuto: e.target.checked })
              }
              aria-label="Automatic tension crack depth"
            />
            <Label>Tension crack depth from the soil (Rankine)</Label>
          </label>
          <label className="flex flex-col gap-0.5">
            <Label>Tension crack depth (m)</Label>
            <DraftNumberInput
              value={
                options.tensionCrackAuto
                  ? undefined
                  : (options.tensionCrackDepth ?? 0)
              }
              placeholder="Auto"
              min={0}
              step={0.1}
              disabled={options.tensionCrackAuto === true}
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
              disabled={
                !(options.tensionCrackDepth! > 0) && !options.tensionCrackAuto
              }
              onValueChange={(v) =>
                v >= 0 &&
                v <= 100 &&
                setOptions({ tensionCrackWater: v / 100 })
              }
              aria-label="Water in crack"
              title="Part of the crack depth filled with water; its hydrostatic thrust pushes the sliding mass."
            />
          </label>
        </div>
      </section>

      <section>
        <GroupHeading>Design</GroupHeading>
        <div className="grid grid-cols-2 gap-x-3 gap-y-2">
          <PartialFactorsFields
            factors={options.partialFactors ?? null}
            onChange={(partialFactors) => setOptions({ partialFactors })}
          />
        </div>
      </section>
    </div>
  );


  if (plain) {
    return <div className="space-y-2.5">{content}</div>;
  }

  return <Section title="Analysis Options">{content}</Section>;
}

/** Swedish practice (EKS / IEG): γcu 1.5, γc' = γφ' = 1.3; γQ 1.3. */
const SWEDISH_FACTORS: PartialFactors = {
  cu: 1.5,
  cohesion: 1.3,
  tanPhi: 1.3,
  variableLoad: 1.3,
};

const FACTOR_FIELDS: { key: keyof PartialFactors; label: string; title: string }[] = [
  { key: "cu", label: "γcu", title: "Partial factor on undrained shear strength" },
  { key: "cohesion", label: "γc'", title: "Partial factor on effective cohesion" },
  { key: "tanPhi", label: "γφ'", title: "Partial factor on tan φ'" },
  { key: "variableLoad", label: "γQ", title: "Partial factor on distributed and line loads" },
];

function PartialFactorsFields({
  factors,
  onChange,
}: {
  factors: PartialFactors | null;
  onChange: (factors: PartialFactors | null) => void;
}) {
  return (
    <div className="col-span-2 flex flex-col gap-2">
      <div className="grid grid-cols-2 gap-x-3 items-center">
        <label
          className="flex items-center gap-1.5"
          title="Divide strengths and multiply variable loads by partial factors (Eurocode 7). The FOS is then the over-design factor on design values: ≥ 1.0 satisfies the design."
        >
          <input
            type="checkbox"
            checked={factors !== null}
            onChange={(e) => onChange(e.target.checked ? { ...SWEDISH_FACTORS } : null)}
            aria-label="Partial factors"
          />
          <Label>Partial factors (design values)</Label>
        </label>
        {factors && (
          <select
            value=""
            onChange={(e) => {
              if (e.target.value === "se") onChange({ ...SWEDISH_FACTORS });
              if (e.target.value === "ec7") onChange({ ...EC7_DA3_FACTORS });
            }}
            aria-label="Partial factor preset"
            title="Fill in the factors of a design approach"
          >
            <option value="">Preset…</option>
            <option value="se">Swedish practice (EKS/IEG): 1.5 / 1.3 / 1.3 / 1.3</option>
            <option value="ec7">EN 1997-1 DA3, M2: 1.4 / 1.25 / 1.25 / 1.3</option>
          </select>
        )}
      </div>
      {factors && (
        <>
          <div className="grid grid-cols-4 gap-1">
            {FACTOR_FIELDS.map((f) => (
              <label key={f.key} className="flex flex-col gap-0.5" title={f.title}>
                <Label>{f.label}</Label>
                <DraftNumberInput
                  value={factors[f.key]}
                  min={0.1}
                  step={0.05}
                  onValueChange={(v) => v > 0 && onChange({ ...factors, [f.key]: v })}
                  aria-label={f.title}
                />
              </label>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
