/**
 * Prints one version's notes from CHANGELOG.md, for the release workflow.
 *
 *   bun scripts/changelog.ts 0.1.0 [notes.md] [--release]
 *
 * --release (the release workflow) also fails while the version's section
 * is still marked "Unreleased" instead of dated.
 * With a file name the notes are written as UTF-8 to that file (a shell
 * pipe on Windows would re-encode them).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseChangelog, releaseNotes } from "../src/content/changelog";

const [version, file] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
if (!version) throw new Error("usage: bun scripts/changelog.ts <version> [notes.md] [--release]");
const text = readFileSync(join(import.meta.dirname, "../../../CHANGELOG.md"), "utf8");
const notes = releaseNotes(text, version);
if (process.argv.includes("--release")) {
  const date = parseChangelog(text).find((r) => r.version === version.replace(/^v/, ""))?.date;
  if (!date || /unreleased/i.test(date)) throw new Error(`Date the ${version} section of CHANGELOG.md before releasing.`);
}
if (file) writeFileSync(file, notes + "\n");
else console.log(notes);
