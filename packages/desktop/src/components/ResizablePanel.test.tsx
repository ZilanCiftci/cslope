import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ResizablePanel } from "./ResizablePanel";

afterEach(cleanup);

function setup(position: "left" | "right", width = 250) {
  const onResize = vi.fn();
  const { container } = render(
    <ResizablePanel width={width} minWidth={150} maxWidth={400} onResize={onResize} position={position}>
      <p>content</p>
    </ResizablePanel>,
  );
  const panel = container.firstElementChild as HTMLElement;
  const handle = panel.lastElementChild as HTMLElement;
  return { onResize, panel, handle };
}

const pointer = (type: string, clientX: number) =>
  act(() => {
    window.dispatchEvent(new MouseEvent(type, { clientX }));
  });

describe("ResizablePanel", () => {
  it("renders its content at the given width with a border on the inner side", () => {
    const { panel } = setup("left");
    expect(screen.getByText("content")).toBeInTheDocument();
    expect(panel.style.width).toBe("250px");
    expect(panel.style.borderRight).toContain("1px solid");
    expect(setup("right").panel.style.borderLeft).toContain("1px solid");
  });

  it("widens a left panel when dragging right, clamped to the limits", () => {
    const { onResize, handle } = setup("left");
    fireEvent.pointerDown(handle, { clientX: 100 });
    expect(document.body.style.cursor).toBe("col-resize");
    pointer("pointermove", 150);
    expect(onResize).toHaveBeenLastCalledWith(300);
    pointer("pointermove", 500);
    expect(onResize).toHaveBeenLastCalledWith(400);
    pointer("pointermove", -500);
    expect(onResize).toHaveBeenLastCalledWith(150);
    pointer("pointerup", 0);
    expect(document.body.style.cursor).toBe("");
    onResize.mockClear();
    pointer("pointermove", 200);
    expect(onResize).not.toHaveBeenCalled();
  });

  it("widens a right panel when dragging left", () => {
    const { onResize, handle } = setup("right");
    fireEvent.pointerDown(handle, { clientX: 500 });
    pointer("pointermove", 450);
    expect(onResize).toHaveBeenLastCalledWith(300);
    pointer("pointerup", 450);
  });
});
