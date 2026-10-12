/**
 * Fails when a forbidden name (see forbidden-names.ts) appears in any text
 * file under the given files and directories. Run on dist/ after every build,
 * and on every file git tracks in CI: the repository is public too.
 *
 *   bun scripts/check-names.ts dist
 *   bun scripts/check-names.ts --repo
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
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

/** Every text file git tracks, as paths from the current directory. */
export function trackedFiles(): string[] {
  const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
  return execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
    .split("\0")
    .filter((f) => f && TEXT_FILE.test(f) && existsSync(join(root, f)))
    .map((f) => join(root, f));
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  let hits: NameHit[];
  try {
    hits = args.includes("--repo") ? checkNames(trackedFiles()) : checkNames(args.length ? args : ["dist"]);
  } catch (e) {
    console.error((e as Error).message);
    process.exit(1);
  }
  for (const h of hits) console.error(`${h.file}:${h.line}:${h.column}: "${h.match}" in …${h.context}…`);
  if (hits.length) {
    console.error(`\n${hits.length} forbidden name(s) found. Neither the site nor the repository may name other programs.`);
    process.exit(1);
  }
  console.log("No forbidden names found.");
}
