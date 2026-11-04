/**
 * Fails when a build carries the project data that is kept on the
 * developer's machine only (src/store/lovo.local.ts, ignored by git).
 * src/store/local-models.ts imports that file in development only; this
 * proves it after every `vite build`: the package script runs it before
 * electron-builder, the release before packaging. The marker is the file's
 * module name, which only its import (or a chunk made from it) brings into
 * a bundle.
 *
 *   bun scripts/check-local-data.ts [dist dist-electron]
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const MARKER = "lovo.local";
const TEXT_FILE = /\.(js|mjs|cjs|css|html|json|map|txt)$/i;

function walk(path: string): string[] {
  if (!existsSync(path)) throw new Error(`${path} does not exist (run the build first?)`);
  return statSync(path).isDirectory() ? readdirSync(path).flatMap((name) => walk(join(path, name))) : [path];
}

/** The files under `dirs` that name or contain the local data. */
export function localDataHits(dirs: string[]): string[] {
  return dirs.flatMap(walk).filter((f) => f.toLowerCase().includes(MARKER) || (TEXT_FILE.test(f) && readFileSync(f, "utf8").includes(MARKER)));
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  let hits: string[];
  try {
    hits = localDataHits(args.length ? args : ["dist", "dist-electron"]);
  } catch (e) {
    console.error((e as Error).message);
    process.exit(1);
  }
  if (hits.length) {
    console.error(`The build carries the local project data (${MARKER}) in:\n  ${hits.join("\n  ")}\nIt must never be bundled (src/store/local-models.ts).`);
    process.exit(1);
  }
  console.log("The build carries no local project data.");
}
