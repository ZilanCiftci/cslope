// The .cslp format version and the project schema version are the same in
// the app (packages/desktop: CSLP_FORMAT_VERSION and CSLP_MIN_READER_VERSION
// in features/project/cslp.ts, PROJECT_FILE_VERSION in store/persistence.ts)
// and in the Rust reader and writer (crates/cslope-project/src/project.rs:
// FORMAT_VERSION, MIN_READER_VERSION, PROJECT_SCHEMA_VERSION). Exits 1 when
// they differ: change both, and release the Python package with the app
// (docs/file-format.md section 3).
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "../..");
const read = (rel: string) => readFileSync(join(root, rel), "utf8");

function constant(rel: string, pattern: RegExp, what: string): number {
  const m = pattern.exec(read(rel));
  if (!m) throw new Error(`${rel}: ${what} not found`);
  return Number(m[1]);
}

const cslp = "desktop/src/features/project/cslp.ts";
const persistence = "desktop/src/store/persistence.ts";
const rust = "engine-rs/crates/cslope-project/src/project.rs";
const pairs: [string, number, number][] = [
  [
    "format version",
    constant(cslp, /export const CSLP_FORMAT_VERSION = (\d+);/, "CSLP_FORMAT_VERSION"),
    constant(rust, /pub const FORMAT_VERSION: u32 = (\d+);/, "FORMAT_VERSION"),
  ],
  [
    "oldest reader",
    constant(cslp, /export const CSLP_MIN_READER_VERSION = (\d+);/, "CSLP_MIN_READER_VERSION"),
    constant(rust, /pub const MIN_READER_VERSION: u32 = (\d+);/, "MIN_READER_VERSION"),
  ],
  [
    "project schema version",
    constant(persistence, /export const PROJECT_FILE_VERSION = (\d+);/, "PROJECT_FILE_VERSION"),
    constant(rust, /pub const PROJECT_SCHEMA_VERSION: u32 = (\d+);/, "PROJECT_SCHEMA_VERSION"),
  ],
];
let ok = true;
for (const [what, app, crate] of pairs) {
  if (app !== crate) {
    ok = false;
    console.error(`The ${what} differs: ${app} in the app, ${crate} in cslope-project. Change both (and release the Python package with the app).`);
  } else console.log(`${what}: ${app}`);
}
process.exit(ok ? 0 : 1);
