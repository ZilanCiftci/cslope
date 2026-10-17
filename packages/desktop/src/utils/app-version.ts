/** The cSlope version (from package.json, set at build time). */
export const APP_VERSION: string =
  typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "";
