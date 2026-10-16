// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { REPORT } from "../src/content/report";

const read = (f: string) => JSON.parse(readFileSync(join(import.meta.dirname, "..", f), "utf8"));

describe("verification report", () => {
  it("is written by the deploy build where the page links it, after the table", () => {
    const scripts = read("package.json").scripts as Record<string, string>;
    expect(read("vercel.json").buildCommand).toBe("bun run build:deploy");
    const deploy = scripts["build:deploy"].split(" && ");
    expect(deploy).toEqual(["bun scripts/generate-data.ts", "bun run report", "bun run build"]);
    expect(scripts.report).toContain(`public${REPORT} --public`);
  });
});
