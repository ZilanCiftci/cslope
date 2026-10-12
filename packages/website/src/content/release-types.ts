/** The latest GitHub release, as scripts/latest-release.ts finds it at build time. */
export interface LatestRelease {
  tag: string;
  /** The tag without the "v". */
  version: string;
  /** The release page. */
  url: string;
  /** Download URL of the Windows installer, if the release has one. */
  installer?: string;
  /** Download URL of the verification report, if the release has one. */
  report?: string;
}
