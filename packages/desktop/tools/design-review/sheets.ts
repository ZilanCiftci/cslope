#!/usr/bin/env bun
/**
 * Contact sheets of the design review captures for the visual review:
 * design-review-out/sheets/<area>-<theme>-<n>.png, up to 9 shots per sheet
 * (3 × 3) with the capture id under each, light and dark on separate
 * sheets, grouped by area (main-edit, main-result, sidebar, menus, windows,
 * dialogs, canvas). Uses ImageMagick's `montage`.
 *
 *   bun packages/desktop/tools/design-review/sheets.ts
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { OUT_DIR } from "./lib";
import type { IndexEntry } from "./run";

const PER_SHEET = 9;
const AREAS = ["main-edit", "main-result", "sidebar", "menus", "canvas", "windows", "dialogs"];

const index = JSON.parse(readFileSync(join(OUT_DIR, "index.json"), "utf-8")) as { scenes: IndexEntry[] };
const dir = join(OUT_DIR, "sheets");
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });

let sheets = 0;
for (const area of AREAS) {
  for (const theme of ["light", "dark"] as const) {
    const shots = index.scenes.filter((e) => e.area === area && e.theme === theme && e.shot);
    for (let i = 0; i < shots.length; i += PER_SHEET) {
      const part = shots.slice(i, i + PER_SHEET);
      const out = join(dir, `${area}-${theme}-${i / PER_SHEET + 1}.png`);
      const args: string[] = [];
      for (const e of part) args.push("-label", `${e.id}${e.errors.length ? " (!)" : ""}`, join(OUT_DIR, e.shot!));
      args.push(
        "-tile", "3x",
        "-geometry", "880x620>+14+14",
        "-pointsize", "20",
        "-background", theme === "dark" ? "#3a3a3a" : "#e6e6e6",
        "-fill", theme === "dark" ? "#f0f0f0" : "#111111",
        out,
      );
      execFileSync("montage", args, { stdio: "inherit" });
      sheets++;
    }
  }
}
console.log(`\n  ${sheets} contact sheets → ${dir}\n`);
