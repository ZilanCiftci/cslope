/**
 * The verification examples on the home page: problem and analysis (as
 * cSlope names it), chosen to show layered slopes. The page shows the
 * source's value, the other programs' range and cSlope's result, and the
 * result plot exported from the app (media-scenes.ts captures one per
 * entry).
 */
export const HOME_EXAMPLES: { id: string; method: string }[] = [
  // ACADS 1(c), three layers (the app's "T-ACADS Non-Homogeneous").
  { id: "V049", method: "Spencer" },
  // Chowdhury & Xu (1995) example 2, Congress Street cut.
  { id: "V021d", method: "Bishop simplified" },
  // Greco (1996) ex. 5 / Chen & Shao, weak seam.
  { id: "V053", method: "Spencer, non-circular" },
];
