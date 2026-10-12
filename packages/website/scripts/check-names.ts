/**
 * Fails when a forbidden name (see forbidden-names.ts) appears in any text
 * file under the given files and directories. Run on dist/ after every build.
 *
 *   bun scripts/check-names.ts dist
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { TEXT_FILE, findForbiddenNames, type NameHit } from "./forbidden-names";

/** The files under `path`, or `path` itself when it is a file. */
function walk(path: string): string[] {
  if (!existsSync(path)) throw new Error(`${path} does not exist (run the build first?)`);
  return statSync(path).isDirectory() ? readdirSync(path).flatMap((name) => walk(join(path, name))) : [path];
}

export function checkNames(dirs: string[]): NameHit[] {
  return dirs
    .flatMap(walk)
    .filter((f) => TEXT_FILE.test(f))
    .flatMap((f) => findForbiddenNames(f, readFileSync(f, "utf8")));
}

if (import.meta.main) {
  const dirs = process.argv.slice(2);
  let hits: NameHit[];
  try {
    hits = checkNames(dirs.length ? dirs : ["dist"]);
  } catch (e) {
    console.error((e as Error).message);
    process.exit(1);
  }
  for (const h of hits) console.error(`${h.file}:${h.line}:${h.column}: "${h.match}" in …${h.context}…`);
  if (hits.length) {
    console.error(`\n${hits.length} forbidden name(s) found. The site must not name other programs.`);
    process.exit(1);
  }
  console.log("No forbidden names found.");
}
