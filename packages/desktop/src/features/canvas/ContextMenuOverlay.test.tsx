import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ContextMenuOverlay } from "./ContextMenuOverlay";
import { MaterialPickerMenu } from "./MaterialPickerMenu";
import { DEFAULT_MATERIAL } from "../../store/defaults";

afterEach(cleanup);

describe("ContextMenuOverlay", () => {
  it("renders nothing without a menu", () => {
    const { container } = render(<ContextMenuOverlay menu={null} />);
    expect(container.firstChild).toBeNull();
  });

  it("runs enabled items, ignores disabled ones and highlights only enabled items on hover", () => {
    const add = vi.fn();
    const del = vi.fn();
    render(
      <ContextMenuOverlay
        menu={{
          screenX: 40,
          screenY: 60,
          items: [
            { label: "Add point", action: add },
            { label: "Delete point", action: del, danger: true, disabled: true },
          ],
        }}
      />,
    );
    const addBtn = screen.getByRole("menuitem", { name: "Add point" });
    const delBtn = screen.getByRole("menuitem", { name: "Delete point" });
    expect(screen.getByRole("menu").style.left).toBe("40px");
    expect(delBtn).toBeDisabled();
    expect(delBtn.style.color).toBe("var(--color-vsc-error)");
    fireEvent.click(addBtn);
    fireEvent.click(delBtn);
    expect(add).toHaveBeenCalledTimes(1);
    expect(del).not.toHaveBeenCalled();
    fireEvent.mouseEnter(addBtn);
    expect(addBtn.style.background).toBe("var(--color-vsc-list-hover)");
    fireEvent.mouseLeave(addBtn);
    expect(addBtn.style.background).toBe("");
    fireEvent.mouseEnter(delBtn);
    expect(delBtn.style.background).toBe("");
  });
});

describe("ContextMenuOverlay submenus", () => {
  it("shows a submenu beside its item on hover and runs its items; a separator sets an item apart", () => {
    const lockExterior = vi.fn();
    const lockLoads = vi.fn();
    const unlockAll = vi.fn();
    render(
      <ContextMenuOverlay
        menu={{
          screenX: 5,
          screenY: 5,
          items: [
            { label: "Assign material…", action: vi.fn() },
            {
              label: "Lock all",
              separator: true,
              action: vi.fn(),
              submenu: [
                { label: "Exterior boundary", action: lockExterior },
                { label: "Loads", action: lockLoads, disabled: true },
              ],
            },
            { label: "Unlock all", action: unlockAll },
          ],
        }}
      />,
    );
    const lockAll = screen.getByRole("menuitem", { name: "Lock all" });
    expect(lockAll).toHaveAttribute("aria-haspopup", "menu");
    expect(lockAll).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("menuitem", { name: "Exterior boundary" })).toBeNull();
    fireEvent.mouseEnter(lockAll.parentElement as HTMLElement);
    expect(lockAll).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(screen.getByRole("menuitem", { name: "Exterior boundary" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Loads" }));
    expect(lockExterior).toHaveBeenCalledTimes(1);
    expect(lockLoads).not.toHaveBeenCalled();
    // Hovering another item closes the submenu.
    fireEvent.mouseEnter(screen.getByRole("menuitem", { name: "Unlock all" }).parentElement as HTMLElement);
    expect(screen.queryByRole("menuitem", { name: "Exterior boundary" })).toBeNull();
    // The separator is drawn above "Lock all".
    expect((lockAll.previousElementSibling as HTMLElement).className).toContain("h-px");
  });
});

describe("MaterialPickerMenu", () => {
  it("assigns the chosen material at the picked point and closes", () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    const sand = { ...DEFAULT_MATERIAL, id: "sand", name: "Sand" };
    render(
      <MaterialPickerMenu
        picker={{ screenX: 10, screenY: 20, worldPoint: [3, 4] }}
        materials={[DEFAULT_MATERIAL, sand]}
        onSelect={onSelect}
        onClose={onClose}
      />,
    );
    const btn = screen.getByRole("button", { name: "Sand" });
    fireEvent.mouseEnter(btn);
    expect(btn.style.background).toBe("var(--color-vsc-list-hover)");
    fireEvent.mouseLeave(btn);
    fireEvent.click(btn);
    expect(onSelect).toHaveBeenCalledWith([3, 4], "sand");
    expect(onClose).toHaveBeenCalled();
  });
});
