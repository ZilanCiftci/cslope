import { useState, useCallback, useEffect, useRef } from "react";

interface ResizablePanelProps {
  width: number;
  minWidth?: number;
  maxWidth?: number;
  onResize: (width: number) => void;
  /**
   * Called when the splitter is dragged well past the minimum width (below
   * collapseWidth, half the minimum by default): the panel collapses and
   * keeps its last width for when it opens again.
   */
  onCollapse?: () => void;
  collapseWidth?: number;
  position: "left" | "right";
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

export function ResizablePanel({
  width,
  minWidth = 100,
  maxWidth = 600,
  onResize,
  onCollapse,
  collapseWidth = minWidth / 2,
  position,
  children,
  className,
  style,
}: ResizablePanelProps) {
  const [isResizing, setIsResizing] = useState(false);
  const startX = useRef<number>(0);
  const startWidth = useRef<number>(0);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation(); // Prevent text selection or other drags
      setIsResizing(true);
      startX.current = e.clientX;
      startWidth.current = width;
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    },
    [width],
  );

  useEffect(() => {
    if (!isResizing) return;

    const handlePointerUp = () => {
      setIsResizing(false);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    const handlePointerMove = (e: PointerEvent) => {
      const dx = e.clientX - startX.current;
      const newWidth =
        position === "left" ? startWidth.current + dx : startWidth.current - dx;

      if (onCollapse && newWidth < collapseWidth) {
        // Dragged shut: the drag ends here and the panel collapses.
        handlePointerUp();
        onCollapse();
        return;
      }
      const clamped = Math.max(minWidth, Math.min(maxWidth, newWidth));
      onResize(clamped);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [isResizing, minWidth, maxWidth, collapseWidth, onResize, onCollapse, position]);

  return (
    <div
      className={`relative flex-shrink-0 flex ${className || ""}`}
      style={{
        width,
        ...style,
        borderRight:
          position === "left" ? "1px solid var(--color-vsc-border)" : undefined,
        borderLeft:
          position === "right"
            ? "1px solid var(--color-vsc-border)"
            : undefined,
      }}
    >
      {/* Content */}
      <div className="flex-1 w-full h-full overflow-hidden block">
        {children}
      </div>

      {/* Handle */}
      <div
        onPointerDown={handlePointerDown}
        className={`absolute top-0 bottom-0 w-1 cursor-col-resize hover:bg-blue-500 transition-colors opacity-0 hover:opacity-100 ${
          position === "left" ? "-right-1" : "-left-1"
        } ${isResizing ? "bg-blue-500 opacity-100" : ""}`}
        style={{ zIndex: 80 }}
      />
    </div>
  );
}
