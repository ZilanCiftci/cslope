// @vitest-environment node
import { describe, expect, it } from "vitest";
import { RELIABILITY_CASES, VERIFICATION_CASES } from "@cslope/engine";
import { COMMERCIAL_REFERENCE, anonymiseReference, anonymiseSource, anonymiseTitle, publicId } from "./anonymise";
import { findForbiddenNames } from "./forbidden-names";

describe("anonymisation", () => {
  it("keeps the literature and drops the manual from a reference", () => {
    expect(
      anonymiseReference(
        "Fredlund, D.G. & Krahn, J. (1977). Can. Geotech. J. 14(3). Slide2 Verification Problem #21.",
      ),
    ).toEqual({ text: "Fredlund, D.G. & Krahn, J. (1977). Can. Geotech. J. 14(3).", commercial: true, literature: true });
    expect(
      anonymiseReference(
        "Rocscience Slide2 Slope Stability Verification Manual (2022), Verification Problem #1; Giam & Donald (1989).",
      ).text,
    ).toBe("Giam & Donald (1989).");
    expect(anonymiseReference("XSTABL example (Sharma, 1996). Slide2 Verification Problem #37.").text).toBe(
      "Sharma (1996).",
    );
  });

  it("keeps a dated citation inside a clause that also cites a manual", () => {
    expect(anonymiseReference("Slide2 Verification Problem #12, after Bishop (1955).")).toEqual({
      text: "Bishop (1955).",
      commercial: true,
      literature: true,
    });
  });

  it("attributes a reference with no literature to a commercial manual", () => {
    expect(anonymiseReference("Slide2 Verification Problem #45.")).toEqual({
      text: COMMERCIAL_REFERENCE,
      commercial: true,
      literature: false,
    });
    expect(anonymiseReference("GEO-SLOPE International, SLOPE/W example: Eurocode 7 cutting.").literature).toBe(false);
  });

  it("leaves a pure literature reference as it is", () => {
    expect(anonymiseReference("Griffiths & Lane (1999), Géotechnique 49(3).")).toEqual({
      text: "Griffiths & Lane (1999), Géotechnique 49(3).",
      commercial: false,
      literature: true,
    });
  });

  it("gives each program its own letter and keeps the qualifier", () => {
    expect(anonymiseSource("Slide2 (non-circular)")).toBe("Commercial program A (non-circular)");
    expect(anonymiseSource("SLOPE/W")).toBe("Commercial program B");
    expect(anonymiseSource("Slide2, RocPlane, Priest")).toBe("Commercial program A, commercial program C, Priest");
    expect(anonymiseSource("Duncan & Wright (reference)")).toBe("Duncan & Wright (reference)");
  });

  it("gives stable ids that do not reveal the manual's numbering", () => {
    expect(publicId("VP15")).toBe(publicId("VP15"));
    expect(publicId("VP15")).toMatch(/^P-[0-9A-F]{6}$/);
    expect(publicId("VP15")).not.toBe(publicId("VP16"));
    const ids = VERIFICATION_CASES.map((c) => publicId(c.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("leaves no program name in any published field of any problem", () => {
    const text = [
      ...VERIFICATION_CASES.flatMap((c) => [
        anonymiseTitle(c.title),
        anonymiseReference(c.reference).text,
        ...c.checks.flatMap((k) => [k.label, anonymiseSource(k.publishedBy)]),
      ]),
      ...RELIABILITY_CASES.flatMap((c) => c.checks.map((k) => anonymiseSource(k[2]))),
    ].join("\n");
    expect(findForbiddenNames("data", text).map((h) => h.context)).toEqual([]);
  });
});
