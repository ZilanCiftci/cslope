import { useEffect, useRef, useState } from "react";
import { useAppStore } from "../store/app-store";
import { isElectron } from "../utils/is-electron";

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
    useAppStore.temporal.getState().clear();
    setOpen(false);
  };

  const handleAbout = () => {
    setOpen(false);
    if (isElectron) {
      window.cslope.menuAbout();
    } else {
      window.alert("cSlope — Slope Stability Analysis\nhttps://cslope.com");
    }
  };

  return (
    <div
      className="relative"
      ref={menuRef}
      style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
    >
      <button
        onClick={() => setOpen((v) => !v)}
        className="h-8 px-3 rounded text-[12px] font-medium flex items-center cursor-pointer"
        style={{
          color: "var(--color-vsc-text-muted)",
          background: open ? "var(--color-vsc-list-active)" : "transparent",
        }}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        Help
      </button>

      {open && (
        <div
          className="absolute left-0 mt-0.5 w-52 rounded shadow-lg py-1 text-[12px]"
          style={{
            background: "var(--color-vsc-panel)",
            border: "1px solid var(--color-vsc-border)",
            color: "var(--color-vsc-text)",
            zIndex: 60,
          }}
          role="menu"
        >
          <button
            className="w-full text-left px-3 py-1.5 hover:bg-[var(--color-vsc-list-hover)] cursor-pointer"
            onClick={handleLoadBenchmarks}
            role="menuitem"
          >
            Load Benchmarks
          </button>
          <div
            className="my-1 mx-2"
            style={{ borderTop: "1px solid var(--color-vsc-border)" }}
          />
          <button
            className="w-full text-left px-3 py-1.5 hover:bg-[var(--color-vsc-list-hover)] cursor-pointer"
            onClick={handleAbout}
            role="menuitem"
          >
            About cSlope
          </button>
        </div>
      )}
    </div>
  );
}
