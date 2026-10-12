/**
 * Removes the names of other slope stability programs from verification
 * data before it is published. Literature references are kept; a value
 * that only a vendor's verification manual gives is attributed to "a
 * commercial program", with a letter per program so that a reader still
 * sees when two programs gave different values.
 *
 * This file is the only place in the website package that holds the real
 * names. It lives outside src/ and is never bundled.
 */
import { createHash } from "node:crypto";

/** Program names in source fields, in the order they are replaced. */
const PROGRAMS: [RegExp, string][] = [
  [/\bSlide2\b/g, "commercial program A"],
  [/\bSlide\b/g, "commercial program A"],
  [/\bSLOPE\/W\b/g, "commercial program B"],
  [/\bRocPlane\b/g, "commercial program C"],
  [/\bxslope\b/gi, "program D"],
  [/\bRS2\b/g, "commercial program E"],
  [/\bXSTABL\b/g, "program F"],
  [/\bUTEXAS\d*\b/g, "program G"],
];

/** Vendor names in free text. */
const VENDORS: [RegExp, string][] = [
  [/\bRocscience\b/g, "the vendor of commercial program A"],
  [/\bGEO-SLOPE(?:\/Seequent)?(?: International)?\b|\bSeequent\b/g, "the vendor of commercial program B"],
  [/\bGeoStudio\b/g, "commercial program B"],
];

/** A vendor manual's problem numbers after "model(s)", "problem(s)" or "example(s)". */
export const MANUAL_NUMBER = /\b(models?|problems?|examples?)\s+#\d+(?:\s*[–-]\s*\d+)?\b/gi;

/**
 * Free text (a description, a note) with vendor and program names
 * replaced, and links to other programs' repositories removed.
 */
export function anonymiseText(text: string, ids: readonly string[] = []): string {
  // "models #64–66": a vendor manual's problem numbers (but not "Soil #1").
  let s = replaceIds(text, ids).replace(MANUAL_NUMBER, "$1").replace(/\s*\(?(?:https?:\/\/)?github\.com\/njones61\/xslope[^\s)]*\)?/g, "");
  for (const [re, to] of TITLE_FIXES) s = s.replace(re, to);
  for (const [re, label] of VENDORS) s = s.replace(re, label);
  for (const [re, label] of PROGRAMS) s = s.replace(re, label);
  return s;
}

/** A "published by" field with program names replaced. */
export function anonymiseSource(publishedBy: string): string {
  let s = publishedBy;
  for (const [re, label] of PROGRAMS) s = s.replace(re, label);
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Clauses of a reference that cite a vendor's manual, tutorial or example. */
const VENDOR_CLAUSE =
  /slide2|slope\/w|geo-?slope|seequent|rocscience|\brs2\b|verification problem|verification manual|verification example|\btutorial\b/i;

export const COMMERCIAL_REFERENCE = "Verification manual of a commercial slope stability program.";

/**
 * A reference without the clauses that cite a vendor's manual. The text is
 * split at ". " and "; " and only whole clauses are dropped, so abbreviated
 * journal names ("Can. Geotech. J.") survive. `commercial` is true when a
 * clause was dropped; `literature` is false when nothing else was left.
 */
export function anonymiseReference(reference: string): { text: string; commercial: boolean; literature: boolean } {
  const fixed = reference
    .replace(/XSTABL example \(Sharma, 1996\)/g, "Sharma (1996)")
    .replace(/, XSTABL reference manual/g, "")
    .replace(/Caltrans SNAILZ reference manual/g, "Caltrans soil nail reference manual");
  const parts = fixed.split(/(\.\s+|;\s+)/);
  const kept: string[] = [];
  let commercial = false;
  for (let i = 0; i < parts.length; i += 2) {
    const clause = parts[i];
    const sep = parts[i + 1] ?? "";
    if (VENDOR_CLAUSE.test(clause)) {
      commercial = true;
      // "Verification Problem #12, after Bishop (1955)": keep the parts of
      // the clause that cite a dated publication and name no vendor.
      const literature = clause
        .split(/,\s+/)
        .filter((part) => !VENDOR_CLAUSE.test(part) && /\b(1[89]|20)\d\d\b/.test(part))
        .map((part) => part.replace(/^(after|from|see)\s+/i, ""));
      if (literature.length) kept.push(literature.join(", ") + sep);
      continue;
    }
    if (clause.trim()) kept.push(clause + sep);
  }
  let text = kept.join("").trim().replace(/[;,]\s*$/, "");
  if (!text) return { text: COMMERCIAL_REFERENCE, commercial: true, literature: false };
  if (!/[.)]$/.test(text)) text += ".";
  return { text, commercial, literature: true };
}

/** Titles that name a program, rewritten. */
const TITLE_FIXES: [RegExp, string][] = [
  [/\bSlide2 tutorial \d+ slope\b/g, "Tutorial slope"],
  [/\bSlide's circle\b/g, "the reference circle"],
  [/\bSlide (Spencer|Bishop) value\b/g, "reference $1 value"],
  [/\bon Slide's\b/g, "on the reference"],
  [/ \(SLOPE\/W domain\)/g, " (alternative domain)"],
  [/ \(SLOPE\/W\)/g, " (reference values)"],
  [/\bSLOPE\/W (geometry|model|crack depth)\b/g, "reference $1"],
];

/**
 * Mentions of the engine's problem ids ("as VP80a", "VP106b–e") replaced
 * with the public ids, since the engine's ids follow the vendors' manual
 * numbering. A mention that is not a problem id ("VP21" for VP21a and
 * VP21b) becomes "a related problem".
 */
const ID = /\b(?:VP|GS|RS2-)\d(?:[\w.-]*\w)?/g;

export function replaceIds(text: string, ids: readonly string[]): string {
  if (!/\b(?:VP|GS|RS2-)\d/.test(text)) return text;
  const known = new Set(ids);
  // "VP106b–e" -> "VP106b, VP106c, VP106d and VP106e": public ids have no
  // order, so a range of them would mean nothing.
  let s = text.replace(/\b((?:VP|GS)[\d.]+)([a-z])[–-]([a-z])\b/g, (_, stem: string, a: string, b: string) => {
    const ids: string[] = [];
    for (let c = a.charCodeAt(0); c <= b.charCodeAt(0); c++) ids.push(stem + String.fromCharCode(c));
    return ids.length > 1 ? `${ids.slice(0, -1).join(", ")} and ${ids.at(-1)}` : ids[0];
  });
  const replace = (m: string): string => {
    // The longest known id the match starts with, ending at a word boundary;
    // the rest ("-VP13" in "VP12-VP13") is scanned again.
    for (let end = m.length; end > 0; end--) {
      const id = m.slice(0, end);
      if (known.has(id) && !/[A-Za-z0-9]/.test(m.charAt(end))) return publicId(id) + m.slice(end).replace(ID, replace);
    }
    return "a related problem";
  };
  s = s.replace(ID, replace);
  return s;
}

export function anonymiseTitle(title: string, ids: readonly string[] = []): string {
  // The XSTABL examples are Sharma's (1996); in a title that is the source.
  let s = replaceIds(title, ids).replace(/\bXSTABL\b/g, "Sharma (1996)");
  for (const [re, to] of TITLE_FIXES) s = s.replace(re, to);
  // Titles stay short: any other mention is just "the reference".
  return s.replace(/\bSLOPE\/W\b/g, "reference");
}

/**
 * A neutral, stable id for a problem. The engine's ids follow the numbering
 * of the vendors' manuals ("VP15", "GS2.15"), which would identify them.
 */
export function publicId(id: string): string {
  return "P-" + createHash("sha1").update(id).digest("hex").slice(0, 6).toUpperCase();
}
