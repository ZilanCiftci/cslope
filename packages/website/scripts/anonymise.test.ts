// @vitest-environment node
import { describe, expect, it } from "vitest";
import { RELIABILITY_CASES, VERIFICATION_CASES } from "@cslope/engine";
import {
  COMMERCIAL_REFERENCE,
  anonymiseReference,
  anonymiseSource,
  anonymiseText,
  anonymiseTitle,
  publicId,
  replaceIds,
} from "./anonymise";
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

  it("credits program output to the program, not to the author of the example", () => {
    expect(anonymiseText("zone length 7.6 m (XSTABL 345 kN)")).toBe("zone length 7.6 m (program F 345 kN)");
    expect(anonymiseTitle("XSTABL slope over bedrock")).toBe("Sharma (1996) slope over bedrock");
  });

  it("drops a vendor manual's problem numbers from free text", () => {
    expect(anonymiseText("The three Slide models #64–66 differ.")).toBe("The three commercial program A models differ.");
    expect(anonymiseText("Soil #1 over Soil #2")).toBe("Soil #1 over Soil #2");
  });

  it("replaces vendors and programs in free text", () => {
    expect(anonymiseText("As drawn in Slide2's Fig. 2.1; GEO-SLOPE/Seequent manual, via xslope (github.com/njones61/xslope).")).toBe(
      "As drawn in commercial program A's Fig. 2.1; the vendor of commercial program B manual, via program D.",
    );
  });

  it("replaces the engine's ids in text with the public ones", () => {
    const ids = ["VP80a", "VP106b", "VP106e", "VP28-Ex2-L2", "VP28a"];
    expect(replaceIds("As VP80a, deeper.", ids)).toBe(`As ${publicId("VP80a")}, deeper.`);
    const all = ["VP106b", "VP106c", "VP106d", "VP106e", "VP12", "VP13"];
    expect(replaceIds("see VP106b–e", all)).toBe(
      `see ${publicId("VP106b")}, ${publicId("VP106c")}, ${publicId("VP106d")} and ${publicId("VP106e")}`,
    );
    expect(replaceIds("same as VP12-VP13", all)).toBe(`same as ${publicId("VP12")}-${publicId("VP13")}`);
    expect(replaceIds("VP28-Ex2-L2 and VP28a", ids)).toBe(`${publicId("VP28-Ex2-L2")} and ${publicId("VP28a")}`);
    expect(replaceIds("unlike VP21 (two cases)", ids)).toBe("unlike a related problem (two cases)");
  });

  it("leaves no program name in any published field of any problem", () => {
    const text = [
      ...VERIFICATION_CASES.flatMap((c) => [
        anonymiseTitle(c.title),
        anonymiseReference(c.reference).text,
        anonymiseText(c.description),
        ...(c.notes ?? []).map((n) => anonymiseText(n)),
        ...c.checks.flatMap((k) => [
          anonymiseText(k.label),
          anonymiseSource(k.publishedBy),
          anonymiseText(k.note ?? ""),
          anonymiseText(k.pending ?? ""),
        ]),
      ]),
      ...RELIABILITY_CASES.flatMap((c) => c.checks.map((k) => anonymiseSource(k[2]))),
    ].join("\n");
    expect(findForbiddenNames("data", text).map((h) => h.context)).toEqual([]);
  });

  it("leaves no engine id in any free text once the ids are replaced", () => {
    const ids = VERIFICATION_CASES.map((c) => c.id);
    const text = VERIFICATION_CASES.flatMap((c) => [
      anonymiseTitle(c.title, ids),
      anonymiseText(c.description, ids),
      ...(c.notes ?? []).map((n) => anonymiseText(n, ids)),
      ...c.checks.map((k) => anonymiseText(k.note ?? "", ids)),
    ]).join("\n");
    expect(text.match(/\b(?:VP|GS)\d[\w.-]*/g)).toBeNull();
    expect(text.match(/\b(?:models?|problems?|examples?)\s+#\d/gi)).toBeNull();
  });
});
