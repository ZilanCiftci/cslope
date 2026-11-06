/** The cSlope version (from package.json, set at build time). */
export const APP_VERSION: string =
  typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "";

/** The release date of this version (YYYY-MM-DD, from CHANGELOG.md), or "" when it has none. */
export const APP_RELEASE_DATE: string =
  typeof __APP_RELEASE_DATE__ === "string" ? __APP_RELEASE_DATE__ : "";

/**
 * The engine the app ships (set at build time from the engine package's
 * version and its wasm build's BUILD-INFO.json): recorded with every saved
 * result, so a result can be told from the engine that computed it. Empty
 * strings where Vite did not set it (scripts run outside a build).
 */
export const ENGINE_BUILD: { version: string; sourceHash: string } =
  typeof __ENGINE_BUILD__ === "object" && __ENGINE_BUILD__ !== null
    ? {
        version: typeof __ENGINE_BUILD__.version === "string" ? __ENGINE_BUILD__.version : "",
        sourceHash: typeof __ENGINE_BUILD__.sourceHash === "string" ? __ENGINE_BUILD__.sourceHash : "",
      }
    : { version: "", sourceHash: "" };
