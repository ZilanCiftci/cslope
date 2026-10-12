/** Site-wide facts and links, in one place. */
export const SITE = {
  name: "cSlope",
  tagline: "Slope stability analysis you can verify",
  description:
    "Open source limit equilibrium software for slope stability analysis, verified against published solutions.",
  github: "https://github.com/ZilanCiftci/cslope",
  releases: "https://github.com/ZilanCiftci/cslope/releases",
  issues: "https://github.com/ZilanCiftci/cslope/issues",
  company: { name: "Ibirico", url: "https://ibirico.se" },
  licence: "MIT",
} as const;

export interface NavLink {
  to: string;
  label: string;
}

/** The main navigation. Every link must be a page in routes.tsx. */
export const NAV: NavLink[] = [
  { to: "/features", label: "Features" },
  { to: "/verification", label: "Verification" },
  { to: "/docs", label: "Docs" },
  { to: "/changelog", label: "Changelog" },
];

/** The product links in the footer. Every link must be a page in routes.tsx. */
export const FOOTER_PRODUCT: NavLink[] = [
  { to: "/features", label: "Features" },
  { to: "/verification", label: "Verification" },
  { to: "/download", label: "Download" },
  { to: "/docs", label: "Documentation" },
  { to: "/changelog", label: "Changelog" },
];
