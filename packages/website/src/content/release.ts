import desktop from "../../../desktop/package.json";
import { SITE } from "@/site";

/** The desktop app's version, as the next release will carry it. */
export const APP_VERSION: string = desktop.version;

/** The Windows installer's file name, as electron-builder.json5 names it. */
export const WINDOWS_INSTALLER = `cSlope-Windows-${APP_VERSION}-Setup.exe`;

/** The release page of the latest version. */
export const LATEST_RELEASE = `${SITE.releases}/latest`;
