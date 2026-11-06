import { afterEach, describe, expect, it, vi } from "vitest";
import { useRef, useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Menu, MenuItem, MenuSeparator } from "./Menu";
import { useMenuDismiss } from "./menu-parts";

afterEach(cleanup);

function Example({ onClose = vi.fn(), onCopy = vi.fn(), initialFocus }: { onClose?: () => void; onCopy?: () => void; initialFocus?: "first" | "last" }) {
  return (
    <Menu label="Edit" onClose={onClose} initialFocus={initialFocus}>
      <MenuItem onClick={onCopy}>Copy</MenuItem>
      <MenuItem disabled disabledTitle="Nothing to paste">
        Paste
      </MenuItem>
      <MenuSeparator />
      <MenuItem danger>Delete</MenuItem>
    </Menu>
  );
}

describe("Menu", () => {
  it("is a named menu of text items, without icons, a separator between groups", () => {
    const { container } = render(<Example />);
    expect(screen.getByRole("menu", { name: "Edit" })).toBeInTheDocument();
    expect(screen.getAllByRole("menuitem").map((el) => el.textContent)).toEqual(["Copy", "Paste", "Delete"]);
    expect(screen.getByRole("separator")).toBeInTheDocument();
    expect(container.querySelector("svg")).toBeNull();
  });

  it("says why a disabled item is off and does nothing on its click", () => {
    const onCopy = vi.fn();
    render(<Example onCopy={onCopy} />);
    const paste = screen.getByRole("menuitem", { name: "Paste" });
    expect(paste).toHaveAttribute("aria-disabled", "true");
    expect(paste).toHaveAttribute("title", "Nothing to paste");
    fireEvent.click(paste);
    fireEvent.click(screen.getByRole("menuitem", { name: "Copy" }));
    expect(onCopy).toHaveBeenCalledTimes(1);
  });

  it("moves between the enabled items with the arrows, Home and End; Enter runs one; Escape closes", () => {
    const onClose = vi.fn();
    const onCopy = vi.fn();
    render(<Example onClose={onClose} onCopy={onCopy} initialFocus="first" />);
    const menu = screen.getByRole("menu");
    const copy = screen.getByRole("menuitem", { name: "Copy" });
    const del = screen.getByRole("menuitem", { name: "Delete" });
    expect(copy).toHaveFocus();
    // Paste is off: skipped.
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(del).toHaveFocus();
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(copy).toHaveFocus();
    fireEvent.keyDown(menu, { key: "ArrowUp" });
    expect(del).toHaveFocus();
    fireEvent.keyDown(menu, { key: "Home" });
    expect(copy).toHaveFocus();
    fireEvent.keyDown(menu, { key: "Enter" });
    expect(onCopy).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(menu, { key: "End" });
    expect(del).toHaveFocus();
    fireEvent.keyDown(menu, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("focuses the last item when asked, and an item on hover", () => {
    render(<Example initialFocus="last" />);
    expect(screen.getByRole("menuitem", { name: "Delete" })).toHaveFocus();
    fireEvent.mouseEnter(screen.getByRole("menuitem", { name: "Copy" }));
    expect(screen.getByRole("menuitem", { name: "Copy" })).toHaveFocus();
  });

  it("keeps the arrow keys from the canvas shortcuts", () => {
    const seen = vi.fn();
    document.addEventListener("keydown", seen);
    try {
      render(<Example initialFocus="first" />);
      fireEvent.keyDown(screen.getByRole("menu"), { key: "ArrowDown" });
      expect(seen).not.toHaveBeenCalled();
    } finally {
      document.removeEventListener("keydown", seen);
    }
  });
});

describe("MenuItem outside a menu", () => {
  it("is a plain button, a choice with its state", () => {
    render(
      <div role="group" aria-label="Surfaces">
        <MenuItem role={null} checked>
          Critical only
        </MenuItem>
        <MenuItem role={null} checked={false}>
          All surfaces
        </MenuItem>
      </div>,
    );
    expect(screen.getByRole("button", { name: "Critical only" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "All surfaces" })).toHaveAttribute("aria-pressed", "false");
  });
});

function Dismissable() {
  const [open, setOpen] = useState(true);
  const ref = useRef<HTMLDivElement>(null);
  useMenuDismiss(open, [ref], () => setOpen(false));
  return (
    <>
      <button type="button">Elsewhere</button>
      {open && (
        <Menu ref={ref} label="Edit">
          <MenuItem>Copy</MenuItem>
        </Menu>
      )}
    </>
  );
}

describe("useMenuDismiss", () => {
  it("closes on a press outside the menu, not inside it", () => {
    render(<Dismissable />);
    fireEvent.pointerDown(screen.getByRole("menuitem", { name: "Copy" }));
    expect(screen.getByRole("menu")).toBeInTheDocument();
    fireEvent.pointerDown(screen.getByRole("button", { name: "Elsewhere" }));
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("closes on Escape", () => {
    render(<Dismissable />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
  });
});
