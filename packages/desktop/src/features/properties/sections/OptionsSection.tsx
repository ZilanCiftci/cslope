import { useState } from "react";
import type {
  AnalysisMethod,
  IntersliceFunctionType,
  PartialFactors,
  SafetyClass,
  SwedishFactorBasis,
  Sgi3dSettings,
} from "@cslope/engine";
import { DEFAULT_FEM_SETTINGS, EC7_DA3_FACTORS, ITERATIONS_RANGE, SAFETY_CLASS_GAMMA_D, swedishPartialFactors } from "@cslope/engine";
import type { FemAnalysisSettings } from "@cslope/engine";
import { useAppStore } from "../../../store/app-store";
import { Section } from "../../../components/ui/Section";
import { Label } from "../../../components/ui/Label";
import { DraftNumberInput } from "../../../components/ui/DraftNumberInput";
import { parseDecimalText } from "../../../utils/decimal";
import { GroupHeading } from "../GroupHeading";
import { ExperimentalBadge } from "../../../components/ui/ExperimentalBadge";
import { FEM_EXPERIMENTAL_ADVICE } from "../../../constants";
import { BlockSearchSection } from "./BlockSearchSection";
import { RapidDrawdownFields } from "./RapidDrawdownFields";
import { LimitsDirectionWarning } from "../../analysis/LimitsDirectionWarning";

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
  // Water in the crack needs a crack: a depth, the automatic depth or a base angle.
  const crackSet =
    options.tensionCrackDepth! > 0 || options.tensionCrackAuto === true || options.tensionCrackAngle! > 0;
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
    const parsed = parseDecimalText(raw);
    if (!Number.isFinite(parsed) || parsed < min || parsed > max) return;
    const value = integer ? Math.round(parsed) : parsed;
    setPrevOptions((prev) => ({ ...prev, [field]: value }));
    setOptions({ [field]: value });
  };

  // Free-text data points: keep the typed text while editing.
  const [pointsDraft, setPointsDraft] = useState<string | null>(null);

  // "," or "." as the decimal separator; NaN (invalid) for anything else.
  const slicesParsed = parseDecimalText(slicesDraft);
  const iterationsParsed = parseDecimalText(iterationsDraft);
  const refinedParsed = parseDecimalText(refinedIterationsDraft);
  const toleranceParsed = parseDecimalText(toleranceDraft);

  const slicesInvalid =
    !Number.isFinite(slicesParsed) || slicesParsed < 10 || slicesParsed > 500;
  const iterationsInvalid =
    !Number.isFinite(iterationsParsed) ||
    iterationsParsed < ITERATIONS_RANGE.min ||
    iterationsParsed > 100000;
  const refinedIterationsInvalid =
    !Number.isFinite(refinedParsed) ||
    refinedParsed < 0 ||
    refinedParsed > 100000;
  const toleranceInvalid =
    !Number.isFinite(toleranceParsed) ||
    toleranceParsed < 0.001 ||
    toleranceParsed > 0.1;

  // One direction, or both: "both" analyses the model's direction and the
  // opposite one (with automatic search limits) and reports the lower FOS.
  const both = options.bothDirections === true;
  const directionButton = (
    value: "ltr" | "rtl" | "both",
    label: string,
    ariaLabel: string,
    title?: string,
  ) => {
    const pressed = value === "both" ? both : !both && orientation === value;
    return (
      <button
        type="button"
        onClick={() => {
          if (value === "both") setOptions({ bothDirections: true });
          else {
            setOrientation(value);
            if (both) setOptions({ bothDirections: false });
          }
        }}
        className="btn"
        aria-pressed={pressed}
        aria-label={ariaLabel}
        title={title}
      >
        {label}
      </button>
    );
  };

  const content = (
    <div className="space-y-3 text-[12px]">
      <section>
        <GroupHeading help={{ topic: "Method", page: "analysis#method" }}>Method</GroupHeading>
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
              type="text"
              inputMode="decimal"
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
                const parsed = parseDecimalText(e.target.value);
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
              type="text"
              inputMode="decimal"
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
                const parsed = parseDecimalText(e.target.value);
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
        <GroupHeading help={{ topic: "Search", page: "search#search-settings" }}>Search</GroupHeading>
        <div className="grid grid-cols-2 gap-x-3 gap-y-2">
          <div className="col-span-2 flex flex-col gap-1">
            <Label>Sliding direction</Label>
            <div className="grid grid-cols-3 gap-1">
              {directionButton("ltr", "Left to right", "Analysis direction left to right")}
              {directionButton("rtl", "Right to left", "Analysis direction right to left")}
              {directionButton(
                "both",
                "Both",
                "Analyze both directions",
                "Both directions: the model's own and the opposite one (with automatic search limits); the lower FOS governs.",
              )}
            </div>
          </div>
          <LimitsDirectionWarning />
          <label
            className="col-span-2 flex items-center gap-1.5"
            title="A circle that reaches impenetrable material (bedrock) follows its top there instead of being rejected, as on a firm base (composite surface). Off: such circles are not analyzed."
          >
            <input
              type="checkbox"
              checked={options.compositeSurfaces !== false}
              onChange={(e) => setOptions({ compositeSurfaces: e.target.checked })}
              aria-label="Composite surfaces along bedrock"
            />
            <Label>Composite surfaces along bedrock</Label>
          </label>
          <label
            className="col-span-2 flex items-center gap-1.5 pl-4"
            title="Circles also follow the base of the model where no impenetrable material lies on it, as on a firm stratum. Off (default): a circle through the base is not analyzed."
          >
            <input
              type="checkbox"
              checked={options.compositeSurfaces !== false && options.compositeBase === true}
              disabled={options.compositeSurfaces === false}
              onChange={(e) => setOptions({ compositeBase: e.target.checked })}
              aria-label="Composite surfaces along the model base"
            />
            <Label>Also along the model base</Label>
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
              type="text"
              inputMode="decimal"
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
                const parsed = parseDecimalText(e.target.value);
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
              type="text"
              inputMode="decimal"
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
                const parsed = parseDecimalText(e.target.value);
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
                ? "After the block search, optimize the best block surfaces as free non-circular surfaces (they may leave the search objects)."
                : "After the circular search, optimize the best circles as non-circular surfaces, which can follow weak layers and stiff bases."
            }
          >
            <input
              type="checkbox"
              checked={options.nonCircularOptimization === true}
              onChange={(e) =>
                setOptions({ nonCircularOptimization: e.target.checked })
              }
              aria-label="Non-circular optimization"
            />
            <Label>Non-circular optimization</Label>
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
              title="Surfaces less deep than this below the ground are not analyzed (e.g. shallow slivers under line loads). 0 = no limit."
            />
          </label>
          <label className="flex flex-col gap-0.5">
            <Label>Min. slip area (m²)</Label>
            <DraftNumberInput
              value={options.minSlipArea ?? 0}
              min={0}
              step={0.5}
              onValueChange={(v) => v >= 0 && setOptions({ minSlipArea: v })}
              onClear={() => setOptions({ minSlipArea: 0 })}
              aria-label="Minimum slip area"
              title="Smallest sliding mass analyzed: its cross-section area, m² per meter. 0 = no limit (default). A limit can hide a real small failure, such as a low cut at the toe."
            />
          </label>
          <label className="flex flex-col gap-0.5">
            <Label>Min. entry–exit distance (m)</Label>
            <DraftNumberInput
              value={options.minFailureDist ?? 0}
              min={0}
              step={0.5}
              onValueChange={(v) => v >= 0 && setOptions({ minFailureDist: v })}
              aria-label="Minimum entry–exit distance"
              title="Surfaces whose entry and exit points are closer than this (the straight distance between them) are not analyzed, for example thin slides in the edge of a cohesionless road bank. 0 = no limit."
            />
          </label>
        </div>
      </section>

      <section>
        <GroupHeading help={{ topic: "Water and tension crack", page: "analysis#tension-crack" }}>Water and tension crack</GroupHeading>
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
            <Label>Crack at base angle (°)</Label>
            <DraftNumberInput
              value={options.tensionCrackAngle ?? 0}
              min={0}
              max={89.9}
              step={5}
              onValueChange={(v) =>
                v >= 0 && v < 90 && setOptions({ tensionCrackAngle: v })
              }
              aria-label="Tension crack angle"
              title="Base inclination (°) above which the surface's steep upper end is cut off at a vertical crack; often 45° + φ/2 or about 60°. 0 = none (default)."
            />
          </label>
          <label className="flex flex-col gap-0.5">
            <Label>Water in crack (%)</Label>
            <DraftNumberInput
              value={Math.round((options.tensionCrackWater ?? 0) * 100)}
              min={0}
              max={100}
              step={10}
              disabled={!crackSet}
              onValueChange={(v) =>
                v >= 0 &&
                v <= 100 &&
                setOptions({ tensionCrackWater: v / 100 })
              }
              aria-label="Water in crack"
              title={
                crackSet
                  ? "Part of the crack depth filled with water; its hydrostatic thrust pushes the sliding mass."
                  : "Set a tension crack first: a crack depth, the automatic depth or a crack at base angle."
              }
            />
          </label>
        </div>
      </section>

      <RapidDrawdownFields />

      <section>
        <GroupHeading help={{ topic: "Seismic", page: "analysis#seismic-load-pseudostatic" }}>Seismic (pseudostatic)</GroupHeading>
        <div className="grid grid-cols-2 gap-x-3 gap-y-2">
          <label className="flex flex-col gap-0.5">
            <Label>kh (horizontal, + in the sliding direction)</Label>
            <DraftNumberInput
              value={options.seismicHorizontal ?? 0}
              min={0}
              max={1}
              step={0.05}
              onValueChange={(v) => v >= 0 && v <= 1 && setOptions({ seismicHorizontal: v })}
              aria-label="Horizontal seismic coefficient"
              title="Horizontal seismic coefficient: each slice carries kh × its weight horizontally in the sliding direction, at its center of gravity. 0 = none."
            />
          </label>
          <label className="flex flex-col gap-0.5">
            <Label>kv (+ downward)</Label>
            <DraftNumberInput
              value={options.seismicVertical ?? 0}
              min={-1}
              max={1}
              step={0.05}
              onValueChange={(v) => v >= -1 && v <= 1 && setOptions({ seismicVertical: v })}
              aria-label="Vertical seismic coefficient"
              title="Vertical seismic coefficient: kv × the slice weight acts vertically, positive downward (adds to the weight), negative upward. Check both signs. 0 = none."
            />
          </label>
        </div>
      </section>

      <section>
        <GroupHeading help={{ topic: "Design", page: "analysis#partial-factors" }}>Design</GroupHeading>
        <div className="grid grid-cols-2 gap-x-3 gap-y-2">
          <PartialFactorsFields
            factors={options.partialFactors ?? null}
            onChange={(partialFactors) => setOptions({ partialFactors })}
          />
          <Sgi3dFields settings={options.sgi3d} onChange={(sgi3d) => setOptions({ sgi3d })} />
        </div>
      </section>

      <section>
        <GroupHeading help={{ topic: "Finite elements", page: "analysis#finite-elements-experimental" }}>
          Finite elements
          <ExperimentalBadge />
        </GroupHeading>
        <FemFields
          settings={options.fem ?? DEFAULT_FEM_SETTINGS}
          onChange={(fem) => setOptions({ fem })}
        />
      </section>
    </div>
  );


  if (plain) {
    return <div className="space-y-2.5">{content}</div>;
  }

  return <Section title="Analysis options">{content}</Section>;
}

/** Swedish practice (EKS / IEG): γcu 1.5, γc' = γφ' = 1.3; γQ 1.3 (safety class 3, η = 1). */
const SWEDISH_FACTORS: PartialFactors = {
  cu: 1.5,
  cohesion: 1.3,
  tanPhi: 1.3,
  variableLoad: 1.3,
};

/** The Swedish set from safety class and η: safety class 2, η = 1, γQ = 1.3·γd to start with. */
const SWEDISH_BASIS: SwedishFactorBasis = { safetyClass: 2, etaCu: 1, etaDrained: 1, variableLoadBase: 1.3 };

type FactorKey = "cu" | "cohesion" | "tanPhi" | "variableLoad";

const FACTOR_FIELDS: { key: FactorKey; label: string; title: string }[] = [
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
  const basis = factors?.basis;
  const setBasis = (patch: Partial<SwedishFactorBasis>) => {
    // the inputs only take valid values (η > 0, the listed classes and factors)
    onChange(swedishPartialFactors({ ...(basis ?? SWEDISH_BASIS), ...patch }));
  };
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
              if (e.target.value === "se-class") onChange(swedishPartialFactors(SWEDISH_BASIS));
              if (e.target.value === "ec7") onChange({ ...EC7_DA3_FACTORS });
            }}
            aria-label="Partial factor preset"
            title="Fill in the factors of a design approach"
          >
            <option value="">Preset…</option>
            <option value="se">Swedish practice (EKS/IEG): 1.5 / 1.3 / 1.3 / 1.3</option>
            <option value="se-class">Swedish practice from safety class and η…</option>
            <option value="ec7">EN 1997-1 DA3, M2: 1.4 / 1.25 / 1.25 / 1.3</option>
          </select>
        )}
      </div>
      {factors && basis && (
        <div
          className="grid grid-cols-4 gap-1"
          title="Design values X_d = η X_k / γM (γM 1.5 on Su, 1.3 on c′ and tan φ′) and variable loads Q_d = γQ γd Q_k, γd = 0.83, 0.91, 1.0 in safety class 1, 2, 3. The governing document decides η and γQ."
        >
          <label className="flex flex-col gap-0.5">
            <Label>Safety class</Label>
            <select
              value={basis.safetyClass}
              onChange={(e) => setBasis({ safetyClass: Number(e.target.value) as SafetyClass })}
              aria-label="Safety class"
            >
              {([1, 2, 3] as const).map((k) => (
                <option key={k} value={k}>
                  SK{k} (γd {SAFETY_CLASS_GAMMA_D[k]})
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-0.5" title="Conversion factor η on the undrained shear strength: γcu = 1.5/η">
            <Label>η (Su)</Label>
            <DraftNumberInput value={basis.etaCu} min={0.1} step={0.05} onValueChange={(v) => v > 0 && setBasis({ etaCu: v })} aria-label="η on the undrained shear strength" />
          </label>
          <label className="flex flex-col gap-0.5" title="Conversion factor η on c′ and tan φ′: γc′ = γφ′ = 1.3/η">
            <Label>η (c′, φ′)</Label>
            <DraftNumberInput value={basis.etaDrained} min={0.1} step={0.05} onValueChange={(v) => v > 0 && setBasis({ etaDrained: v })} aria-label="η on c′ and tan φ′" />
          </label>
          <label className="flex flex-col gap-0.5" title="γQ = this factor × γd">
            <Label>γQ / γd</Label>
            <select value={basis.variableLoadBase} onChange={(e) => setBasis({ variableLoadBase: Number(e.target.value) })} aria-label="Load factor before γd">
              {[...new Set([1.3, 1.4, 1.5, basis.variableLoadBase])].sort((a, b) => a - b).map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
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
                  // a factor entered by hand: no longer formed from the safety class and η
                  onValueChange={(v) => {
                    if (!(v > 0)) return;
                    const next: PartialFactors = { ...factors, [f.key]: v };
                    delete next.basis;
                    onChange(next);
                  }}
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

/** 3D effects off; a stage of 15 m, infinitely overstrong adjacent stability when switched on. */
const SGI3D_DEFAULT: Sgi3dSettings = { enabled: false, length: 15, overstrongF2D: null, excludeMaterials: [] };

/**
 * 3D effects of a temporary slope after SGI's guidance: the stage length L,
 * the adjacent stretches' F2D (blank: infinitely overstrong) and the
 * materials left out of the end faces.
 */
function Sgi3dFields({
  settings,
  onChange,
}: {
  settings: Sgi3dSettings | undefined;
  onChange: (s: Sgi3dSettings) => void;
}) {
  const s = settings ?? SGI3D_DEFAULT;
  const set = (patch: Partial<Sgi3dSettings>) => onChange({ ...s, ...patch });
  // by name, as the engine takes them; materials of the same name are one entry
  const materialNames = [...new Set(useAppStore((st) => st.materials).map((m) => m.name))];
  return (
    <div className="col-span-2 flex flex-col gap-2">
      <label
        className="flex items-center gap-1.5"
        title="F3D of a temporary excavation opened in stages of length L (SGI Vägledning 8, 2024): the end faces' undrained strength added to each circle. Off by default."
      >
        <input type="checkbox" checked={s.enabled} onChange={(e) => set({ enabled: e.target.checked })} aria-label="3D effects (SGI)" />
        <Label>3D effects (SGI Vägledning 8)</Label>
      </label>
      {s.enabled && (
        <>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1">
            <label className="flex flex-col gap-0.5" title="Length of the critical stretch: the stage of the excavation open at a time (m)">
              <Label>Stage length L (m)</Label>
              <DraftNumberInput value={s.length} min={0.5} step={0.5} onValueChange={(v) => v > 0 && set({ length: v })} aria-label="Stage length L" />
            </label>
            <label
              className="flex flex-col gap-0.5"
              title="F2D,överstark,min of the adjacent stretches (eq. 2-4). Blank: infinitely overstrong adjacent stability (eq. 2-3)."
            >
              <Label>Adjacent F2D (blank: ∞)</Label>
              <DraftNumberInput
                min={0}
                step={0.05}
                value={s.overstrongF2D ?? undefined}
                onValueChange={(v) => v > 0 && set({ overstrongF2D: v })}
                onClear={() => set({ overstrongF2D: null })}
                aria-label="Adjacent F2D"
              />
            </label>
          </div>
          {materialNames.length > 0 && (
            <fieldset className="flex flex-col gap-0.5" title="Materials left out of the end faces, for example a fissured dry crust. Friction soil never counts.">
              <Label>Not in the end faces</Label>
              {materialNames.map((name) => (
                <label key={name} className="flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={s.excludeMaterials.includes(name)}
                    onChange={(e) =>
                      set({
                        excludeMaterials: e.target.checked
                          ? [...s.excludeMaterials, name]
                          : s.excludeMaterials.filter((n) => n !== name),
                      })
                    }
                    aria-label={`Leave ${name} out of the end faces`}
                  />
                  <span>{name}</span>
                </label>
              ))}
            </fieldset>
          )}
        </>
      )}
    </div>
  );
}

const FLOW_RULE_LABELS: Record<FemAnalysisSettings["flowRule"], string> = {
  "davis-b": "Davis B (recommended)",
  associated: "Associated (ψ = φ)",
  "non-associated": "Non-associated (ψ)",
};

/**
 * Strength reduction by finite elements: run after the limit equilibrium
 * analysis, its factor of safety and plastic zone shown with the result.
 */
function FemFields({
  settings,
  onChange,
}: {
  settings: FemAnalysisSettings;
  onChange: (s: FemAnalysisSettings) => void;
}) {
  const set = (patch: Partial<FemAnalysisSettings>) => onChange({ ...settings, ...patch });
  const off = !settings.enabled;
  const materialNames = useAppStore((s) => s.materials).map((m) => m.name);
  const k0 = settings.initialStress === "k0";
  const setStage = (name: string, stage: number) => {
    const stages = { ...(settings.materialStages ?? {}) };
    if (stage > 0) stages[name] = stage;
    else delete stages[name];
    set({ materialStages: Object.keys(stages).length ? stages : undefined });
  };
  return (
    <div className="grid grid-cols-2 gap-x-3 gap-y-2">
      <label
        className="col-span-2 flex items-center gap-1.5"
        title="Finite element strength reduction after the limit equilibrium analysis: c and tan φ reduced by F until equilibrium fails, with no slip surface assumed. Off by default."
      >
        <input
          type="checkbox"
          checked={settings.enabled}
          onChange={(e) => set({ enabled: e.target.checked })}
          aria-label="Strength reduction by finite elements"
        />
        <Label>Run strength reduction (FE)</Label>
      </label>
      <p
        className="col-span-2 text-[10px]"
        style={{ color: "var(--color-vsc-warning-text)" }}
        role="note"
        aria-label="Finite elements are experimental"
      >
        {FEM_EXPERIMENTAL_ADVICE}
      </p>
      {/* The settings only while the analysis is on. */}
      {settings.enabled && (
        <>
      <label className="col-span-2 flex flex-col gap-0.5">
        <Label>Flow rule</Label>
        <select
          value={settings.flowRule}
          disabled={off}
          onChange={(e) => set({ flowRule: e.target.value as FemAnalysisSettings["flowRule"] })}
          aria-label="Flow rule"
          title="Davis B (default): associated flow with strengths reduced for ψ; fast, stable, on the safe side. Non-associated: closer to other programs, several times slower, can oscillate."
        >
          {(Object.keys(FLOW_RULE_LABELS) as FemAnalysisSettings["flowRule"][]).map((r) => (
            <option key={r} value={r}>
              {FLOW_RULE_LABELS[r]}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-0.5">
        <Label>Solver</Label>
        <select
          value={settings.flowRule === "non-associated" ? settings.nonAssociatedSolver ?? "viscoplastic" : "newton"}
          disabled={off || settings.flowRule !== "non-associated"}
          onChange={(e) => set({ nonAssociatedSolver: e.target.value as "viscoplastic" | "newton" })}
          aria-label="Finite element solver"
          title="Solver for non-associated flow: the viscoplastic iteration of Griffiths & Lane (default) or Newton's method. Davis B and associated flow always use Newton's method."
        >
          <option value="viscoplastic">Viscoplastic</option>
          <option value="newton">Newton</option>
        </select>
      </label>
      <label className="flex flex-col gap-0.5">
        <Label>Convergence</Label>
        <select
          value={settings.flowRule === "non-associated" && settings.nonAssociatedSolver !== "newton" ? settings.convergence ?? "increment" : "increment"}
          disabled={off || settings.flowRule !== "non-associated" || settings.nonAssociatedSolver === "newton"}
          onChange={(e) => set({ convergence: e.target.value as "increment" | "equilibrium" })}
          aria-label="Convergence test"
          title="Convergence test of the viscoplastic iteration. Increment (default): displacement change below 10⁻⁴. Equilibrium: the load also balanced to 0.1 %, about 1.5 times the run time."
        >
          <option value="increment">Increment</option>
          <option value="equilibrium">Equilibrium</option>
        </select>
      </label>
      <label className="flex flex-col gap-0.5">
        <Label>Dilation angle ψ (°)</Label>
        <DraftNumberInput
          value={settings.dilationAngle}
          min={0}
          max={60}
          step={1}
          disabled={off || settings.flowRule === "associated"}
          onValueChange={(v) => v >= 0 && v <= 60 && set({ dilationAngle: v })}
          aria-label="Dilation angle"
          title="Dilation angle of every soil; at most φ. Usually 0 for clays and loose soils; for dense sands Bolton (1986) gives φ_peak − φ_cv ≈ 0.8ψ."
        />
      </label>
      <label className="flex flex-col gap-0.5">
        <Label>Element size (m)</Label>
        <DraftNumberInput
          value={settings.elementSize ?? undefined}
          min={0}
          step={0.5}
          placeholder="Auto"
          disabled={off}
          onValueChange={(v) => v > 0 && set({ elementSize: v })}
          onClear={() => set({ elementSize: null })}
          aria-label="Element size"
          title="Size of the first mesh. Empty: a twentieth of the model height, finer in thin layers."
        />
      </label>
      <label className="flex flex-col gap-0.5">
        <Label>Young&apos;s modulus E (kPa)</Label>
        <DraftNumberInput
          value={settings.youngsModulus}
          min={1}
          max={1e9}
          step={1000}
          disabled={off}
          onValueChange={(v) => v >= 1 && v <= 1e9 && set({ youngsModulus: v })}
          aria-label="Young's modulus"
          title="Stiffness of every soil. It scales the displacements and barely affects the factor of safety."
        />
      </label>
      <label className="flex flex-col gap-0.5">
        {/* In a serif italic: the UI font draws ν like a v. */}
        <Label>Poisson&apos;s ratio <span style={{ fontFamily: "'Times New Roman', Times, serif", fontStyle: "italic", fontSize: "1.15em" }}>ν</span></Label>
        <DraftNumberInput
          value={settings.poissonsRatio}
          min={0}
          max={0.49}
          step={0.05}
          disabled={off}
          onValueChange={(v) => v >= 0 && v <= 0.49 && set({ poissonsRatio: v })}
          aria-label="Poisson's ratio"
        />
      </label>
      <label className="flex flex-col gap-0.5">
        <Label>Mesh refinements</Label>
        <DraftNumberInput
          value={settings.refinementLevels}
          min={0}
          max={3}
          step={1}
          disabled={off || settings.flowRule === "non-associated"}
          onValueChange={(v) => v >= 0 && v <= 3 && set({ refinementLevels: Math.round(v) })}
          aria-label="Mesh refinements"
          title="Adaptive refinements where the plastic dissipation is largest, 0–3 (default 1); each roughly doubles the run time. Not with non-associated flow, computed on the first mesh."
        />
      </label>
      <label className="col-span-2 flex flex-col gap-0.5">
        <Label>Pore pressures (FE)</Label>
        <select
          value={settings.porePressure ?? "water-table"}
          disabled={off}
          onChange={(e) => set({ porePressure: e.target.value as "water-table" | "seepage" })}
          aria-label="Finite element pore pressures"
          title="From the water table (default), or steady seepage by finite elements, with the water table above the ground as reservoir and tail water (experimental)."
        >
          <option value="water-table">From the water table</option>
          <option value="seepage">Steady seepage (FE, experimental)</option>
        </select>
      </label>
      <label className="col-span-2 flex flex-col gap-0.5">
        <Label>Initial stresses</Label>
        <select
          value={settings.initialStress ?? "gravity"}
          disabled={off}
          onChange={(e) => set({ initialStress: e.target.value as "gravity" | "k0" })}
          aria-label="Initial stresses"
          title="Gravity loading (default): the weight in one step from zero stress. K0 procedure: horizontal stress K0 × vertical effective stress. Matters for non-associated flow only."
        >
          <option value="gravity">Gravity loading</option>
          <option value="k0">K0 procedure</option>
        </select>
      </label>
      <label className="flex flex-col gap-0.5">
        <Label>K0</Label>
        <DraftNumberInput
          value={settings.k0 ?? undefined}
          min={0.1}
          max={5}
          step={0.05}
          placeholder="1 − sin φ′"
          disabled={off || !k0}
          onValueChange={(v) => v > 0 && v <= 5 && set({ k0: v })}
          onClear={() => set({ k0: null })}
          aria-label="K0"
          title="Coefficient of earth pressure at rest for every soil. Empty: 1 − sin φ′ (Jaky), and ν/(1 − ν) for undrained and rigid materials. Overconsolidated clays can have K0 above 1."
        />
      </label>
      <label className="flex flex-col gap-0.5">
        <Label>Original ground (m)</Label>
        <DraftNumberInput
          value={settings.originalGroundLevel ?? undefined}
          step={0.5}
          placeholder="Present"
          disabled={off || !k0}
          onValueChange={(v) => Number.isFinite(v) && set({ originalGroundLevel: v })}
          onClear={() => set({ originalGroundLevel: null })}
          aria-label="Original ground level"
          title="For a cut slope: the ground level before the excavation. The K0 stresses are those under this level, and their out-of-balance force unloads the excavation. Empty: the present ground surface."
        />
      </label>
      <details className="col-span-2">
        <summary className="cursor-pointer text-[11px]" style={{ color: "var(--color-vsc-text-muted)" }}>
          Construction stages
          {settings.materialStages && Object.keys(settings.materialStages).length ? ` (${Object.keys(settings.materialStages).length} later)` : ""}
        </summary>
        <p className="my-1 text-[11px]" style={{ color: "var(--color-vsc-text-muted)" }}>
          Stage 0 is built first; each later stage is built on the one before, solved at F = 1 (e.g. an embankment in layers). The strength reduction starts from the last stage.
        </p>
        <div className="grid grid-cols-2 gap-x-3 gap-y-1">
          {materialNames.map((name) => (
            <label key={name} className="flex items-center justify-between gap-1.5">
              <span className="truncate text-[11px]" title={name}>
                {name}
              </span>
              <DraftNumberInput
                value={settings.materialStages?.[name] ?? 0}
                min={0}
                max={20}
                step={1}
                disabled={off}
                onValueChange={(v) => v >= 0 && v <= 20 && setStage(name, Math.round(v))}
                aria-label={`Construction stage of ${name}`}
                className="w-12"
              />
            </label>
          ))}
        </div>
      </details>
      <label
        className="flex items-center gap-1.5 self-end"
        title="No tensile effective stress (Rankine cut-off; on by default). Without it, cohesive soil carries tension near the crest and the factor of safety can come out several percent higher."
      >
        <input
          type="checkbox"
          checked={settings.tensionCutoff}
          disabled={off}
          onChange={(e) => set({ tensionCutoff: e.target.checked })}
          aria-label="Tension cut-off"
        />
        <Label>Tension cut-off</Label>
      </label>
      <label
        className="col-span-2 flex items-center gap-1.5"
        title="Lower and upper bounds of limit analysis (associated flow), refined until within 3 %; they are then the FE factor of safety. On in new projects; adds several minutes."
      >
        <input
          type="checkbox"
          checked={settings.limitAnalysis ?? false}
          disabled={off}
          onChange={(e) => set({ limitAnalysis: e.target.checked })}
          aria-label="Limit analysis bounds"
        />
        <Label>Limit analysis bounds (the FE factor of safety)</Label>
      </label>
        </>
      )}
    </div>
  );
}
