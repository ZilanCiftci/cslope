import { useAppStore } from "../../../store/app-store";
import { Section } from "../../../components/ui/Section";
import { Label } from "../../../components/ui/Label";
import { DraftNumberInput } from "../../../components/ui/DraftNumberInput";

interface SearchLimitsSectionProps {
  plain?: boolean;
}

export function SearchLimitsSection({
  plain = false,
}: SearchLimitsSectionProps) {
  const limits = useAppStore((s) => s.analysisLimits);
  const orientation = useAppStore((s) => s.orientation);
  const setLimits = useAppStore((s) => s.setAnalysisLimits);
  const coordinates = useAppStore((s) => s.coordinates);

  const xs = coordinates.map((c) => c[0]);
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const crestSide = orientation === "rtl" ? "right" : "left";
  const toeSide = orientation === "rtl" ? "left" : "right";

  const content = (
    <>
      <label className="flex items-center gap-2 text-[12px]">
        <input
          type="checkbox"
          checked={limits.enabled}
          onChange={(e) => setLimits({ enabled: e.target.checked })}
          className="accent-blue-500"
        />
        Restrict entry/exit ranges
      </label>
      {limits.enabled && (
        <div className="space-y-2 mt-1.5">
          <div
            className="text-[10px] font-bold uppercase tracking-[0.1em]"
            style={{ color: "var(--color-vsc-text-muted)" }}
          >
            Entry Range (crest side — {crestSide})
          </div>
          <div className="grid grid-cols-2 gap-2 text-[12px]">
            <label className="flex flex-col gap-0.5">
              <Label>Min X</Label>
              <DraftNumberInput
                step="0.5"
                value={limits.entryLeftX}
                onValueChange={(v) => setLimits({ entryLeftX: v })}
                aria-label="Entry minimum X"
              />
            </label>
            <label className="flex flex-col gap-0.5">
              <Label>Max X</Label>
              <DraftNumberInput
                step="0.5"
                value={limits.entryRightX}
                onValueChange={(v) => setLimits({ entryRightX: v })}
                aria-label="Entry maximum X"
              />
            </label>
          </div>
          <div
            className="text-[10px] font-bold uppercase tracking-[0.1em]"
            style={{ color: "var(--color-vsc-text-muted)" }}
          >
            Exit Range (toe side — {toeSide})
          </div>
          <div className="grid grid-cols-2 gap-2 text-[12px]">
            <label className="flex flex-col gap-0.5">
              <Label>Min X</Label>
              <DraftNumberInput
                step="0.5"
                value={limits.exitLeftX}
                onValueChange={(v) => setLimits({ exitLeftX: v })}
                aria-label="Exit minimum X"
              />
            </label>
            <label className="flex flex-col gap-0.5">
              <Label>Max X</Label>
              <DraftNumberInput
                step="0.5"
                value={limits.exitRightX}
                onValueChange={(v) => setLimits({ exitRightX: v })}
                aria-label="Exit maximum X"
              />
            </label>
          </div>
          <div
            className="text-[10px]"
            style={{ color: "var(--color-vsc-text-muted)" }}
          >
            X range: {xMin} – {xMax}
          </div>
        </div>
      )}
    </>
  );

  if (plain) {
    return <div className="space-y-2.5">{content}</div>;
  }

  return <Section title="Search Limits">{content}</Section>;
}
