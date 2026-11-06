import { useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { Menu, MenuItem } from "./Menu";
import { useMenuDismiss } from "./menu-parts";
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
 * remembers it for every window. The shared `Menu`: closes on Escape or a
 * press elsewhere.
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

  useMenuDismiss(open, [ref], () => setOpen(false));
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
        <Menu
          label="CSV decimal separator"
          onClose={() => setOpen(false)}
          initialFocus="first"
          minWidth={170}
          className="absolute bottom-full left-0 mb-1 z-50"
        >
          {CHOICES.map((c) => (
            <MenuItem
              key={c.value}
              role="menuitemradio"
              checked={c.value === decimal}
              title={c.title}
              onClick={() => choose(c.value)}
            >
              {c.label}
            </MenuItem>
          ))}
        </Menu>
      )}
    </div>
  );
}
