import type { ReactNode } from "react";
import type { TooltipContentProps } from "recharts";

type Props = Partial<TooltipContentProps<number | string, string>>;

/**
 * The tooltip of a chart in the result windows: the label, then one line
 * per series in the text color, with the series color only as a swatch,
 * so the text is readable whatever the series color. `formatValue`
 * formats a value (with the series name); `formatLabel` the x value.
 */
export function ChartTooltip({
  active,
  payload,
  label,
  formatValue,
  formatLabel,
}: Props & {
  formatValue: (value: unknown, name: string) => ReactNode;
  formatLabel: (label: unknown) => ReactNode;
}) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div
      className="px-2 py-1.5 rounded text-[11px] shadow-md"
      style={{
        background: "var(--color-vsc-input-bg)",
        border: "1px solid var(--color-vsc-border)",
        color: "var(--color-vsc-text)",
      }}
    >
      <div className="mb-0.5" style={{ color: "var(--color-vsc-text-muted)" }}>
        {formatLabel(label)}
      </div>
      {payload.map((entry, i) => (
        <div key={i} className="flex items-center gap-1.5 tabular-nums">
          <span
            aria-hidden
            className="inline-block w-2 h-2 rounded-[1px] shrink-0"
            style={{ background: entry.color ?? entry.stroke ?? entry.fill }}
          />
          <span>
            {String(entry.name ?? "")}: {formatValue(entry.value, String(entry.name ?? ""))}
          </span>
        </div>
      ))}
    </div>
  );
}
