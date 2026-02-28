import type { MaterialRow } from "../../store/types";
import type { MaterialPickerState } from "./types";

interface MaterialPickerMenuProps {
  picker: MaterialPickerState | null;
  materials: MaterialRow[];
  onSelect: (regionKey: string, materialId: string) => void;
  onClose: () => void;
}

export function MaterialPickerMenu({
  picker,
  materials,
  onSelect,
  onClose,
}: MaterialPickerMenuProps) {
  if (!picker) return null;

  return (
    <div
      className="absolute z-50 py-1 rounded-md shadow-xl min-w-[140px]"
      style={{
        left: picker.screenX,
        top: picker.screenY,
        background: "var(--color-vsc-input-bg)",
        border: "1px solid var(--color-vsc-border)",
        boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div
        className="px-3 py-1 text-[10px] font-medium"
        style={{ color: "var(--color-vsc-text-muted)" }}
      >
        Assign Material
      </div>
      {materials.map((m) => (
        <button
          key={m.id}
          onClick={() => {
            onSelect(picker.regionKey, m.id);
            onClose();
          }}
          className="w-full flex items-center gap-2 px-3 py-1.5 text-[12px] text-left cursor-pointer transition-colors"
          style={{ color: "var(--color-vsc-text)" }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLElement).style.background =
              "var(--color-vsc-list-hover)";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLElement).style.background = "";
          }}
        >
          <div className="w-3 h-3 rounded-sm" style={{ background: m.color }} />
          {m.name}
        </button>
      ))}
    </div>
  );
}
