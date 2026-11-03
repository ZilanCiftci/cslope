import { useAppStore } from "../../../store/app-store";
import { Label } from "../../../components/ui/Label";
import { DraftNumberInput } from "../../../components/ui/DraftNumberInput";
import { GroupHeading } from "../GroupHeading";
import { mainPiezoLine } from "../../../utils/piezo";

/** The level of a horizontal line, or null for any other line. */
function horizontalLevel(line: [number, number][]): number | null {
  return line.length >= 2 && line.every((p) => p[1] === line[0][1]) ? line[0][1] : null;
}

/** A horizontal water line at y across the model's x range. */
function levelLine(coordinates: [number, number][], y: number): [number, number][] {
  const xs = coordinates.map((c) => c[0]);
  const x0 = xs.length ? Math.min(...xs) : 0;
  const x1 = xs.length ? Math.max(...xs) : 1;
  return [
    [x0, y],
    [x1 > x0 ? x1 : x0 + 1, y],
  ];
}

/**
 * Rapid drawdown (three-stage, Duncan, Wright & Wong 1990): the water
 * before drawdown, as a level across the model or a line imported with
 * the model; the piezometric lines are the water after it.
 */
export function RapidDrawdownFields() {
  const piezo = useAppStore((s) => s.piezometricLine);
  const coordinates = useAppStore((s) => s.coordinates);
  const setRapidDrawdown = useAppStore((s) => s.setPiezoRapidDrawdown);
  const before = piezo.rapidDrawdown?.waterBefore;
  const level = before ? horizontalLevel(before) : null;

  const turnOn = () => {
    // Start from the highest water after drawdown, or the top of the ground.
    const main = mainPiezoLine({
      lines: piezo.lines.filter((l) => l.coordinates.length >= 2),
      mainLineId: piezo.mainLineId,
    });
    const ys = (main?.coordinates ?? coordinates).map((c) => c[1]);
    const y = ys.length ? Math.max(...ys) : 0;
    setRapidDrawdown({ waterBefore: levelLine(coordinates, y) });
  };

  return (
    <section>
      <GroupHeading>Rapid drawdown</GroupHeading>
      <div className="grid grid-cols-2 gap-x-3 gap-y-2">
        <label
          className="col-span-2 flex items-center gap-1.5"
          title="Three-stage rapid drawdown analysis (Duncan, Wright & Wong 1990): the piezometric lines are the water after drawdown. Materials with a drawdown strength (R envelope, cR, φR) do not drain: they take the undrained strength at their consolidation stresses under the water before drawdown (the drained strength where lower). The other materials drain."
        >
          <input
            type="checkbox"
            checked={before !== undefined}
            onChange={(e) => (e.target.checked ? turnOn() : setRapidDrawdown(undefined))}
            aria-label="Rapid drawdown"
          />
          <Label>Rapid drawdown (three-stage)</Label>
        </label>
        {before && level === null && (
          <div className="col-span-2 flex flex-col gap-0.5">
            <Label>Water before drawdown</Label>
            <div className="flex items-center gap-2 text-[11px]" data-testid="drawdown-imported-line">
              <span className="flex-1">Imported line ({before.length} points)</span>
              <button
                type="button"
                onClick={() =>
                  // Start the level at the highest point of the imported line.
                  setRapidDrawdown({ waterBefore: levelLine(coordinates, Math.max(...before.map((p) => p[1]))) })
                }
                className="px-2 py-0.5 text-[11px] font-medium rounded border cursor-pointer flex-shrink-0"
                style={{
                  background: "var(--color-vsc-surface-tint)",
                  color: "var(--color-vsc-text)",
                  borderColor: "var(--color-vsc-border)",
                }}
                title="Replace the imported line by a horizontal level across the model (at the line's highest point, then editable)"
              >
                Replace with level
              </button>
            </div>
          </div>
        )}
        {before && level !== null && (
          <label className="col-span-2 flex flex-col gap-0.5">
            <Label>Water level before drawdown (m)</Label>
            <DraftNumberInput
              value={level}
              step={0.5}
              onValueChange={(y) => setRapidDrawdown({ waterBefore: levelLine(coordinates, y) })}
              aria-label="Water level before drawdown"
              title="Level of the water (reservoir) before drawdown, across the model, for all materials."
            />
          </label>
        )}
      </div>
    </section>
  );
}
