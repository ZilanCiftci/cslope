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

export function OptionsSection() {
  const options = useAppStore((s) => s.options);
  const setOptions = useAppStore((s) => s.setOptions);
  const intersliceFunction = options.intersliceFunction ?? "half-sine";
  const interslicePointsValue = formatInterslicePoints(
    options.intersliceDataPoints,
  );

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
            value={options.slices}
            onChange={(e) =>
              setOptions({ slices: parseInt(e.target.value) || 25 })
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
            value={options.iterations}
            onChange={(e) =>
              setOptions({ iterations: parseInt(e.target.value) || 1000 })
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
            value={options.refinedIterations}
            onChange={(e) =>
              setOptions({ refinedIterations: parseInt(e.target.value) || 0 })
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
            value={options.tolerance}
            onChange={(e) =>
              setOptions({ tolerance: parseFloat(e.target.value) || 0.005 })
            }
            aria-label="Tolerance"
          />
        </label>
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
