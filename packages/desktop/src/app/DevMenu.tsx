import { useEffect, useRef, useState } from "react";
import { useAppStore } from "../store/app-store";
import { isElectron } from "../utils/is-electron";

export function DevMenu() {
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

  const handleReloadWindow = () => {
    setOpen(false);
    window.location.reload();
  };

  const handleToggleDevTools = () => {
    setOpen(false);
    if (isElectron) {
      window.cslope.toggleDevTools();
    }
  };

  const handleResetStore = () => {
    const ok = window.confirm(
      "Reset the entire app store to defaults? This cannot be undone.",
    );
    if (!ok) return;
    useAppStore.getState().newProject();
    setOpen(false);
  };

  const handleLogState = () => {
    // eslint-disable-next-line no-console
    console.log("App store state:", useAppStore.getState());
    setOpen(false);
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
          color: "#e5a00d",
          background: open ? "var(--color-vsc-list-active)" : "transparent",
        }}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        Dev
      </button>

      {open && (
        <div
          className="absolute left-0 mt-0.5 w-56 rounded shadow-lg py-1 text-[12px]"
          style={{
            background: "var(--color-vsc-panel)",
            border: "1px solid var(--color-vsc-border)",
            color: "var(--color-vsc-text)",
            zIndex: 60,
          }}
          role="menu"
        >
          <MenuItem
            label="Reload Window"
            shortcut="Ctrl+R"
            onClick={handleReloadWindow}
          />
          {isElectron && (
            <MenuItem
              label="Toggle DevTools"
              shortcut="F12"
              onClick={handleToggleDevTools}
            />
          )}
          <MenuSep />
          <MenuItem label="Log Store to Console" onClick={handleLogState} />
          <MenuItem label="Reset Store" onClick={handleResetStore} />
        </div>
      )}
    </div>
  );
}

// ── Shared sub-components ──

function MenuItem({
  label,
  shortcut,
  onClick,
}: {
  label: string;
  shortcut?: string;
  onClick: () => void;
}) {
  return (
    <button
      className="w-full text-left px-3 py-1.5 hover:bg-[var(--color-vsc-list-hover)] flex items-center justify-between cursor-pointer"
      onClick={onClick}
      role="menuitem"
    >
      <span>{label}</span>
      {shortcut && (
        <span
          className="text-[11px] ml-6"
          style={{ color: "var(--color-vsc-text-muted)" }}
        >
          {shortcut}
        </span>
      )}
    </button>
  );
}

function MenuSep() {
  return (
    <div
      className="my-1 mx-2"
      style={{ borderTop: "1px solid var(--color-vsc-border)" }}
    />
  );
}
