import {
  FitIcon,
  ZoomInIcon,
  ZoomOutIcon,
  ZoomBoxIcon,
  HandIcon,
} from "../../components/icons/ViewIcons";

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
