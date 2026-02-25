interface Props {
  zoomBoxActive: boolean;
  panActive: boolean;
  onFitToScreen: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onToggleZoomBox: () => void;
  onTogglePan: () => void;
  className?: string;
}

export function CanvasToolbar({
  zoomBoxActive,
  panActive,
  onFitToScreen,
  onZoomIn,
  onZoomOut,
  onToggleZoomBox,
  onTogglePan,
  className,
}: Props) {
  return (
    <div
      className={["flex items-center gap-1 p-1.5 rounded-md", className]
        .filter(Boolean)
        .join(" ")}
      style={{
        background: "var(--color-vsc-input-bg)",
        border: "1px solid var(--color-vsc-border)",
      }}
    >
      <ToolButton title="Fit to screen" onClick={onFitToScreen}>
        <FitIcon />
      </ToolButton>
      <ToolButton title="Zoom in" onClick={onZoomIn}>
        <ZoomInIcon />
      </ToolButton>
      <ToolButton title="Zoom out" onClick={onZoomOut}>
        <ZoomOutIcon />
      </ToolButton>
      <ToolButton title="Pan" onClick={onTogglePan} active={panActive}>
        <HandIcon />
      </ToolButton>
      <ToolButton
        title="Zoom box"
        onClick={onToggleZoomBox}
        active={zoomBoxActive}
      >
        <ZoomBoxIcon />
      </ToolButton>
    </div>
  );
}

function ToolButton({
  title,
  onClick,
  children,
  active = false,
}: {
  title: string;
  onClick: () => void;
  children: React.ReactNode;
  active?: boolean;
}) {
  return (
    <button
      title={title}
      aria-label={title}
      onClick={onClick}
      className="w-7 h-7 rounded flex items-center justify-center cursor-pointer"
      style={{
        color: active
          ? "var(--color-vsc-text-bright)"
          : "var(--color-vsc-text-muted)",
        background: active ? "var(--color-vsc-list-active)" : "transparent",
      }}
    >
      {children}
    </button>
  );
}

function FitIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M8 3H5a2 2 0 0 0-2 2v3" />
      <path d="M16 3h3a2 2 0 0 1 2 2v3" />
      <path d="M8 21H5a2 2 0 0 1-2-2v-3" />
      <path d="M16 21h3a2 2 0 0 0 2-2v-3" />
    </svg>
  );
}

function ZoomInIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.3-4.3" />
      <path d="M11 8v6M8 11h6" />
    </svg>
  );
}

function ZoomOutIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.3-4.3" />
      <path d="M8 11h6" />
    </svg>
  );
}

function ZoomBoxIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="4" y="4" width="16" height="16" rx="1" />
      <path d="M8 8h8M8 16h8M8 8v8M16 8v8" strokeDasharray="2 2" />
    </svg>
  );
}

function HandIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M6 12v-2a2 2 0 0 1 4 0v2" />
      <path d="M10 10V8a2 2 0 0 1 4 0v4" />
      <path d="M14 12V7a2 2 0 0 1 4 0v7" />
      <path d="M6 12v3a5 5 0 0 0 10 0v-1" />
    </svg>
  );
}
