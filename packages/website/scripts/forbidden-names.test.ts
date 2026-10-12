// @vitest-environment node
import { describe, expect, it } from "vitest";
import { join } from "node:path";
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
    const text = "a slide of the slope; slope stability; Bishop; Bentley et al. (1998)";
    expect(findForbiddenNames("x", text)).toEqual([]);
  });

  it("report a missing directory clearly", () => {
    expect(() => checkNames([join(root, "no-such-dir")])).toThrow(/does not exist/);
  });

  it("do not appear in the site sources", () => {
    expect(checkNames(["src", "public", "index.html"].map((p) => join(root, p)))).toEqual([]);
  });
});
