// @vitest-environment node
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { REPORT } from "../src/content/report";

describe("verification report", () => {
  it("is served with the site (regenerate with bun run report)", () => {
    const file = join(import.meta.dirname, "../public", REPORT);
    expect(existsSync(file)).toBe(true);
    expect(readFileSync(file).subarray(0, 5).toString()).toBe("%PDF-");
  });
});
