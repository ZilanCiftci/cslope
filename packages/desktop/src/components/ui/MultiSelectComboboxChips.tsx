import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export type MultiSelectOption = {
  value: string;
  label: string;
};

type MultiSelectComboboxChipsProps = {
  options: MultiSelectOption[];
  value: string[];
  onValueChange: (next: string[]) => void;
  placeholder?: string;
  emptyText?: string;
};

/* ── Inline SVG micro-icons (no deps needed) ──────────── */

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      style={{
        transition: "transform 150ms ease",
        transform: open ? "rotate(180deg)" : "rotate(0deg)",
        flexShrink: 0,
      }}
    >
      <path
        d="M4.5 6.5L8 10l3.5-3.5"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 16 16" fill="none">
      <path
        d="M4 4l8 8M12 4l-8 8"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
      <path
        d="M3.5 8.5l3 3 6-6.5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/* ── Component ────────────────────────────────────────── */

export function MultiSelectComboboxChips({
  options,
  value,
  onValueChange,
  placeholder = "Select items",
  emptyText = "No items found.",
}: MultiSelectComboboxChipsProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlightedIndex, setHighlightedIndex] = useState(0);

  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dropTarget, setDropTarget] = useState<{
    index: number;
    side: "left" | "right";
  } | null>(null);
  const dragIndexRef = useRef<number | null>(null);

  const handleDragStart = useCallback(
    (idx: number) => (e: React.DragEvent) => {
      setDragIndex(idx);
      dragIndexRef.current = idx;
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("application/x-chip-index", String(idx));
      e.dataTransfer.setData("text/plain", String(idx));
    },
    [],
  );

  const handleDragOver = useCallback(
    (idx: number) => (e: React.DragEvent) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const midX = rect.left + rect.width / 2;
      const side: "left" | "right" = e.clientX < midX ? "left" : "right";
      setDropTarget((prev) =>
        prev?.index === idx && prev.side === side ? prev : { index: idx, side },
      );

      const from = dragIndexRef.current;
      if (from == null) return;
      let to = side === "right" ? idx + 1 : idx;
      if (from < to) to -= 1;
      if (from === to) return;

      const next = [...value];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      dragIndexRef.current = to;
      setDragIndex(to);
      onValueChange(next);
    },
    [value, onValueChange],
  );

  const handleDrop = useCallback(
    (_idx: number) => (e: React.DragEvent) => {
      e.preventDefault();
      setDragIndex(null);
      setDropTarget(null);
      dragIndexRef.current = null;
    },
    [],
  );

  const handleDragEnd = useCallback(() => {
    setDragIndex(null);
    setDropTarget(null);
    dragIndexRef.current = null;
  }, []);

  const selectedSet = useMemo(() => new Set(value), [value]);

  const filteredOptions = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((opt) => opt.label.toLowerCase().includes(q));
  }, [options, query]);

  // Reset highlight when filter/open state changes
  useEffect(() => {
    setHighlightedIndex(0);
  }, [query, open]);

  // Scroll highlighted row into view
  useEffect(() => {
    if (!open || !listRef.current) return;
    const row = listRef.current.children[highlightedIndex] as HTMLElement;
    row?.scrollIntoView({ block: "nearest" });
  }, [highlightedIndex, open]);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const toggleValue = (v: string) => {
    if (selectedSet.has(v)) {
      onValueChange(value.filter((x) => x !== v));
    } else {
      onValueChange([...value, v]);
    }
  };

  const selectHighlighted = () => {
    if (filteredOptions.length === 0) return;
    const idx = Math.min(highlightedIndex, filteredOptions.length - 1);
    toggleValue(filteredOptions[idx].value);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      setOpen(false);
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      setHighlightedIndex((i) => Math.min(i + 1, filteredOptions.length - 1));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      setHighlightedIndex((i) => Math.max(0, i - 1));
      return;
    }
    if (e.key === "Backspace" && query.length === 0 && value.length > 0) {
      onValueChange(value.slice(0, -1));
      return;
    }
    if (e.key === "Enter" && open && filteredOptions.length > 0) {
      e.preventDefault();
      selectHighlighted();
    }
  };

  return (
    <div className="relative" ref={rootRef}>
      {/* ── Trigger shell ─────────────────────────────── */}
      <div
        role="combobox"
        aria-expanded={open}
        onClick={() => {
          setOpen(true);
          inputRef.current?.focus();
        }}
        className="w-full rounded-lg border min-h-[32px] cursor-text"
        style={{
          background: "var(--color-vsc-input-bg)",
          borderColor: open
            ? "var(--color-vsc-accent)"
            : "var(--color-vsc-input-border)",
          boxShadow: open ? "0 0 0 2px rgba(0,120,212,0.18)" : "none",
          transition: "border-color 100ms, box-shadow 100ms",
        }}
      >
        <div
          className="flex flex-wrap items-center gap-1 px-1.5 py-1"
          onDragOver={(e) => e.preventDefault()}
        >
          {/* ── Chips ──────────────────────────────────── */}
          {value.map((v, i) => {
            const opt = options.find((o) => o.value === v);
            if (!opt) return null;
            const isDragging = dragIndex === i;
            const showLeft =
              dropTarget?.index === i &&
              dropTarget.side === "left" &&
              dragIndex !== i;
            const showRight =
              dropTarget?.index === i &&
              dropTarget.side === "right" &&
              dragIndex !== i;
            return (
              <span
                key={v}
                draggable
                onDragStart={handleDragStart(i)}
                onDragOver={handleDragOver(i)}
                onDrop={handleDrop(i)}
                onDragEnd={handleDragEnd}
                className="inline-flex items-center gap-0.5 rounded-md pl-2 pr-1 py-[1px] text-[10px] font-medium select-none"
                style={{
                  position: "relative",
                  background: "var(--color-vsc-surface-tint-strong)",
                  border: "1px solid var(--color-vsc-border)",
                  color: "var(--color-vsc-text)",
                  opacity: isDragging ? 0.4 : 1,
                  cursor: "grab",
                  boxShadow: showLeft
                    ? "inset 2px 0 0 0 var(--color-vsc-accent)"
                    : showRight
                      ? "inset -2px 0 0 0 var(--color-vsc-accent)"
                      : "none",
                }}
              >
                {opt.label}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onValueChange(value.filter((x) => x !== v));
                  }}
                  className="inline-flex items-center justify-center rounded w-[14px] h-[14px] ml-0.5 cursor-pointer"
                  style={{
                    color: "var(--color-vsc-text-muted)",
                    opacity: 0.6,
                  }}
                  aria-label={`Remove ${opt.label}`}
                >
                  <CloseIcon />
                </button>
              </span>
            );
          })}

          {/* ── Filter input ───────────────────────────── */}
          <input
            ref={inputRef}
            value={query}
            onFocus={() => setOpen(true)}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
            }}
            onKeyDown={handleKeyDown}
            placeholder={value.length === 0 ? placeholder : ""}
            className="flex-1 min-w-[60px] text-[11px] bg-transparent border-none p-0 outline-none"
            style={{ color: "var(--color-vsc-text)" }}
          />

          {/* ── Chevron toggle ─────────────────────────── */}
          <button
            type="button"
            tabIndex={-1}
            onClick={(e) => {
              e.stopPropagation();
              setOpen((p) => !p);
            }}
            className="inline-flex items-center justify-center rounded w-5 h-5 shrink-0 cursor-pointer"
            style={{ color: "var(--color-vsc-text-muted)" }}
            aria-label="Toggle options"
          >
            <ChevronIcon open={open} />
          </button>
        </div>
      </div>

      {/* ── Dropdown panel ─────────────────────────────── */}
      <div
        ref={listRef}
        role="listbox"
        className="absolute z-50 mt-1 w-full rounded-lg border max-h-48 overflow-auto py-1 origin-top"
        style={{
          background: "var(--color-vsc-panel)",
          borderColor: "var(--color-vsc-border)",
          boxShadow: "0 8px 24px rgba(0,0,0,0.22), 0 2px 6px rgba(0,0,0,0.12)",
          opacity: open ? 1 : 0,
          transform: open
            ? "translateY(0) scaleY(1)"
            : "translateY(-4px) scaleY(0.96)",
          pointerEvents: open ? "auto" : "none",
          visibility: open ? "visible" : "hidden",
          transition:
            "opacity 120ms ease, transform 120ms ease, visibility 120ms",
        }}
      >
        {filteredOptions.length === 0 && (
          <div
            className="px-3 py-2 text-[11px] text-center select-none"
            style={{ color: "var(--color-vsc-text-muted)" }}
          >
            {emptyText}
          </div>
        )}

        {filteredOptions.map((opt, idx) => {
          const selected = selectedSet.has(opt.value);
          const highlighted = idx === highlightedIndex;
          return (
            <button
              key={opt.value}
              type="button"
              role="option"
              aria-selected={selected}
              onClick={() => toggleValue(opt.value)}
              onMouseEnter={() => setHighlightedIndex(idx)}
              className="w-full flex items-center gap-2 rounded-md mx-1 px-2 py-1.5 text-[11px] cursor-pointer select-none"
              style={{
                width: "calc(100% - 8px)",
                color: "var(--color-vsc-text)",
                background: highlighted
                  ? "var(--color-vsc-list-active)"
                  : "transparent",
                transition: "background 60ms ease",
              }}
            >
              {/* Check indicator */}
              <span
                className="inline-flex items-center justify-center w-4 h-4 shrink-0"
                style={{
                  color: selected ? "var(--color-vsc-accent)" : "transparent",
                }}
              >
                <CheckIcon />
              </span>
              <span className="truncate">{opt.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
