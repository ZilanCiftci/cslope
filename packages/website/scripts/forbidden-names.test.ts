// @vitest-environment node
import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { checkNames } from "./check-names";
import { FORBIDDEN_NAMES, findForbiddenNames, rot13 } from "./forbidden-names";

const root = join(import.meta.dirname, "..");

/** The names in these tests are ROT13 (see forbidden-names.ts), so that the
 * repository does not spell them out; the rest of each text is plain. */
const n = rot13;

describe("forbidden names", () => {
  it("are found regardless of case and spacing", () => {
    const text = `ok\nas in ${n("TrbFghqvb")} and ${n("fyvqr 2")}\n${n("FYBCR/J")}`;
    const hits = findForbiddenNames("x", text).map((h) => `${h.line}:${h.match}`);
    expect(hits.sort()).toEqual([`2:${n("TrbFghqvb")}`, `2:${n("fyvqr 2")}`, `3:${n("FYBCR/J")}`]);
  });

  it("catch version and dimension suffixes, and every occurrence on a line", () => {
    const hits = findForbiddenNames("x", `${n("Fyvqr2Q")}, ${n("Fyvqr 6.0")} and ${n("fyvqr2")} again`).map((h) => h.match);
    expect(hits).toEqual([n("Fyvqr2Q"), n("Fyvqr 6.0"), n("fyvqr2")]);
    expect(findForbiddenNames("x", `a  ${n("TrbFghqvb")} b`)[0]).toMatchObject({ line: 1, column: 4 });
  });

  it("leave ordinary words and author names alone", () => {
    const text = "a slide of the slope; slope stability; Bishop; Bentley et al. (1998); slope with a berm";
    expect(findForbiddenNames("x", text)).toEqual([]);
    expect(findForbiddenNames("x", "animation: slide 1.2s ease-in-out; slide 3 of 10")).toEqual([]);
    const prose = "the slide problem, a slide example; Bentley (1998); Bentley and Smith; audio/flac";
    expect(findForbiddenNames("x", prose)).toEqual([]);
    expect(findForbiddenNames("x", `${n("Fyvqr2")} of the manual`).map((h) => h.match)).toEqual([n("Fyvqr2")]);
  });

  it("catch spelling variants, names with digits and names split by markup", () => {
    const names = ["Trb-Fghqvb", "FYBCR-J", "TRB 5", "FGNOY5", "CPFGNOY"].map(n).join(", ");
    const text = `${names}, the ${n("Fyvqr")} manual, ${n("FYVQR")}, ${n("Fyvqr")}<!-- -->2, ${n("Trb")}\u00ad${n("Fghqvb")}`;
    expect(findForbiddenNames("x", text).map((h) => h.match)).toEqual(
      ["Fyvqr2", "Trb-Fghqvb", "TrbFghqvb", "FYBCR-J", "FGNOY5", "CPFGNOY", "TRB 5", "FYVQR", "Fyvqr znahny"].map(n),
    );
  });

  it("decode to readable patterns", () => {
    expect(rot13(rot13("Abc-xyz 2"))).toBe("Abc-xyz 2");
    expect(FORBIDDEN_NAMES.every((re) => re.source.startsWith("\\b") || re.source.startsWith("(?<!"))).toBe(true);
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
