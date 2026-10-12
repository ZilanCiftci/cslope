/** The year of the build (vite.config.ts). */
declare const __BUILD_YEAR__: number;

/** The latest GitHub release, or null before the first (scripts/latest-release.ts). */
declare const __LATEST_RELEASE__: import("./content/release-types").LatestRelease | null;
