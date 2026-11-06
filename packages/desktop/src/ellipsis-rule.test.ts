/// <reference types="node" />
/**
 * The "…" rule (docs/design-rules.md, Voice; decision D-06): never three
 * periods in a user-visible string, and no "…" at the end of progress
 * text ("Analyzing", not "Analyzing…"). Spread syntax ("...props") is code,
 * not text, so only periods right after a word and right before a quote,
 * a backtick or a tag count.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// (vitest runs from packages/desktop; under jsdom import.meta.url is not a file URL)
const SRC = join(process.cwd(), "src");

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

/** Lines of `src` that match `re`, as "file:line: text". */
function offenders(re: RegExp): string[] {
  const out: string[] = [];
  for (const path of files(SRC)) {
    readFileSync(path, "utf8")
      .split("\n")
      .forEach((line, i) => {
        if (re.test(line)) out.push(`${relative(SRC, path)}:${i + 1}: ${line.trim()}`);
      });
  }
  return out;
}

describe("the \"…\" rule", () => {
  it("no user-visible string uses three periods", () => {
    expect(offenders(/[A-Za-z)]\.\.\.["'`<]/)).toEqual([]);
  });

  it("progress text does not end with \"…\"", () => {
    expect(offenders(/["'`>](Analyzing|Loading|Saving|Opening|Waiting|Running|Exporting|Importing)[^"'`<]*…["'`<]/)).toEqual([]);
  });
});
