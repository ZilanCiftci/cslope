import desktop from "../../../desktop/package.json";

/** The desktop app's version, as the next release will carry it. */
export const APP_VERSION: string = desktop.version;


/**
 * The latest published release, looked up when the site is built; null
 * before the first release, when there is nothing to download yet.
 */
export const LATEST = __LATEST_RELEASE__;

/** The version on offer: the latest release's, or the coming one's. */
export const OFFERED_VERSION = LATEST?.version ?? APP_VERSION;

/** The Windows installer's file name, as electron-builder.json5 names it. */
export const WINDOWS_INSTALLER = `cSlope-Windows-${OFFERED_VERSION}-Setup.exe`;

