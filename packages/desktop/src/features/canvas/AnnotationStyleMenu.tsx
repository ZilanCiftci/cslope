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
  onClose: () => void;
}

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
  onClose,
}: AnnotationStyleMenuProps) {
  if (!menu) return null;

  const anno = annotations.find((a) => a.id === menu.annoId);
  if (!anno) return null;

  return (
    <div
      className="absolute z-50 p-3 rounded-md shadow-xl min-w-[200px] space-y-2.5"
      style={{
        left: menu.screenX,
        top: menu.screenY,
        background: "var(--color-vsc-input-bg)",
        border: "1px solid var(--color-vsc-border)",
        boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
      }}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <div
        className="text-[10px] font-medium mb-1"
        style={{ color: "var(--color-vsc-text-muted)" }}
      >
        Annotation Style
      </div>

      {anno.type === "text" && (
        <div>
          <label
            className="text-[10px] block mb-0.5"
            style={{ color: "var(--color-vsc-text-muted)" }}
          >
            Text
          </label>
          <textarea
            value={anno.text ?? ""}
            onChange={(e) =>
              updateAnnotation(anno.id, { text: e.target.value })
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
          value={anno.fontFamily ?? "sans-serif"}
          onChange={(e) =>
            updateAnnotation(anno.id, {
              fontFamily: e.target.value,
            })
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
          value={anno.fontSize ?? 12}
          onChange={(e) =>
            updateAnnotation(anno.id, {
              fontSize: Number(e.target.value),
            })
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
          onClick={() => updateAnnotation(anno.id, { bold: !anno.bold })}
          className="flex-1 text-[12px] font-bold py-1 rounded cursor-pointer"
          style={{
            background: anno.bold
              ? "var(--color-vsc-accent)"
              : "var(--color-vsc-bg)",
            color: anno.bold ? "#fff" : "var(--color-vsc-text)",
            border: "1px solid var(--color-vsc-border)",
          }}
        >
          B
        </button>
        <button
          onClick={() => updateAnnotation(anno.id, { italic: !anno.italic })}
          className="flex-1 text-[12px] italic py-1 rounded cursor-pointer"
          style={{
            background: anno.italic
              ? "var(--color-vsc-accent)"
              : "var(--color-vsc-bg)",
            color: anno.italic ? "#fff" : "var(--color-vsc-text)",
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
              onClick={() => updateAnnotation(anno.id, { color: c })}
              className="w-5 h-5 rounded-sm cursor-pointer"
              style={{
                background: c,
                border:
                  (anno.color ?? "#000000") === c
                    ? "2px solid var(--color-vsc-accent)"
                    : "1px solid var(--color-vsc-border)",
              }}
            />
          ))}
        </div>
      </div>

      <button
        onClick={() => {
          removeAnnotation(anno.id);
          onClose();
        }}
        className="w-full text-[11px] py-1 rounded cursor-pointer mt-1"
        style={{
          background: "transparent",
          color: "var(--color-vsc-error)",
          border: "1px solid var(--color-vsc-error)",
        }}
      >
        Delete Annotation
      </button>
    </div>
  );
}
