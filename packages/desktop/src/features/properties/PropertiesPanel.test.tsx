import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { PropertiesPanel } from "./PropertiesPanel";

describe("PropertiesPanel", () => {
  it("points to the ribbon for the analysis controls", () => {
    render(<PropertiesPanel />);
    expect(screen.getByText("Analysis controls moved")).toBeInTheDocument();
    expect(screen.getByText(/Model > Analysis in the ribbon/)).toHaveTextContent(
      /Search limits, Custom\s+search planes, and Options/,
    );
  });
});
