import { useState, useRef, useCallback, useEffect } from "react";
import { createPortal } from "react-dom";

// ── Types ──

interface PopupPanelProps {
  /** Title shown in the draggable header bar. */
  title: string;
  /** Called when the user clicks ✕ or presses Escape. */
  onClose: () => void;
  /** Pixel width of the panel (default 280). */
  width?: number;
  /** CSS max-height value (default "85vh"). */
  maxHeight?: string;
  /** Initial position. Omit or pass `"center"` to centre on screen. */
  initialPosition?: { x: number; y: number } | "center";
  /** Body content. */
  children: React.ReactNode;
  /** Optional footer row rendered below the body with a top border. */
  footer?: React.ReactNode;
}

// ── Component ──

export function PopupPanel({
  title,
  onClose,
  width = 280,
  maxHeight = "85vh",
  initialPosition = "center",
  children,
  footer,
}: PopupPanelProps) {
  // ── Position & drag state ─────────────────────────────────────────

  const [pos, setPos] = useState<{ x: number; y: number }>(() => {
    if (initialPosition !== "center") return initialPosition;
    return {
      x: Math.round((window.innerWidth - width) / 2),
      y: Math.round(window.innerHeight * 0.12),
    };
  });

  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef({ x: 0, y: 0, startPos: { x: 0, y: 0 } });

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(true);
      e.currentTarget.setPointerCapture(e.pointerId);
      dragStartRef.current = {
        x: e.clientX,
        y: e.clientY,
        startPos: pos,
      };
    },
    [pos],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!isDragging) return;
      e.stopPropagation();
      const dx = e.clientX - dragStartRef.current.x;
      const dy = e.clientY - dragStartRef.current.y;
      setPos({
        x: dragStartRef.current.startPos.x + dx,
        y: dragStartRef.current.startPos.y + dy,
      });
    },
    [isDragging],
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!isDragging) return;
      e.stopPropagation();
      setIsDragging(false);
      e.currentTarget.releasePointerCapture(e.pointerId);
    },
    [isDragging],
  );

  // ── Close on Escape ───────────────────────────────────────────────

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  // ── Render ────────────────────────────────────────────────────────

  return createPortal(
    <div
      className="fixed z-50 rounded-md shadow-xl flex flex-col overflow-hidden"
      style={{
        left: pos.x,
        top: pos.y,
        width,
        maxHeight,
        background: "var(--color-vsc-input-bg)",
        border: "1px solid var(--color-vsc-border)",
        boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
      }}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {/* ── Draggable header ── */}
      <div
        className="flex items-center justify-between px-3 py-2 cursor-move border-b select-none touch-none"
        style={{
          borderColor: "var(--color-vsc-border)",
          background: "var(--color-vsc-bg)",
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        <div
          className="text-[11px] font-semibold"
          style={{ color: "var(--color-vsc-text)" }}
        >
          {title}
        </div>
        <button
          type="button"
          onClick={onClose}
          onPointerDown={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          className="text-[14px] leading-none hover:opacity-70 cursor-pointer p-1 -mr-1"
          style={{ color: "var(--color-vsc-text)" }}
          title="Close"
        >
          &times;
        </button>
      </div>

      {/* ── Body ── */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2.5">{children}</div>

      {/* ── Footer ── */}
      {footer && (
        <div
          className="flex gap-2 p-3 border-t"
          style={{
            borderColor: "var(--color-vsc-border)",
            background: "var(--color-vsc-input-bg)",
          }}
        >
          {footer}
        </div>
      )}
    </div>,
    document.body,
  );
}
