/** Site-wide facts and links, in one place. */
export const SITE = {
  name: "cSlope",
  /** The home page's title after the name. */
  tagline: "Open source slope stability software",
  /** The home page's description in search results and link previews. */
  metaDescription:
    "Open source slope stability software. Limit equilibrium analysis by Bishop, Janbu and Morgenstern-Price on circular and non-circular slip surfaces.",
  description:
    "Open source limit equilibrium software for slope stability analysis.",
  github: "https://github.com/ZilanCiftci/cslope",
  releases: "https://github.com/ZilanCiftci/cslope/releases",
  issues: "https://github.com/ZilanCiftci/cslope/issues",
  /** cSlope in the browser (packages/web): templates analyzed without installing. */
  app: "https://app.cslope.com",
  /**
   * A filled-in section on app.cslope.com, opened from the home page: the
   * excavation template, a crust over clay with a haul road (the web app's
   * smoke test, FILLED in packages/web/scripts/smoke.ts).
   * The page's screenshot is captured at this link (scripts/capture-web.ts).
   */
  appExample:
    "https://app.cslope.com/?t=excavation&ground=0&H=4&slope=2&water=-1&layers=2" +
    "&layer1.name=Crust&layer1.kind=mohr-coulomb&layer1.t=1.5&layer1.gamma=18&layer1.c=2&layer1.phi=32" +
    "&layer2.name=Clay&layer2.kind=undrained&layer2.t=18.5&layer2.gamma=16.5&layer2.su=18&layer2.suRate=1.2" +
    "&road=on&road.distanceFromCrest=2&road.width=4&road.height=0.5&road.gamma=20&road.c=0&road.phi=38&road.trafficLoad=20",
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
