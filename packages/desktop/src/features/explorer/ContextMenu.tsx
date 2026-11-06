import { Fragment, useRef } from "react";
import { Menu, MenuItem, MenuSeparator } from "../../components/ui/Menu";
import { MENU_Z, useMenuDismiss } from "../../components/ui/menu-parts";

export interface MenuPos {
  x: number;
  y: number;
  modelId: string;
  modelName: string;
  selectedModelIds: string[];
}

interface Props {
  pos: MenuPos;
  onClose: () => void;
  onRename: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onProperties: () => void;
  canDelete: boolean;
  multiSelect: boolean;
}

export function ContextMenu({
  pos,
  onClose,
  onRename,
  onDuplicate,
  onDelete,
  onProperties,
  canDelete,
  multiSelect,
}: Props) {
  const menuRef = useRef<HTMLDivElement>(null);
  useMenuDismiss(true, [menuRef], onClose);

  const items: {
    label: string;
    action: () => void;
    danger?: boolean;
    disabled?: boolean;
    separator?: boolean;
  }[] = [
    { label: "Model properties", action: onProperties },
    { label: "Rename", action: onRename, disabled: multiSelect },
    { label: "Duplicate", action: onDuplicate, disabled: multiSelect },
    {
      label: multiSelect
        ? `Delete selected (${pos.selectedModelIds.length})`
        : "Delete",
      action: onDelete,
      danger: true,
      disabled: !canDelete,
      separator: true,
    },
  ];

  return (
    <Menu
      ref={menuRef}
      label={`Model ${pos.modelName}`}
      onClose={onClose}
      className={`fixed ${MENU_Z}`}
      style={{ left: pos.x, top: pos.y }}
    >
      {items.map((item) => (
        <Fragment key={item.label}>
          {item.separator && <MenuSeparator />}
          <MenuItem
            disabled={item.disabled}
            danger={item.danger}
            onClick={() => {
              item.action();
              onClose();
            }}
          >
            {item.label}
          </MenuItem>
        </Fragment>
      ))}
    </Menu>
  );
}
