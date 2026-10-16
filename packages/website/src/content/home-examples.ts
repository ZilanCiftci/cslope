/**
 * The verification examples on the home page: problem and check (index
 * into its checks), chosen to show layered slopes. The page shows the
 * check's reference and computed value, and the result plot exported from
 * the app (media-scenes.ts captures one per entry).
 */
export const HOME_EXAMPLES: { id: string; check: number }[] = [
  // ACADS 1(c), three layers (the app's "T-ACADS Non-Homogeneous"): Spencer.
  { id: "V049", check: 1 },
  // Chowdhury & Xu (1995) example 2, Congress Street cut: their own Bishop value.
  { id: "V021d", check: 1 },
  // Greco (1996) ex. 5 / Chen & Shao, weak seam: the block search's Spencer value.
  { id: "V053", check: 0 },
];
