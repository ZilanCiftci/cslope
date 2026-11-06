import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { readCsvDecimal, rememberCsvDecimal, type CsvDecimal } from "../../utils/csv-decimal";

const CHOICES: { value: CsvDecimal; label: string; title: string }[] = [
  { value: "point", label: "Decimal point (1.5)", title: "Commas between the values and decimal points" },
  {
    value: "comma",
    label: "Decimal comma (1,5)",
    title: "Semicolons between the values and decimal commas, for a spreadsheet set to a decimal-comma locale",
  },
];

/**
 * The "Export CSV" split button of the results windows (Sensitivity,
 * Probabilistic analysis, Results plot): the button exports with the
 * decimal separator chosen last; the chevron opens the two choices
 * (decimal point, decimal comma), and choosing one exports with it and
 * remembers it for every window. Closes on Escape or a click elsewhere.
 */
export function CsvExportButton({
  onExport,
  disabled,
}: {
  /** Write the file; `decimalComma` for the decimal-comma variant. */
  onExport: (decimalComma: boolean) => void;
  disabled?: boolean;
}) {
  const [decimal, setDecimal] = useState<CsvDecimal>(readCsvDecimal);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = CHOICES.find((c) => c.value === decimal)!;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // Close the menu, not the window.
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [open]);
  if (open && disabled) setOpen(false);

  const choose = (value: CsvDecimal) => {
    setDecimal(value);
    rememberCsvDecimal(value);
    setOpen(false);
    onExport(value === "comma");
  };

  return (
    <div className="relative inline-flex" ref={ref}>
      <button
        className="btn rounded-r-none"
        onClick={() => onExport(decimal === "comma")}
        disabled={disabled}
        title={`Save as CSV: ${current.title.charAt(0).toLowerCase()}${current.title.slice(1)}`}
      >
        Export CSV
      </button>
      <button
        className="btn rounded-l-none -ml-px px-1"
        onClick={() => setOpen((o) => !o)}
        disabled={disabled}
        aria-label="CSV decimal separator"
        aria-haspopup="menu"
        aria-expanded={open}
        title="Decimal point or decimal comma"
      >
        <ChevronDown size={12} strokeWidth={1.75} aria-hidden />
      </button>
      {open && (
        <div
          role="menu"
          aria-label="CSV decimal separator"
          className="absolute bottom-full left-0 mb-1 rounded py-1 z-50"
          style={{
            background: "var(--color-vsc-panel)",
            border: "1px solid var(--color-vsc-border)",
            boxShadow: "var(--color-vsc-shadow-float)",
            minWidth: 170,
          }}
        >
          {CHOICES.map((c) => (
            <button
              key={c.value}
              role="menuitemradio"
              aria-checked={c.value === decimal}
              title={c.title}
              onClick={() => choose(c.value)}
              className="w-full flex items-center gap-2 text-left px-3 py-1 text-[12px] whitespace-nowrap cursor-pointer hover:bg-[var(--color-vsc-list-hover)]"
              style={{ color: "var(--color-vsc-text)" }}
            >
              <span className="w-3 flex items-center justify-center" style={{ color: "var(--color-vsc-text-muted)" }} aria-hidden>
                {c.value === decimal && <Check size={12} strokeWidth={1.75} />}
              </span>
              {c.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
