import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type React from "react";
import { ChevronDown } from "lucide-react";
import { DISABLED_COLOR } from "../../components/ui/disabled-style";
import type { ParameterDef } from "../../store/types";
import type { AnnotationTagContext } from "./resolveAnnotationText";
import { insertAtCaret, variableItems, type VariableItem } from "./insertVariable";

const MENU_WIDTH = 280;

/** The heading over the project information tags, said once for all of them. */
const PROJECT_HEADING = "Project information (empty if not set)";

/**
 * "Insert variable ▾" under a text annotation's Text field: lists the
 * tags with their current values and inserts the chosen one at the caret.
 */
export function InsertVariableMenu({
  textareaRef,
  text,
  onChange,
  ctx,
  parameters,
  disabled,
}: {
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  /** The textarea's current text. */
  text: string;
  onChange: (text: string) => void;
  ctx: AnnotationTagContext;
  parameters?: ParameterDef[];
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ left: 0, top: 0, maxHeight: 320 });
  const [active, setActive] = useState(0);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const pendingCaret = useRef<number | null>(null);

  const items = useMemo(
    () => (open ? variableItems(ctx, parameters) : []),
    [open, ctx, parameters],
  );

  // After an insertion re-renders the textarea: focus it, caret after the tag.
  useLayoutEffect(() => {
    const caret = pendingCaret.current;
    const ta = textareaRef.current;
    if (caret === null || !ta || ta.value !== text) return;
    pendingCaret.current = null;
    ta.focus();
    ta.setSelectionRange(caret, caret);
  }, [text, textareaRef]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!menuRef.current?.contains(t) && !buttonRef.current?.contains(t)) {
        setOpen(false);
      }
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const el = itemRefs.current[active];
    el?.focus();
    el?.scrollIntoView?.({ block: "nearest" });
  }, [open, active]);

  const openMenu = (index: number) => {
    const r = buttonRef.current?.getBoundingClientRect();
    if (r) {
      const left = Math.max(
        4,
        Math.min(r.left, window.innerWidth - MENU_WIDTH - 4),
      );
      const below = window.innerHeight - r.bottom - 8;
      const above = r.top - 8;
      const maxHeight = Math.min(320, Math.max(below, above, 120));
      const top =
        below >= Math.min(320, maxHeight) || below >= above
          ? r.bottom + 2
          : Math.max(4, r.top - 2 - maxHeight);
      setPos({ left, top, maxHeight });
    }
    setActive(index);
    setOpen(true);
  };

  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) buttonRef.current?.focus();
  };

  const choose = (item: VariableItem) => {
    setOpen(false);
    const ta = textareaRef.current;
    const start = ta?.selectionStart ?? text.length;
    const end = ta?.selectionEnd ?? text.length;
    const next = insertAtCaret(text, start, end, item.insert);
    pendingCaret.current = next.caret;
    onChange(next.text);
  };

  const onButtonKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      // Not the canvas's nudge of the selected annotation.
      e.preventDefault();
      e.stopPropagation();
      const n = variableItems(ctx, parameters).length;
      openMenu(e.key === "ArrowUp" ? n - 1 : 0);
    }
  };

  const onMenuKeyDown = (e: React.KeyboardEvent) => {
    // Keys in the menu are its own (not the canvas's Delete or arrows).
    e.stopPropagation();
    const n = items.length;
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setActive((i) => (i + 1) % n);
        break;
      case "ArrowUp":
        e.preventDefault();
        setActive((i) => (i - 1 + n) % n);
        break;
      case "Home":
        e.preventDefault();
        setActive(0);
        break;
      case "End":
        e.preventDefault();
        setActive(n - 1);
        break;
      case "Enter":
      case " ":
        e.preventDefault();
        if (items[active]) choose(items[active]);
        break;
      case "Escape":
        e.preventDefault();
        close(true);
        break;
      case "Tab":
        close(false);
        break;
    }
  };

  const renderItem = ({ item, index: i }: { item: VariableItem; index: number }) => (
    <button
      key={item.insert}
      ref={(el) => {
        itemRefs.current[i] = el;
      }}
      type="button"
      role="menuitem"
      tabIndex={i === active ? 0 : -1}
      // A project information tag: its name says what it is.
      title={item.group ? undefined : item.description}
      onClick={() => choose(item)}
      onMouseEnter={() => setActive(i)}
      className="w-full block px-3 py-1 text-left cursor-pointer"
      style={{
        background: i === active ? "var(--color-vsc-list-hover)" : "transparent",
        color: "var(--color-vsc-text)",
      }}
    >
      <span className="flex items-baseline gap-2">
        <span className="text-[11px] font-mono">{item.insert}</span>
        {item.preview !== null && item.preview !== "" && (
          <span
            className="ml-auto text-[10px] tabular-nums truncate"
            style={{ color: "var(--color-vsc-text-muted)" }}
          >
            ({item.preview})
          </span>
        )}
      </span>
      {!item.group && (
        <span
          className="block text-[10px] leading-tight"
          style={{ color: "var(--color-vsc-text-muted)" }}
        >
          {item.description}
        </span>
      )}
    </button>
  );

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        disabled={disabled}
        title={
          disabled
            ? "The selected texts differ"
            : "Insert a variable at the cursor: project information, results or parameters"
        }
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => (open ? close(false) : openMenu(0))}
        onKeyDown={onButtonKeyDown}
        className="mt-1 text-[10px] pl-1.5 pr-1 py-0.5 rounded inline-flex items-center gap-1 cursor-pointer disabled:cursor-default"
        style={{
          background: open
            ? "var(--color-vsc-list-active)"
            : "var(--color-vsc-list-hover)",
          color: disabled ? DISABLED_COLOR : "var(--color-vsc-text)",
          border: "1px solid var(--color-vsc-border)",
        }}
      >
        Insert variable
        <ChevronDown size={12} strokeWidth={1.75} style={{ color: "var(--color-vsc-text-muted)" }} aria-hidden />
      </button>
      {open && (
        <div
          ref={menuRef}
          role="menu"
          aria-label="Insert variable"
          onKeyDown={onMenuKeyDown}
          className="fixed z-[100] py-1 rounded-md overflow-y-auto"
          style={{
            left: pos.left,
            top: pos.top,
            width: MENU_WIDTH,
            maxHeight: pos.maxHeight,
            background: "var(--color-vsc-input-bg)",
            border: "1px solid var(--color-vsc-border)",
            boxShadow: "var(--color-vsc-shadow-float)",
          }}
        >
          {runs(items).map((run) =>
            run.group ? (
              <Fragment key={run.group}>
                <div role="group" aria-label={PROJECT_HEADING}>
                  <div
                    className="px-3 pt-1 pb-0.5 text-[10px]"
                    style={{ color: "var(--color-vsc-text-muted)" }}
                    aria-hidden
                  >
                    {PROJECT_HEADING}
                  </div>
                  {run.items.map(renderItem)}
                </div>
                <div role="separator" className="my-1 h-px" style={{ background: "var(--color-vsc-border)" }} />
              </Fragment>
            ) : (
              run.items.map(renderItem)
            ),
          )}
        </div>
      )}
    </>
  );
}

/** The items in runs of the same group, each with its index in the whole list. */
function runs(items: VariableItem[]): { group?: "project"; items: { item: VariableItem; index: number }[] }[] {
  const out: { group?: "project"; items: { item: VariableItem; index: number }[] }[] = [];
  items.forEach((item, index) => {
    const last = out.at(-1);
    if (last && last.group === item.group) last.items.push({ item, index });
    else out.push({ group: item.group, items: [{ item, index }] });
  });
  return out;
}
