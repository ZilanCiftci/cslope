import type { MaterialRow } from "../../store/types";
import type { MaterialPickerState } from "./types";
import { Menu, MenuHeading, MenuItem } from "../../components/ui/Menu";

interface MaterialPickerMenuProps {
  picker: MaterialPickerState | null;
  materials: MaterialRow[];
  onSelect: (worldPoint: [number, number], materialId: string) => void;
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
    <Menu
      label="Assign material"
      onClose={onClose}
      className="absolute z-50"
      style={{ left: picker.screenX, top: picker.screenY }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <MenuHeading>Assign material</MenuHeading>
      {materials.map((m) => (
        <MenuItem
          key={m.id}
          onClick={() => {
            onSelect(picker.worldPoint, m.id);
            onClose();
          }}
        >
          <span className="flex items-center gap-2">
            {/* The material's color: content, not an icon. */}
            <span className="w-3 h-3 rounded-xs shrink-0" style={{ background: m.color }} aria-hidden />
            {m.name}
          </span>
        </MenuItem>
      ))}
    </Menu>
  );
}
