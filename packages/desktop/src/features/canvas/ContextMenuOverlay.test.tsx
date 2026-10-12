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
            { label: "Add Point", action: add },
            { label: "Delete Point", action: del, danger: true, disabled: true },
          ],
        }}
      />,
    );
    const addBtn = screen.getByRole("button", { name: "Add Point" });
    const delBtn = screen.getByRole("button", { name: "Delete Point" });
    expect((addBtn.parentElement as HTMLElement).style.left).toBe("40px");
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
