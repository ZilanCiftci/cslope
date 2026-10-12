/** ROT13: the patterns below are stored with it so that this repository
 * does not spell out the names it guards against. It is its own inverse. */
export const rot13 = (s: string) =>
  s.replace(/[a-z]/gi, (c) => {
    const base = c <= "Z" ? 65 : 97;
    return String.fromCharCode(((c.charCodeAt(0) - base + 13) % 26) + base);
  });

/**
 * Names of other slope stability programs and their vendors, as ROT13 of
 * each pattern's source (decode one with rot13() to read it). Neither the
 * site, the public report nor this repository may mention any of them:
 * verification sources are cited by their literature reference, or as "a
 * commercial slope stability program". Every pattern has word boundaries,
 * and the case-sensitive ones need a capital or a following word, so that
 * ordinary words ("a slide of the slope"), a CSS animation ("slide 1.2s"),
 * a slide counter, an author's name or "audio/flac" are not caught.
 */
const ENCODED: [source: string, flags: string][] = [
  [String.raw`\ofyvqr\f?\q+(?:\.\q+)?q?\o(?!\.\q|\f+bs\f+\q)`, "gi"],
  [String.raw`\oebpfpvrapr\o`, "gi"],
  [String.raw`\otrb[\f-]?fghqvb\o`, "gi"],
  [String.raw`\ofybcr\f?[/\h2215-]\f?j\o`, "gi"],
  [String.raw`\ofybcrj\o`, "gi"],
  [String.raw`\otrb[\f-]?fybcr\o`, "gi"],
  [String.raw`\ofrrdhrag\o`, "gi"],
  [String.raw`\ooragyrl\f+flfgrzf\o`, "gi"],
  [String.raw`\ocynkvf\o`, "gi"],
  [String.raw`\otrb\f?fhvgr\o`, "gi"],
  [String.raw`\oabincbvag\o`, "gi"],
  [String.raw`\okfybcr\o`, "gi"],
  [String.raw`\otnyran\o`, "gi"],
  [String.raw`\ofifybcr\o`, "gi"],
  [String.raw`\ofbvyivfvba\o`, "gi"],
  [String.raw`\obnflf\o`, "gi"],
  [String.raw`\otth\o`, "gi"],
  [String.raw`\ohgrknf\q*\o`, "gi"],
  [String.raw`\o(?:cp|t|k)?fgnoy\q*\o`, "gi"],
  [String.raw`\otrb\f?5\o`, "gi"],
  [String.raw`\osvar\f+(?:fbsgjner|fcby)\o`, "gi"],
  [String.raw`\o(?:ef2|ef3|cunfr2|frggyr3|fjrqtr|ebpcynar|ebpqngn)\o`, "gi"],
  [String.raw`(?<!nhqvb\/)\osynp(?:\/fybcr|2q|3q)?\o`, "gi"],
  [String.raw`\ovgnfpn\o`, "gi"],
  [String.raw`\ozvqnf\f?(?:tgf|tra)\o`, "gi"],
  [String.raw`\ofbvyjbexf\o`, "gi"],
  [String.raw`\oerffn\o`, "gi"],
  [String.raw`\ognyera\o`, "gi"],
  [String.raw`\oynevk\o`, "gi"],
  [String.raw`\ofanvym\o`, "gi"],
  [String.raw`\oFyvqr'f\o`, "g"],
  [String.raw`\oFYVQR\o`, "g"],
  [String.raw`\oFyvqr\f+(?:Fcrapre|Ovfubc|Wnaoh|inyhr|irevsvpngvba|rknzcyr|znahny|ceboyrz|ghgbevny)\o`, "g"],
  [String.raw`\oFyvqr\f+(?:Irevsvpngvba|Znahny|Ceboyrz|Rknzcyr)\o`, "g"],
];

export const FORBIDDEN_NAMES: RegExp[] = ENCODED.map(([source, flags]) => new RegExp(rot13(source), flags));

/**
 * Text as a reader sees it: without React's empty comments (it writes
 * "Name<!-- -->2" for adjacent text), soft hyphens and zero-width
 * characters, which would otherwise split a name.
 */
export const visibleText = (s: string) => s.replace(/<!--\s*-->/g, "").replace(/[\u00ad\u200b-\u200d\u2060\ufeff]/g, "");

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
