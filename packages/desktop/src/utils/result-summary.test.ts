import { describe, expect, it } from "vitest";
import { equilibriumGapText, surfaceCountText } from "./result-summary";

describe("surfaceCountText", () => {
  it("adds the number of surfaces below 1.0", () => {
    expect(surfaceCountText({ allSurfaces: [{ fos: 1.2 }, { fos: 1.5 }] })).toBe("2");
    expect(surfaceCountText({ allSurfaces: [{ fos: 0.9 }, { fos: 0.99 }, { fos: 1.5 }] })).toBe("3 (2 below 1.0)");
  });
});

describe("equilibriumGapText", () => {
  it("says that only the closest pair was found, with the gap", () => {
    expect(equilibriumGapText(0.0196)).toBe("No complete equilibrium: force equilibrium met within 0.020 (closest λ)");
  });
});
