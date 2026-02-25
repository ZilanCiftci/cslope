import { useEffect, useRef, useState } from "react";
import { useAppStore } from "../store/app-store";

export function HelpMenu() {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClickOutside = (e: MouseEvent) => {
      if (!open) return;
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  const handleLoadBenchmarks = () => {
    const ok = window.confirm(
      "Load benchmark models into the current workspace? This will replace current models.",
    );
    if (!ok) return;
    useAppStore.getState().loadBenchmarks();
    setOpen(false);
  };

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="h-8 px-3 rounded text-[12px] font-medium flex items-center gap-1"
        style={{
          color: "var(--color-vsc-text-muted)",
          background: open ? "var(--color-vsc-list-active)" : "transparent",
        }}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        Help
        <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
          <path d="M2 3l3 3.5L8 3z" />
        </svg>
      </button>

      {open && (
        <div
          className="absolute mt-1 w-52 rounded shadow-lg py-1 text-[12px]"
          style={{
            background: "var(--color-vsc-panel)",
            border: "1px solid var(--color-vsc-border)",
            color: "var(--color-vsc-text)",
            zIndex: 60,
          }}
          role="menu"
        >
          <button
            className="w-full text-left px-3 py-2 hover:bg-(--color-vsc-list-hover)"
            onClick={handleLoadBenchmarks}
            role="menuitem"
          >
            Load Benchmarks
          </button>
        </div>
      )}
    </div>
  );
}
