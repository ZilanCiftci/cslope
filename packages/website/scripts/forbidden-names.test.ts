// @vitest-environment node
import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { checkNames } from "./check-names";
import { findForbiddenNames } from "./forbidden-names";

const root = join(import.meta.dirname, "..");

describe("forbidden names", () => {
  it("are found regardless of case and spacing", () => {
    const text = "ok\nas in GeoStudio and slide 2\nSLOPE/W";
    const hits = findForbiddenNames("x", text).map((h) => `${h.line}:${h.match}`);
    expect(hits.sort()).toEqual(["2:GeoStudio", "2:slide 2", "3:SLOPE/W"]);
  });

  it("catch version and dimension suffixes, and every occurrence on a line", () => {
    const hits = findForbiddenNames("x", "Slide2D, Slide 6.0 and slide2 again").map((h) => h.match);
    expect(hits).toEqual(["Slide2D", "Slide 6.0", "slide2"]);
    expect(findForbiddenNames("x", "a  GeoStudio b")[0]).toMatchObject({ line: 1, column: 4 });
  });

  it("leave ordinary words and author names alone", () => {
    const text = "a slide of the slope; slope stability; Bishop; Bentley et al. (1998); slope with a berm";
    expect(findForbiddenNames("x", text)).toEqual([]);
    expect(findForbiddenNames("x", "animation: slide 1.2s ease-in-out; slide 3 of 10")).toEqual([]);
  });

  it("catch spelling variants, names with digits and names split by markup", () => {
    const text = "Geo-Studio, SLOPE-W, GEO 5, STABL5, PCSTABL, the Slide manual, SLIDE, Slide<!-- -->2, Geo\u00adStudio";
    expect(findForbiddenNames("x", text).map((h) => h.match)).toEqual([
      "Slide2",
      "Geo-Studio",
      "GeoStudio",
      "SLOPE-W",
      "STABL5",
      "PCSTABL",
      "GEO 5",
      "SLIDE",
      "Slide manual",
    ]);
  });

  it("report a missing directory clearly", () => {
    expect(() => checkNames([join(root, "no-such-dir")])).toThrow(/does not exist/);
  });

  it("do not appear in the site sources", () => {
    expect(checkNames(["src", "public", "index.html"].map((p) => join(root, p)))).toEqual([]);
  });
});

/** The text of a PDF, or null where poppler's pdftotext is not installed. */
function pdfText(file: string): string | null {
  if (!existsSync(file)) return null;
  try {
    return execFileSync("pdftotext", [file, "-"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  } catch {
    return null;
  }
}

describe("the public verification report, when generated locally", () => {
  // bun scripts/verification-report.ts ../website/public/verification-report.pdf --public
  const text = pdfText(join(root, "public/verification-report.pdf"));
  it.skipIf(text == null)("names no other program and shows no engine id", () => {
    expect(findForbiddenNames("verification-report.pdf", text!).map((h) => h.context)).toEqual([]);
    expect(text!.match(/\b(?:VP|GS)\d[\w.-]*/g)).toBeNull();
  });
});
