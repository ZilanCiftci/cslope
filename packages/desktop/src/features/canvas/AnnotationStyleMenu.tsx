import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import type { Annotation } from "../../store/types";

interface AnnotationStyleMenuState {
  screenX: number;
  screenY: number;
  annoId: string;
}

interface AnnotationStyleMenuProps {
  menu: AnnotationStyleMenuState | null;
  annotations: Annotation[];
  updateAnnotation: (id: string, patch: Partial<Annotation>) => void;
  removeAnnotation: (id: string) => void;
  onPreviewChange: (annoId: string, draft: AnnotationDraft | null) => void;
  onClose: () => void;
}

export type AnnotationDraft = Pick<
  Annotation,
  "text" | "fontSize" | "fontFamily" | "bold" | "italic" | "color"
>;

const FONT_SIZES = [8, 10, 12, 14, 16, 18, 20, 24, 28, 32];
const FONT_FAMILIES = [
  { label: "Sans-serif", value: "sans-serif" },
  { label: "Serif", value: "serif" },
  { label: "Monospace", value: "monospace" },
];
const COLORS = [
  "#000000",
  "#333333",
  "#666666",
  "#999999",
  "#cc0000",
  "#cc6600",
  "#cccc00",
  "#00cc00",
  "#0066cc",
  "#6600cc",
  "#ffffff",
];

export function AnnotationStyleMenu({
  menu,
  annotations,
  updateAnnotation,
  removeAnnotation,
  onPreviewChange,
  onClose,
}: AnnotationStyleMenuProps) {
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [draft, setDraft] = useState<AnnotationDraft | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef({ x: 0, y: 0, startPos: { x: 0, y: 0 } });

  const prevMenuIdRef = useRef<string | null>(null);

  // We set the initial pos and track the original state
  useEffect(() => {
    const prevMenuId = prevMenuIdRef.current;

    if (prevMenuId && menu?.annoId && menu.annoId !== prevMenuId) {
      onPreviewChange(prevMenuId, null);
    }

    if (menu?.annoId && menu.annoId !== prevMenuIdRef.current) {
      prevMenuIdRef.current = menu.annoId;
      // Use setTimeout to avoid synchronous setState warning
      setTimeout(() => {
        setPos({ x: menu.screenX, y: menu.screenY });
      }, 0);
      const anno = annotations.find((a) => a.id === menu.annoId);
      if (anno) {
        setTimeout(() => {
          setDraft({
            text: anno.text,
            fontSize: anno.fontSize,
            fontFamily: anno.fontFamily,
            bold: anno.bold,
            italic: anno.italic,
            color: anno.color,
          });
        }, 0);
      }
    } else if (!menu && prevMenuIdRef.current) {
      prevMenuIdRef.current = null;
      setTimeout(() => {
        setDraft(null);
      }, 0);
    }
  }, [menu, annotations, onPreviewChange]);

  useEffect(() => {
    if (menu?.annoId) {
      onPreviewChange(menu.annoId, draft);
    }
  }, [menu?.annoId, draft, onPreviewChange]);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
    dragStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      startPos: pos,
    };
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (isDragging) {
      e.stopPropagation(); // keep menu events isolated
      const dx = e.clientX - dragStartRef.current.x;
      const dy = e.clientY - dragStartRef.current.y;
      setPos({
        x: dragStartRef.current.startPos.x + dx,
        y: dragStartRef.current.startPos.y + dy,
      });
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (isDragging) {
      e.stopPropagation(); // keep menu events isolated
      setIsDragging(false);
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  const handleCancel = () => {
    if (menu) {
      onPreviewChange(menu.annoId, null);
    }
    onClose();
  };

  const handleSave = () => {
    if (menu && draft) {
      updateAnnotation(menu.annoId, {
        text: draft.text,
        fontSize: draft.fontSize,
        fontFamily: draft.fontFamily,
        bold: draft.bold,
        italic: draft.italic,
        color: draft.color,
      });
      onPreviewChange(menu.annoId, null);
    }
    onClose();
  };

  if (!menu) return null;

  const anno = annotations.find((a) => a.id === menu.annoId);
  if (!anno) return null;
  if (!draft) return null;

  return createPortal(
    <div
      className="fixed z-50 rounded-md shadow-xl min-w-[200px] flex flex-col overflow-hidden"
      style={{
        left: pos.x,
        top: pos.y,
        background: "var(--color-vsc-input-bg)",
        border: "1px solid var(--color-vsc-border)",
        boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
      }}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {/* Draggable Header */}
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
          Annotation Style
        </div>
        <button
          type="button"
          onClick={handleCancel}
          onPointerDown={(e) => {
            e.stopPropagation();
          }}
          onMouseDown={(e) => {
            e.stopPropagation();
          }}
          className="text-[14px] leading-none hover:opacity-70 cursor-pointer p-1 -mr-1"
          style={{ color: "var(--color-vsc-text)" }}
          title="Cancel"
        >
          &times;
        </button>
      </div>

      <div className="p-3 space-y-2.5">
        {anno.type === "text" && (
          <div>
            <label
              className="text-[10px] block mb-0.5"
              style={{ color: "var(--color-vsc-text-muted)" }}
            >
              Text
            </label>
            <textarea
              value={draft.text ?? ""}
              onChange={(e) =>
                setDraft((prev) =>
                  prev ? { ...prev, text: e.target.value } : prev,
                )
              }
              className="w-full text-[11px] px-1.5 py-1 rounded resize-y min-h-[48px]"
              style={{
                background: "var(--color-vsc-bg)",
                color: "var(--color-vsc-text)",
                border: "1px solid var(--color-vsc-border)",
              }}
            />
          </div>
        )}

        <div>
          <label
            className="text-[10px] block mb-0.5"
            style={{ color: "var(--color-vsc-text-muted)" }}
          >
            Font
          </label>
          <select
            value={draft.fontFamily ?? "sans-serif"}
            onChange={(e) =>
              setDraft((prev) =>
                prev
                  ? {
                      ...prev,
                      fontFamily: e.target.value,
                    }
                  : prev,
              )
            }
            className="w-full text-[11px] px-1.5 py-1 rounded cursor-pointer"
            style={{
              background: "var(--color-vsc-bg)",
              color: "var(--color-vsc-text)",
              border: "1px solid var(--color-vsc-border)",
            }}
          >
            {FONT_FAMILIES.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label
            className="text-[10px] block mb-0.5"
            style={{ color: "var(--color-vsc-text-muted)" }}
          >
            Size
          </label>
          <select
            value={draft.fontSize ?? 12}
            onChange={(e) =>
              setDraft((prev) =>
                prev
                  ? {
                      ...prev,
                      fontSize: Number(e.target.value),
                    }
                  : prev,
              )
            }
            className="w-full text-[11px] px-1.5 py-1 rounded cursor-pointer"
            style={{
              background: "var(--color-vsc-bg)",
              color: "var(--color-vsc-text)",
              border: "1px solid var(--color-vsc-border)",
            }}
          >
            {FONT_SIZES.map((s) => (
              <option key={s} value={s}>
                {s}px
              </option>
            ))}
          </select>
        </div>

        <div className="flex gap-1.5">
          <button
            onClick={() =>
              setDraft((prev) => (prev ? { ...prev, bold: !prev.bold } : prev))
            }
            className="flex-1 text-[12px] font-bold py-1 rounded cursor-pointer"
            style={{
              background: draft.bold
                ? "var(--color-vsc-accent)"
                : "var(--color-vsc-bg)",
              color: draft.bold ? "#fff" : "var(--color-vsc-text)",
              border: "1px solid var(--color-vsc-border)",
            }}
          >
            B
          </button>
          <button
            onClick={() =>
              setDraft((prev) =>
                prev ? { ...prev, italic: !prev.italic } : prev,
              )
            }
            className="flex-1 text-[12px] italic py-1 rounded cursor-pointer"
            style={{
              background: draft.italic
                ? "var(--color-vsc-accent)"
                : "var(--color-vsc-bg)",
              color: draft.italic ? "#fff" : "var(--color-vsc-text)",
              border: "1px solid var(--color-vsc-border)",
            }}
          >
            I
          </button>
        </div>

        <div>
          <label
            className="text-[10px] block mb-0.5"
            style={{ color: "var(--color-vsc-text-muted)" }}
          >
            Color
          </label>
          <div className="flex flex-wrap gap-1">
            {COLORS.map((c) => (
              <button
                key={c}
                onClick={() =>
                  setDraft((prev) => (prev ? { ...prev, color: c } : prev))
                }
                className="w-5 h-5 rounded-sm cursor-pointer"
                style={{
                  background: c,
                  border:
                    (draft.color ?? "#000000") === c
                      ? "2px solid var(--color-vsc-accent)"
                      : "1px solid var(--color-vsc-border)",
                }}
              />
            ))}
          </div>
        </div>
      </div>

      <div
        className="flex gap-2 p-3 border-t"
        style={{
          borderColor: "var(--color-vsc-border)",
          background: "var(--color-vsc-input-bg)",
        }}
      >
        <button
          onClick={handleSave}
          className="flex-1 text-[11px] py-1 rounded cursor-pointer font-medium"
          style={{
            background: "var(--color-vsc-accent)",
            color: "#fff",
            border: "1px solid var(--color-vsc-accent)",
          }}
        >
          OK
        </button>
        <button
          onClick={handleCancel}
          className="flex-1 text-[11px] py-1 rounded cursor-pointer"
          style={{
            background: "transparent",
            color: "var(--color-vsc-text)",
            border: "1px solid var(--color-vsc-border)",
          }}
        >
          Cancel
        </button>
        <button
          onClick={() => {
            if (menu) {
              onPreviewChange(menu.annoId, null);
            }
            removeAnnotation(anno.id);
            onClose();
          }}
          className="flex-1 text-[11px] py-1 rounded cursor-pointer"
          style={{
            background: "transparent",
            color: "var(--color-vsc-error)",
            border: "1px solid var(--color-vsc-error)",
          }}
        >
          Delete
        </button>
      </div>
    </div>,
    document.body,
  );
}
