import { Label } from "../../../../components/ui/Label";
import { DraftNumberInput } from "../../../../components/ui/DraftNumberInput";
import { NO_SPINNER } from "./styles";

interface Props {
  /** B̄ of the material; undefined: no excess pore pressure. */
  bBar: number | undefined;
  /** Whether the material's weight is a fill raising the pore pressure below. */
  bBarLoad: boolean | undefined;
  onChange: (patch: { bBar?: number; bBarLoad?: boolean }) => void;
}

/**
 * Excess pore pressure from a fill, common to every material model: B̄ of
 * the material (the excess pore pressure at a slice base in it is B̄ times
 * the vertical stress of the fill above), and whether the material's own
 * weight is such a fill. An empty B̄ field means none.
 */
export function BBarFields({ bBar, bBarLoad, onChange }: Props) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <label
        className="flex flex-col gap-0.5"
        title="Excess pore pressure at a slice base in this material: B̄ times the vertical stress of the fill above it (the materials whose weight raises pore pressure), added to the pore pressure of its water line. 0 to 1.5. Empty: none."
      >
        <Label>B̄ (excess pore pressure from fill)</Label>
        <DraftNumberInput
          value={bBar}
          min={0}
          max={1.5}
          step={0.1}
          placeholder="None"
          className={NO_SPINNER}
          onValueChange={(v) => {
            if (v >= 0) onChange({ bBar: v });
          }}
          onClear={() => onChange({ bBar: undefined })}
          aria-label="B̄ (excess pore pressure from fill)"
        />
      </label>
      <label
        className="flex items-center gap-1.5 self-end pb-1"
        title="The weight of this material (a fill) raises the pore pressure of the materials with B̄ below it."
      >
        <input
          type="checkbox"
          checked={bBarLoad === true}
          onChange={(e) => onChange({ bBarLoad: e.target.checked ? true : undefined })}
          aria-label="Weight raises pore pressure below (fill, B̄)"
        />
        <Label>Weight raises pore pressure below (fill, B̄)</Label>
      </label>
    </div>
  );
}
