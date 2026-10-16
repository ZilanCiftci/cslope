/**
 * The public edition of the verification report, served with the site.
 * The deploy build (`bun run build:deploy`, Vercel) runs the engine and
 * writes it, after regenerating the table, so both follow the engine;
 * `bun run report` makes it locally. Releases attach it as well.
 */
export const REPORT = "/cSlope-verification-report.pdf";
