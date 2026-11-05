import { describe, expect, it } from "vitest";
import { analysisErrorText } from "./analysis-error";

describe("analysisErrorText", () => {
  it("writes a material's invalid values on one line", () => {
    const err = new Error('Material "Clay ru" has invalid model:\n  – The pore pressure ratio rᵤ must be at least 0 and below 1.');
    expect(analysisErrorText(err)).toBe('Material "Clay ru": The pore pressure ratio rᵤ must be at least 0 and below 1.');
    expect(analysisErrorText(new Error('Material "A" has invalid model:\n  – One.\n  – Two.'))).toBe('Material "A": One. Two.');
  });

  it("leaves other messages as they are", () => {
    expect(analysisErrorText(new Error("No valid slip surface found."))).toBe("No valid slip surface found.");
    expect(analysisErrorText("text")).toBe("text");
  });
});
