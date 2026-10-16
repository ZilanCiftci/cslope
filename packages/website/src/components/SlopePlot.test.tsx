import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import plots from "@/content/generated/home-plots.json";
import type { HomePlots } from "@/content/verification-types";
import { homeExamples } from "@/content/verification";
import { SlopePlot } from "./SlopePlot";

const PLOTS = plots as unknown as HomePlots;

describe("SlopePlot", () => {
  it("every example on the home page has a plot (regenerate with bun scripts/generate-data.ts)", () => {
    const ids = homeExamples().map((e) => e.problem.id);
    expect(ids.length).toBe(3);
    expect(Object.keys(PLOTS).sort()).toEqual([...ids].sort());
  });

  it("draws the regions, the sliding mass and the slip surface, labelled", () => {
    const [id] = Object.keys(PLOTS);
    const plot = PLOTS[id];
    const { getByRole, container } = render(<SlopePlot plot={plot} label="Critical surface" />);
    expect(getByRole("img", { name: "Critical surface" })).toBeTruthy();
    // Regions, the mass and the surface (and the water line when there is one).
    expect(container.querySelectorAll("path").length).toBe(plot.regions.length + 2 + (plot.water ? 1 : 0));
    // The slip surface runs from entry to exit inside the model.
    const [x0, , x1] = plot.bounds;
    expect(plot.surface[0][0]).toBeGreaterThanOrEqual(x0);
    expect(plot.surface[plot.surface.length - 1][0]).toBeLessThanOrEqual(x1);
    expect(plot.surface[plot.surface.length - 1][0]).toBeGreaterThan(plot.surface[0][0]);
  });
});
