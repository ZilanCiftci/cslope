/**
 * Writes src/content/generated/home.json, the home page's extract of the
 * verification data: the summary and the examples of
 * src/content/home-examples.ts. scripts/generate-data.ts writes it with the
 * verification table; run this alone after changing the examples.
 *
 * Usage: bun scripts/generate-home.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homeData } from "../src/content/verification";
import type { VerificationData } from "../src/content/verification-types";

const DIR = join(import.meta.dirname, "../src/content/generated");

/** home.json's text for this verification data. */
export const homeJson = (d: VerificationData) => JSON.stringify(homeData(d), null, 1) + "\n";

/** Writes home.json from the verification table as it is on disk. */
export function writeHome(): void {
  const d = JSON.parse(readFileSync(join(DIR, "verification.json"), "utf8")) as VerificationData;
  writeFileSync(join(DIR, "home.json"), homeJson(d));
}

if (import.meta.main) {
  writeHome();
  console.log(`Wrote ${join(DIR, "home.json")}`);
}
