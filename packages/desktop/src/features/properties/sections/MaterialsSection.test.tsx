import { beforeEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { useAppStore } from "../../../store/app-store";
import { MaterialsSection } from "./MaterialsSection";

const DEFAULT_ID = "mat-1";

function resetStore(overrides: Record<string, unknown> = {}) {
  useAppStore.setState({
    activeSection: "Materials",
    materials: [
      {
        id: DEFAULT_ID,
        name: "Clay",
        unitWeight: 18,
        frictionAngle: 25,
        cohesion: 10,
        color: "#d4a373",
        model: {
          kind: "mohr-coulomb" as const,
          unitWeight: 18,
          cohesion: 10,
          frictionAngle: 25,
        },
      },
    ],
    ...overrides,
  });
}

describe("MaterialsSection — validation", () => {
  beforeEach(() => resetStore());

  it("shows no validation errors for a valid Mohr-Coulomb model", () => {
    render(<MaterialsSection />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows error when both cohesion and friction angle are zero", () => {
    resetStore({
      materials: [
        {
          id: DEFAULT_ID,
          name: "Bad",
          unitWeight: 18,
          frictionAngle: 0,
          cohesion: 0,
          color: "#d4a373",
          model: {
            kind: "mohr-coulomb" as const,
            unitWeight: 18,
            cohesion: 0,
            frictionAngle: 0,
          },
        },
      ],
    });
    render(<MaterialsSection />);
    const alert = screen.getByRole("alert");
    expect(alert).toBeInTheDocument();
    expect(alert.textContent).toContain("no strength");
  });

  it("shows error when unit weight is zero", () => {
    resetStore({
      materials: [
        {
          id: DEFAULT_ID,
          name: "Bad",
          unitWeight: 0,
          frictionAngle: 30,
          cohesion: 10,
          color: "#d4a373",
          model: {
            kind: "mohr-coulomb" as const,
            unitWeight: 0,
            cohesion: 10,
            frictionAngle: 30,
          },
        },
      ],
    });
    render(<MaterialsSection />);
    const alert = screen.getByRole("alert");
    expect(alert).toBeInTheDocument();
    expect(alert.textContent).toContain("Unit weight");
  });

  it("shows error for undrained model with negative Su", () => {
    resetStore({
      materials: [
        {
          id: DEFAULT_ID,
          name: "Weak",
          unitWeight: 18,
          frictionAngle: 0,
          cohesion: 0,
          color: "#d4a373",
          model: {
            kind: "undrained" as const,
            unitWeight: 18,
            undrainedShearStrength: -5,
          },
        },
      ],
    });
    render(<MaterialsSection />);
    const alert = screen.getByRole("alert");
    expect(alert).toBeInTheDocument();
    expect(alert.textContent).toContain("Undrained");
  });

  it("shows error for spatial-mohr-coulomb with no data points", () => {
    resetStore({
      materials: [
        {
          id: DEFAULT_ID,
          name: "Spatial",
          unitWeight: 18,
          frictionAngle: 0,
          cohesion: 0,
          color: "#d4a373",
          model: {
            kind: "spatial-mohr-coulomb" as const,
            unitWeight: 18,
            dataPoints: [],
          },
        },
      ],
    });
    render(<MaterialsSection />);
    const alert = screen.getByRole("alert");
    expect(alert).toBeInTheDocument();
    expect(alert.textContent).toContain("at least 1");
  });

  it("shows no errors for valid high-strength model", () => {
    resetStore({
      materials: [
        {
          id: DEFAULT_ID,
          name: "Rock",
          unitWeight: 24,
          frictionAngle: 0,
          cohesion: 0,
          color: "#888888",
          model: {
            kind: "high-strength" as const,
            unitWeight: 24,
          },
        },
      ],
    });
    render(<MaterialsSection />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows errors for s-f-depth with fewer than 2 points", () => {
    resetStore({
      materials: [
        {
          id: DEFAULT_ID,
          name: "Depth",
          unitWeight: 18,
          frictionAngle: 0,
          cohesion: 0,
          color: "#d4a373",
          model: {
            kind: "s-f-depth" as const,
            unitWeight: 18,
            strengthFunction: [[0, 20]],
          },
        },
      ],
    });
    render(<MaterialsSection />);
    const alert = screen.getByRole("alert");
    expect(alert).toBeInTheDocument();
    expect(alert.textContent).toContain("at least 2");
  });
});
