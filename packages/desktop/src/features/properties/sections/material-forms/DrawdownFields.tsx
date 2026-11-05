import { Label } from "../../../../components/ui/Label";
import { DraftNumberInput } from "../../../../components/ui/DraftNumberInput";
import { HelpButton } from "../../../../components/ui/HelpButton";
import type { MohrCoulombModel } from "@cslope/engine";
import { NO_SPINNER } from "./styles";

type DrawdownEnvelope = NonNullable<MohrCoulombModel["drawdownStrength"]>;

interface Props {
  /** The drawdown (R) envelope; undefined: the soil drains freely. */
  drawdownStrength: DrawdownEnvelope | undefined;
  /** The effective envelope, the starting values when the envelope is turned on. */
  cohesion: number;
  frictionAngle: number;
  onChange: (patch: { drawdownStrength?: DrawdownEnvelope }) => void;
}

/**
 * The drawdown (R) envelope of a Mohr-Coulomb soil that does not drain in
 * a rapid drawdown (cR, φR: consolidated-undrained tests on isotropically
 * consolidated samples). Used when the model has a rapid drawdown
 * analysis; without it the soil is free-draining.
 */
export function DrawdownFields({ drawdownStrength, cohesion, frictionAngle, onChange }: Props) {
  const r = drawdownStrength;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1.5">
      <label
        className="flex items-center gap-1.5"
        title="Undrained during a rapid drawdown: takes the three-stage undrained strength from its drawdown envelope (cR, φR). Off (default): free-draining."
      >
        <input
          type="checkbox"
          checked={r !== undefined}
          onChange={(e) =>
            onChange({
              drawdownStrength: e.target.checked
                ? { cohesion: Math.max(0, cohesion), frictionAngle: Math.min(89, Math.max(0, frictionAngle)) }
                : undefined,
            })
          }
          aria-label="Drawdown strength (R envelope, cR, φR)"
        />
        <Label>Drawdown strength (R envelope, cR, φR)</Label>
      </label>
      <HelpButton topic="Drawdown strength" page="materials#drawdown-envelope-rapid-drawdown" />
      </div>
      {r && (
        <div className="grid grid-cols-2 gap-2" aria-label="Drawdown envelope (R)">
          <label className="flex flex-col gap-0.5" title="Cohesion intercept cR of the drawdown strength (R envelope).">
            <Label>cR (kPa)</Label>
            <DraftNumberInput
              value={r.cohesion}
              min={0}
              className={NO_SPINNER}
              onValueChange={(v) => {
                if (v >= 0) onChange({ drawdownStrength: { ...r, cohesion: v } });
              }}
              aria-label="cR (kPa)"
            />
          </label>
          <label className="flex flex-col gap-0.5" title="Friction angle φR of the drawdown strength (R envelope), 0° to 90°.">
            <Label>φR (°)</Label>
            <DraftNumberInput
              value={r.frictionAngle}
              min={0}
              max={89}
              className={NO_SPINNER}
              onValueChange={(v) => {
                if (v >= 0 && v < 90) onChange({ drawdownStrength: { ...r, frictionAngle: v } });
              }}
              aria-label="φR (°)"
            />
          </label>
        </div>
      )}
    </div>
  );
}
