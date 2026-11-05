import { Label } from "../../../../components/ui/Label";
import { DataPointTable } from "../../../../components/ui/DataPointTable";
import { HelpButton } from "../../../../components/ui/HelpButton";

/** Passive 0.82, direct 1.0, active 1.5 (relative to the direct shear strength). */
const DEFAULT_ANISOTROPY: [number, number][] = [
  [-45, 0.82],
  [0, 1],
  [60, 1.5],
];

interface Props {
  value: [number, number][] | undefined;
  onChange: (anisotropy: [number, number][] | undefined) => void;
}

/**
 * Anisotropy of an undrained shear strength: Su times a factor of the slice
 * base inclination α (positive in the active zone near the crest, negative
 * in the passive zone at the toe), off by default.
 */
export function AnisotropyField({ value, onChange }: Props) {
  const on = value !== undefined;
  return (
    <div className="col-span-2 space-y-1">
      <div className="flex items-center gap-1.5">
      <label
        className="flex items-center gap-1.5"
        title="Factor on Su by the slice base inclination α (°): positive α near the crest (active), negative at the toe (passive), interpolated. Off by default; finite elements take α = 0."
      >
        <input
          type="checkbox"
          checked={on}
          onChange={(e) => onChange(e.target.checked ? DEFAULT_ANISOTROPY.map((p) => [...p] as [number, number]) : undefined)}
          aria-label="Anisotropy"
        />
        <Label>Anisotropy (factor on Su by base inclination)</Label>
      </label>
      <HelpButton topic="Anisotropy" page="materials#anisotropy-of-the-undrained-strength" />
      </div>
      {on && (
        <DataPointTable
          headers={["α (°)", "Factor"]}
          rows={value.map(([a, f]) => [a, f])}
          onChange={(rows) => onChange(rows.length ? rows.map((r) => [r[0], r[1]] as [number, number]) : undefined)}
          minRows={2}
        />
      )}
    </div>
  );
}
