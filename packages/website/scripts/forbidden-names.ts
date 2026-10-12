/**
 * Names of other slope stability programs and their vendors. The site must
 * not mention any of them: verification sources are cited by their
 * literature reference, or as "a commercial slope stability program".
 * Every pattern has word boundaries so that ordinary words and author
 * names (e.g. "a slide of the slope") are not caught.
 */
export const FORBIDDEN_NAMES: RegExp[] = [
  // "Slide2", "Slide 6.0", "Slide3D"; not a CSS animation ("slide 1.2s")
  // or a slide counter ("slide 3 of 10").
  /\bslide\s?\d+(?:\.\d+)?d?\b(?!\.\d|\s+of\b)/gi,
  /\brocscience\b/gi,
  /\bgeo[\s-]?studio\b/gi,
  /\bslope\s?[/∕-]\s?w\b/gi,
  /\bslopew\b/gi,
  /\bgeo[\s-]?slope\b/gi,
  /\bseequent\b/gi,
  // The vendor, not the author name ("Bentley et al.").
  /\bbentley\b(?!\s+et\s+al)/gi,
  /\bplaxis\b/gi,
  /\bgeo\s?suite\b/gi,
  /\bnovapoint\b/gi,
  /\bxslope\b/gi,
  /\bgalena\b/gi,
  /\bsvslope\b/gi,
  /\bsoilvision\b/gi,
  /\boasys\b/gi,
  /\bggu\b/gi,
  /\butexas\d*\b/gi,
  /\b(?:pc|g|x)?stabl\d*\b/gi,
  /\bgeo\s?5\b/gi,
  /\bfine\s+(?:software|spol)\b/gi,
  /\b(?:rs2|rs3|phase2|settle3|swedge|rocplane|rocdata)\b/gi,
  /\bflac(?:\/slope|2d|3d)?\b/gi,
  /\bitasca\b/gi,
  /\bmidas\s?(?:gts|gen)\b/gi,
  /\bsoilworks\b/gi,
  /\bressa\b/gi,
  /\btalren\b/gi,
  /\blarix\b/gi,
  /\bsnailz\b/gi,
  // Capitalised, as a name: "Slide's circle", "SLIDE", "the Slide manual".
  /\bSlide's\b/g,
  /\bSLIDE\b/g,
  /\bSlide\s+(?:Spencer|Bishop|Janbu|value|verification|example|manual|problem|tutorial)\b/gi,
];

/**
 * Text as a reader sees it: without HTML comments (React writes
 * "Slide<!-- -->2" for adjacent text), soft hyphens and zero-width
 * characters, which would otherwise split a name.
 */
export const visibleText = (s: string) => s.replace(/<!--.*?-->/g, "").replace(/[\u00ad\u200b-\u200d\u2060\ufeff]/g, "");

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
  text.split(/\r?\n/).forEach((line, i) => {
    const content = visibleText(line);
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
