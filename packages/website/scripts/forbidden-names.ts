/**
 * Names of other slope stability programs and their vendors. The site must
 * not mention any of them: verification sources are cited by their
 * literature reference, or as "a commercial slope stability program".
 * Every pattern has word boundaries so that ordinary words and author
 * names (e.g. "a slide of the slope") are not caught.
 */
export const FORBIDDEN_NAMES: RegExp[] = [
  /\bslide\s?\d+(?:\.\d+)?d?\b/gi,
  /\brocscience\b/gi,
  /\bgeo\s?studio\b/gi,
  /\bslope\s?\/\s?w\b/gi,
  /\bgeo-?slope\b/gi,
  /\bseequent\b/gi,
  /\bbentley\s+systems\b/gi,
  /\bplaxis\b/gi,
  /\bgeo\s?suite\b/gi,
  /\bxslope\b/gi,
  /\bgalena\b/gi,
  /\bsvslope\b/gi,
  /\bsoilvision\b/gi,
  /\boasys\b/gi,
  /\bggu\b/gi,
  /\butexas\d*\b/gi,
  /\bstabl\b/gi,
  /\bgeo5\b/gi,
  /\bxstabl\b/gi,
  /\brs2\b/gi,
  /\brocplane\b/gi,
  // Capitalised, as a name: "Slide's circle", "Slide Spencer value".
  /\bSlide's\b/g,
  /\bSlide\s+(?:Spencer|Bishop|Janbu|value|verification|example)\b/g,
];

export interface NameHit {
  file: string;
  line: number;
  column: number;
  match: string;
  /** Up to 40 characters on either side, for minified files. */
  context: string;
}

/** Every occurrence of a forbidden name in `text`. */
export function findForbiddenNames(file: string, text: string): NameHit[] {
  const hits: NameHit[] = [];
  text.split(/\r?\n/).forEach((content, i) => {
    for (const re of FORBIDDEN_NAMES) {
      for (const m of content.matchAll(re)) {
        const at = m.index;
        hits.push({
          file,
          line: i + 1,
          column: at + 1,
          match: m[0],
          context: content.slice(Math.max(0, at - 40), at + m[0].length + 40),
        });
      }
    }
  });
  return hits;
}

/** Files whose text should be searched (not images or fonts). */
export const TEXT_FILE = /\.(html?|m?[jt]sx?|css|json|md|mdx|txt|xml|svg|webmanifest)$/i;
