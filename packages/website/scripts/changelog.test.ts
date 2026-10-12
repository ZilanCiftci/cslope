// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseChangelog, releaseNotes } from "../src/content/changelog";

const SAMPLE = `# Changelog

## [0.2.0] - 2027-01-15

Faster searches.

### Analysis

- Item one
- Item two

## [0.1.0] - Unreleased

- First release
`;

describe("changelog", () => {
  it("reads versions, dates, summaries and groups", () => {
    const [b, a] = parseChangelog(SAMPLE);
    expect(b).toEqual({
      version: "0.2.0",
      date: "2027-01-15",
      summary: ["Faster searches."],
      groups: [{ title: "Analysis", items: ["Item one", "Item two"] }],
    });
    expect(a.groups).toEqual([{ title: null, items: ["First release"] }]);
  });

  it("gives one release's notes, with or without the v of the tag", () => {
    expect(releaseNotes(SAMPLE, "v0.2.0")).toBe("Faster searches.\n\n### Analysis\n\n- Item one\n- Item two");
    expect(() => releaseNotes(SAMPLE, "9.9.9")).toThrow(/no section/);
  });

  it("has a section for the desktop app's version", () => {
    const root = join(import.meta.dirname, "../../..");
    const version = JSON.parse(readFileSync(join(root, "packages/desktop/package.json"), "utf8")).version;
    expect(parseChangelog(readFileSync(join(root, "CHANGELOG.md"), "utf8")).map((r) => r.version)).toContain(version);
  });
});
