import { Link } from "react-router";
import { ArrowRight } from "lucide-react";

import { PageHeader } from "@/components/PageHeader";
import { Section } from "@/components/Section";
import { Screenshot } from "@/components/Screenshot";
import { Button } from "@/components/ui/button";
import { MEDIA, type Media } from "@/content/media";
import { usePageMeta } from "@/lib/page-meta";

interface Area {
  id: string;
  title: string;
  lead: string;
  points: string[];
  media?: Media;
  caption?: string;
  /** The documentation page for this area. */
  docs?: string;
}

const AREAS: Area[] = [
  {
    id: "methods",
    title: "Limit equilibrium methods",
    lead: "Three methods on the same model and the same slip surfaces, so results can be compared directly.",
    points: [
      "Bishop simplified (moment equilibrium).",
      "Janbu simplified, with or without the f₀ correction factor.",
      "Morgenstern–Price (full equilibrium) with constant (Spencer), half-sine, clipped-sine, trapezoidal or user-defined interslice functions.",
      "Plots of the moment and force factors of safety against λ, and of slice data along any analysed surface.",
    ],
    media: MEDIA.criticalSurface,
    caption: "Critical circle with slices and its factor of safety",
    docs: "/docs/analysis",
  },
  {
    id: "search",
    title: "Slip surface search",
    lead: "Find the critical surface the way you would by hand, only faster and more thoroughly.",
    points: [
      "Circular search between entry and exit ranges, refined around the best surfaces.",
      "Custom circles and polylines, analysed alone or together with the search.",
      "Non-circular optimisation starting from the critical circles.",
      "Minimum slip depth and minimum sliding area to skip shallow surfaces; search limits; both slip directions.",
    ],
    media: MEDIA.allSurfaces,
    caption: "Every analysed surface, coloured by factor of safety",
    docs: "/docs/search",
  },
  {
    id: "geometry",
    title: "Geometry and materials",
    lead: "Draw the section on the canvas or import it from CAD, and assign materials region by region.",
    points: [
      "Exterior and interior boundaries with snapping, undo and redo; DXF import.",
      "Parameters and expressions for coordinates and properties.",
      "Mohr–Coulomb, undrained, strength increasing with depth (from the ground or from the top of the layer) or from a datum, with a strength cutoff.",
      "Anisotropic and spatially varying strength, lime-cement columns, high-strength and impenetrable (bedrock) layers, saturated unit weight below the water table.",
    ],
    media: MEDIA.materials,
    caption: "Material regions of a non-homogeneous slope",
    docs: "/docs/materials",
  },
  {
    id: "water",
    title: "Water and pore pressure",
    lead: "Pore pressures from piezometric lines, with the free water that goes with them.",
    points: [
      "A main piezometric line, and a separate line for any material.",
      "Ponded water above the ground surface, acting on the slope.",
      "Tension cracks with a fixed or automatic (Rankine) depth, dry or water-filled.",
      "Vertical head, or the phreatic correction for a free surface with parallel flow.",
    ],
    media: MEDIA.waterTable,
    caption: "A piezometric line through the slope",
    docs: "/docs/water",
  },
  {
    id: "reinforcement",
    title: "Loads, reinforcement and support",
    lead: "The structural elements of a real design, with their capacities along the slip surface.",
    points: [
      "Distributed and line loads.",
      "Anchors, grouted tiebacks, soil nails and geosynthetics, active or passive, with tensile and pullout capacity.",
      "Pile rows and sheet pile walls with a given force or the Ito & Matsui method, and a choice of force direction; lime-cement columns as a material.",
      "Partial factors on strength and loads: Swedish practice (EKS/IEG) or EN 1997‑1 DA3.",
    ],
    media: MEDIA.soilNails,
    caption: "Three rows of soil nails in a slope",
    docs: "/docs/reinforcement",
  },
  {
    id: "results",
    title: "Results and reporting",
    lead: "From the analysis to a drawing you can put in a report, in the same application.",
    points: [
      "Critical surface only, all surfaces, or surfaces below a factor of safety.",
      "Text, material tables, plots and a colour bar on a print sheet; reusable templates.",
      "Plots of slice data and of Fm and Ff against λ.",
      "Export to PDF and PNG; slice data to Excel and CSV; projects saved as plain JSON.",
    ],
    media: MEDIA.annotations,
    caption: "A result sheet with a material table and annotations",
    docs: "/docs/results",
  },
  {
    id: "probabilistic",
    title: "Sensitivity and probability",
    lead: "See how much the answer depends on the input, and how likely failure is.",
    points: [
      "Sensitivity sweeps of any parameter or material property.",
      "Taylor series and Monte Carlo methods with normal or lognormal variables.",
      "Reliability index and probability of failure.",
    ],
    media: MEDIA.sensitivity,
    caption: "Factor of safety against the unit weight",
    docs: "/docs/sensitivity",
  },
];

export function Features() {
  usePageMeta(
    "Features",
    "What cSlope does: limit equilibrium methods, slip surface search, materials, water, reinforcement, reporting and probabilistic analysis.",
  );
  return (
    <>
      <PageHeader
        eyebrow="Features"
        title="A complete slope stability tool"
        lead="cSlope covers the analyses a geotechnical engineer runs on a slope or an embankment, from a first check to the design report."
      >
        <nav aria-label="Feature areas" className="mt-8 flex flex-wrap gap-2">
          {AREAS.map((a) => (
            <a
              key={a.id}
              href={`#${a.id}`}
              className="rounded-full border bg-background px-3 py-1 text-sm text-muted-foreground hover:text-foreground"
            >
              {a.title}
            </a>
          ))}
        </nav>
      </PageHeader>

      {AREAS.map((a, i) => (
        <Section key={a.id} id={a.id} surface={i % 2 === 1}>
          <div className={a.media ? "grid items-center gap-10 lg:grid-cols-2" : "max-w-3xl"}>
            <div className={a.media && i % 2 === 1 ? "lg:order-2" : undefined}>
              <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">{a.title}</h2>
              <p className="mt-3 text-lg leading-relaxed text-muted-foreground">{a.lead}</p>
              <ul className="mt-6 space-y-3 text-sm leading-relaxed">
                {a.points.map((p) => (
                  <li key={p} className="flex gap-3">
                    <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" aria-hidden="true" />
                    <span>{p}</span>
                  </li>
                ))}
              </ul>
              {a.docs && (
                <Link
                  to={a.docs}
                  className="mt-6 inline-flex items-center text-sm font-medium text-primary hover:underline"
                >
                  Read more in the documentation
                  <ArrowRight className="ml-1 h-4 w-4" />
                </Link>
              )}
            </div>
            {a.media && <Screenshot {...a.media} caption={a.caption} />}
          </div>
        </Section>
      ))}

      <Section>
        <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-lg font-medium">Every one of these is covered by the verification problems.</p>
          <Button asChild variant="outline">
            <Link to="/verification">
              See the verification
              <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </Button>
        </div>
      </Section>
    </>
  );
}
