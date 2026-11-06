import { describe, expect, it } from "vitest";
import { naturalDialogHeight, shouldFitDialog } from "./dialog-height";

/** Fakes the layout jsdom doesn't compute: element boxes by id. */
function layout(
  rects: Record<string, { top: number; bottom: number }>,
  clientHeight: number,
  scrollHeight = clientHeight,
) {
  for (const [id, r] of Object.entries(rects)) {
    const el = document.getElementById(id)!;
    el.getBoundingClientRect = () => ({ top: r.top, bottom: r.bottom, height: r.bottom - r.top }) as DOMRect;
  }
  const body = document.getElementById("body")!;
  Object.defineProperty(body, "clientHeight", { value: clientHeight, configurable: true });
  Object.defineProperty(body, "scrollHeight", { value: scrollHeight, configurable: true });
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

  it("counts the body's fractional height, not its rounded clientHeight", () => {
    document.body.innerHTML = `
      <div class="h-screen flex flex-col">
        <h1>Title</h1>
        <div id="body" class="flex-1 overflow-y-auto"><div id="a"></div></div>
        <button>Close</button>
      </div>`;
    // Sensitivity (#42): a 760 px window whose body starts at 56.5 and is
    // 648.5 high (clientHeight and scrollHeight round to 649), with 360 px of
    // content. The frame is 111.5 px, so the window needs 472, not 471.
    layout({ body: { top: 56.5, bottom: 705 }, a: { top: 56.5, bottom: 416.5 } }, 649, 649);
    expect(naturalDialogHeight(document, 760)).toBe(472);
    // Fitted to 471 (body 359.5 for 360 of content): measured again, 472.
    layout({ body: { top: 56.5, bottom: 416 }, a: { top: 56.5, bottom: 416.5 } }, 360, 360);
    expect(naturalDialogHeight(document, 471)).toBe(472);
    // And at 472 it stays.
    layout({ body: { top: 56.5, bottom: 416.5 }, a: { top: 56.5, bottom: 416.5 } }, 360, 360);
    expect(naturalDialogHeight(document, 472)).toBe(472);
  });

  it("grows past the window when the content scrolls", () => {
    document.body.innerHTML = `
      <div class="h-screen"><div id="body" class="flex-1 overflow-y-auto"><div id="a"></div></div></div>`;
    layout({ body: { top: 0, bottom: 500 }, a: { top: 0, bottom: 900 } }, 500, 900);
    expect(naturalDialogHeight(document, 500)).toBe(900);
  });

  it("counts what the body scrolls when it overflows by a pixel or more", () => {
    document.body.innerHTML = `
      <div class="h-screen"><div id="body" class="flex-1 overflow-y-auto"><div id="a"></div></div></div>`;
    // The last child's bottom margin (not in its box) makes the body scroll
    // 420 px for children that end at 400: the window needs the 420.
    layout({ body: { top: 0, bottom: 300 }, a: { top: 0, bottom: 400 } }, 300, 420);
    expect(naturalDialogHeight(document, 300)).toBe(420);
    // scrollHeight only the rounded body height (a half-pixel body): not an
    // overflow, the children's boxes decide.
    layout({ body: { top: 0.5, bottom: 300 }, a: { top: 0.5, bottom: 250.5 } }, 300, 300);
    expect(naturalDialogHeight(document, 300)).toBe(Math.ceil(300 - 299.5 + 250));
  });

  it("fits every dialog while it opens; afterwards lists follow, forms keep and analysis windows only grow", () => {
    for (const mode of ["follow", "open", "grow"] as const) {
      expect(shouldFitDialog(mode, true, 400, 0)).toBe(true);
      expect(shouldFitDialog(mode, true, 380, 400)).toBe(true);
      // Within 2 px: nothing to do.
      expect(shouldFitDialog(mode, false, 399, 400)).toBe(false);
    }
    expect(shouldFitDialog("follow", false, 300, 400)).toBe(true);
    expect(shouldFitDialog("follow", false, 500, 400)).toBe(true);
    expect(shouldFitDialog("open", false, 300, 400)).toBe(false);
    expect(shouldFitDialog("open", false, 500, 400)).toBe(false);
    expect(shouldFitDialog("grow", false, 300, 400)).toBe(false);
    expect(shouldFitDialog("grow", false, 700, 400)).toBe(true);
  });

  it("returns null for a page without the dialog layout", () => {
    document.body.innerHTML = `<div class="h-screen"><canvas></canvas></div>`;
    expect(naturalDialogHeight(document, 760)).toBeNull();
  });
});
