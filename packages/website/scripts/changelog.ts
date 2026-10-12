/**
 * Prints one version's notes from CHANGELOG.md, for the release workflow.
 *
 *   bun scripts/changelog.ts 0.1.0 [notes.md]
 *
 * With a file name the notes are written as UTF-8 to that file (a shell
 * pipe on Windows would re-encode them).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { releaseNotes } from "../src/content/changelog";

const version = process.argv[2];
if (!version) throw new Error("usage: bun scripts/changelog.ts <version>");
const notes = releaseNotes(readFileSync(join(import.meta.dirname, "../../../CHANGELOG.md"), "utf8"), version);
if (process.argv[3]) writeFileSync(process.argv[3], notes + "\n");
else console.log(notes);
