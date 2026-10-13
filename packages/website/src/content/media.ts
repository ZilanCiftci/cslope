/**
 * The captured screenshots used on the site (see media-scenes.ts for how
 * they are made). Sizes come from generated/media-sizes.json, so that the
 * page keeps its layout while the images load.
 */
import sizes from "./generated/media-sizes.json";

export interface Media {
  src: string;
  alt: string;
  width: number;
  height: number;
}

const SIZES = sizes as unknown as Record<string, [number, number]>;

/** An image under public/media with its size, e.g. media("/media/tutorials/dam/03-result.png", "…"). */
export function media(src: string, alt: string): Media {
  const size = SIZES[src];
  if (!size) throw new Error(`${src} is not in media-sizes.json (run bun scripts/media-sizes.ts)`);
  return { src, alt, width: size[0], height: size[1] };
}

const generated = (file: string, alt: string): Media => media(`/media/generated/${file}`, alt);

export const MEDIA = {
  app: generated("result-app.png", "The cSlope window: the critical slip surface of a homogeneous slope with its centre, slices and factor of safety, the models, the ribbon and the summary of the analysis"),
  criticalSurface: generated("result-critical-surface.png", "Result view: the critical slip surface of a homogeneous slope with its slices, factor of safety and material table",
  ),
  allSurfaces: generated("result-all-surfaces.png", "Result view: every analysed slip surface coloured by its factor of safety",
  ),
  annotations: generated("result-annotations.png", "Result view of a layered slope with a material table and text annotations",
  ),
  showcaseResult: generated("result-showcase.png", "Result view: the optimised non-circular slip surface of Arai and Tagyo's slope, running along its weak layer"),
  materials: generated("edit-materials.png", "Edit view: a non-homogeneous slope with coloured material regions"),
  showcase: generated("edit-showcase.png", "Edit view: Arai and Tagyo's slope with a weak layer between a stronger upper layer and a strong base"),
  geometry: generated("edit-geometry.png", "Edit view: slope geometry with its boundary points"),
  waterTable: generated("edit-water-table.png", "Edit view: a slope with its piezometric line"),
  soilNails: media("/media/tutorials/soil-nails/02-model.png", "Edit view: a slope with three rows of soil nails"),
  sensitivity: media("/media/tutorials/probabilistic/01-sensitivity.png", "Sensitivity analysis: the factor of safety plotted against the unit weight"),
} satisfies Record<string, Media>;
