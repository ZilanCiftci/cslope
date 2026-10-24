import { describe, expect, it } from "vitest";
import { naturalDialogHeight } from "./dialog-height";

/** Fakes the layout jsdom doesn't compute: element boxes by id. */
function layout(rects: Record<string, { top: number; bottom: number }>, clientHeight: number) {
  for (const [id, r] of Object.entries(rects)) {
    const el = document.getElementById(id)!;
    el.getBoundingClientRect = () => ({ top: r.top, bottom: r.bottom }) as DOMRect;
  }
  Object.defineProperty(document.getElementById("body")!, "clientHeight", { value: clientHeight });
}

describe("naturalDialogHeight", () => {
  it("swaps the scrolling body's height for its content's", () => {
    document.body.innerHTML = `
      <div class="h-screen flex flex-col">
        <h1>Title</h1>
        <div id="body" class="flex-1 overflow-y-auto"><div id="a"></div><div id="b"></div></div>
        <button>Close</button>
      </div>`;
    // 760 px window: the body runs from 40 to 700 but its content ends at 300.
    layout({ body: { top: 40, bottom: 700 }, a: { top: 40, bottom: 200 }, b: { top: 200, bottom: 300 } }, 660);
    expect(naturalDialogHeight(document, 760)).toBe(760 - 660 + 260);
  });

  it("grows past the window when the content scrolls", () => {
    document.body.innerHTML = `
      <div class="h-screen"><div id="body" class="flex-1 overflow-y-auto"><div id="a"></div></div></div>`;
    layout({ body: { top: 0, bottom: 500 }, a: { top: 0, bottom: 900 } }, 500);
    expect(naturalDialogHeight(document, 500)).toBe(900);
  });

  it("returns null for a page without the dialog layout", () => {
    document.body.innerHTML = `<div class="h-screen"><canvas></canvas></div>`;
    expect(naturalDialogHeight(document, 760)).toBeNull();
  });
});
