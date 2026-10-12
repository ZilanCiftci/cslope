// @vitest-environment node
import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { scenes } from "../src/content/media-scenes";

const media = join(import.meta.dirname, "../public/media");
const outputOf = (s: (typeof scenes)[number]) => `${s.output.dir ?? "generated"}/${s.output.filename}`;

describe("media scenes", () => {
  it("have unique ids and output files", () => {
    expect(new Set(scenes.map((s) => s.id)).size).toBe(scenes.length);
    expect(new Set(scenes.map(outputOf)).size).toBe(scenes.length);
  });

  it("name a window for every window capture", () => {
    expect(scenes.filter((s) => s.output.crop === "window" && !s.output.window).map((s) => s.id)).toEqual([]);
  });

  it("have been captured (run bun run media:capture after adding one)", () => {
    expect(scenes.map(outputOf).filter((f) => !existsSync(join(media, f)))).toEqual([]);
  });
});
