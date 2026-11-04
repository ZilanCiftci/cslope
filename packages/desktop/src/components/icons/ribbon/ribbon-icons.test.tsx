import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import type { ComponentType } from "react";
import * as icons from "./index";

type Icon = ComponentType<{ size?: number; strokeWidth?: number; color?: string }>;
const entries = Object.entries(icons as unknown as Record<string, Icon>);

describe("ribbon icons", () => {
  it("exports the chosen set", () => {
    expect(entries.length).toBeGreaterThan(40);
  });

  it.each(entries)("%s renders a 24 x 24 svg, hidden from assistive technology", (_, Icon) => {
    const { container } = render(<Icon size={16} strokeWidth={1.5} color="red" />);
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg!.getAttribute("viewBox")).toBe("0 0 24 24");
    expect(svg!.getAttribute("width")).toBe("16");
    expect(svg!.getAttribute("height")).toBe("16");
    expect(svg!.getAttribute("stroke-width")).toBe("1.5");
    expect(svg!.getAttribute("aria-hidden")).toBe("true");
  });
});
