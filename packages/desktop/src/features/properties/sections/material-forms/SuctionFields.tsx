import { Label } from "../../../../components/ui/Label";
import { DraftNumberInput } from "../../../../components/ui/DraftNumberInput";
import type { UnsaturatedStrength } from "@cslope/engine";
import { NO_SPINNER } from "./styles";

interface Props {
  phiB: number | undefined;
  maxSuction: number | undefined;
  onChange: (patch: UnsaturatedStrength) => void;
}

/**
 * Strength from matric suction above the material's water line: φb and an
 * optional largest suction. An empty φb (or 0) means none; an empty
 * maximum, no limit. The maximum is shown once φb is set (or when it is
 * already set, so it can be cleared).
 */
export function SuctionFields({ phiB, maxSuction, onChange }: Props) {
  return (
    <>
      <label
        className="flex flex-col gap-0.5"
        title="Strength from matric suction above the material's water line: (−u)·tan φb adds to c′. Empty or 0: none."
      >
        <Label>φb, suction (°)</Label>
        <DraftNumberInput
          value={phiB}
          min={0}
          max={89}
          placeholder="None"
          className={NO_SPINNER}
          onValueChange={(v) => {
            if (v >= 0 && v < 90) onChange({ phiB: v > 0 ? v : undefined });
          }}
          onClear={() => onChange({ phiB: undefined })}
          aria-label="φb (°)"
        />
      </label>
      {(phiB !== undefined || maxSuction !== undefined) && (
        <label
          className="flex flex-col gap-0.5"
          title="Largest matric suction taken into account. Empty: no limit."
        >
          <Label>Max suction (kPa)</Label>
          <DraftNumberInput
            value={maxSuction}
            min={0}
            placeholder="No limit"
            className={NO_SPINNER}
            onValueChange={(v) => {
              if (v > 0) onChange({ maxSuction: v });
            }}
            onClear={() => onChange({ maxSuction: undefined })}
            aria-label="Max suction (kPa)"
          />
        </label>
      )}
    </>
  );
}
