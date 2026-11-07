/**
 * A layer's color: a swatch button that opens a small grid of the layer
 * swatches (LAYER_COLORS), no free color. The arrow keys, Home and End move
 * in the grid, Enter or Space chooses, Escape or a press outside closes it;
 * the focus goes back to the button.
 */
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { ChevronDown } from "lucide-react";
import { LAYER_COLORS, layerColorName } from "@/templates/colors";

/** The swatches per row of the grid. */
const COLUMNS = 7;

/** A color swatch: the chosen color is data, drawn as chosen in both themes. */
export function Swatch({ color, className = "h-3.5 w-3.5" }: { color: string; className?: string }) {
  return <span aria-hidden="true" className={`inline-block shrink-0 rounded-sm border border-foreground/25 ${className}`} style={{ background: color }} />;
}

export interface ColorPickerProps {
  id: string;
  value: string;
  onChange: (color: string) => void;
  /** What the grid chooses the color of: "Color of Clay". */
  label: string;
  describedBy?: string;
}

export function ColorPicker({ id, value, onChange, label, describedBy }: ColorPickerProps) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const options = useRef<(HTMLDivElement | null)[]>([]);

  const show = () => {
    setActive(Math.max(0, LAYER_COLORS.findIndex((c) => c.color === value)));
    setOpen(true);
  };
  const close = (refocus = true) => {
    setOpen(false);
    if (refocus) button.current?.focus();
  };
  const choose = (color: string) => {
    onChange(color);
    close();
  };

  useEffect(() => {
    if (open) options.current[active]?.focus();
  }, [open, active]);

  // A press outside closes the grid (the focus stays where the press put it).
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  const onKeyDown = (e: KeyboardEvent) => {
    const n = LAYER_COLORS.length;
    const move: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -COLUMNS, ArrowDown: COLUMNS };
    if (e.key in move) {
      const next = active + move[e.key];
      if (next >= 0 && next < n) setActive(next);
    } else if (e.key === "Home") setActive(0);
    else if (e.key === "End") setActive(n - 1);
    else if (e.key === "Enter" || e.key === " ") choose(LAYER_COLORS[active].color);
    else if (e.key === "Escape") close();
    else if (e.key === "Tab") {
      setOpen(false);
      return;
    } else return;
    e.preventDefault();
    e.stopPropagation();
  };

  return (
    <div ref={root} className="relative">
      <button
        ref={button}
        id={id}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-describedby={describedBy}
        onClick={() => (open ? close() : show())}
        className="flex h-8 w-full items-center gap-2 rounded-md border border-input bg-background px-2 text-left text-sm"
      >
        <Swatch color={value} className="h-4 w-4" />
        <span className="min-w-0 flex-1 truncate">{layerColorName(value)}</span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" strokeWidth={1.75} aria-hidden="true" />
      </button>
      {open && (
        <div
          id={listId}
          role="listbox"
          aria-label={label}
          aria-orientation="horizontal"
          onKeyDown={onKeyDown}
          className="absolute right-0 z-20 mt-1 grid w-max grid-cols-7 gap-1 rounded-md border bg-popover p-1.5 shadow-md"
        >
          {LAYER_COLORS.map((c, i) => (
            <div
              key={c.color}
              ref={(el) => {
                options.current[i] = el;
              }}
              role="option"
              aria-selected={c.color === value}
              aria-label={c.name}
              title={c.name}
              tabIndex={i === active ? 0 : -1}
              onClick={() => choose(c.color)}
              onFocus={() => setActive(i)}
              className="grid h-7 w-7 cursor-pointer place-items-center rounded-sm outline-none ring-ring hover:ring-1 focus-visible:ring-2 aria-selected:ring-2 aria-selected:ring-primary"
            >
              <Swatch color={c.color} className="h-5 w-5" />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
