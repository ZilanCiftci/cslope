/**
 * The captured screenshots used on the site (see media-scenes.ts for how
 * they are made), each in the light and the dark theme of the app. Sizes
 * and WebP variants come from generated/media-sizes.json, so that the page
 * keeps its layout while the images load and loads a file of about the
 * size it shows.
 */
import sizes from "./generated/media-sizes.json";
import { darkFile, webpSrcSet, type MediaEntry } from "./media-variants";

/** One capture: the PNG at full size and its WebP variants. */
export interface MediaImage {
  src: string;
  width: number;
  height: number;
  /** `srcset` of the WebP variants. */
  srcSet: string;
}

export interface Media extends MediaImage {
  alt: string;
  /** The capture in the app's dark theme, shown in the site's dark theme. */
  dark?: MediaImage;
}

const SIZES = sizes as unknown as Record<string, MediaEntry>;

function image(src: string): MediaImage | undefined {
  const entry = SIZES[src];
  if (!entry) return undefined;
  return { src, width: entry.size[0], height: entry.size[1], srcSet: webpSrcSet(src, entry) };
}

/** An image under public/media with its size, e.g. media("/media/tutorials/dam/03-result.png", "…"). */
export function media(src: string, alt: string): Media {
  const light = image(src);
  if (!light) throw new Error(`${src} is not in media-sizes.json (run bun scripts/media-sizes.ts)`);
  const dark = image(darkFile(src));
  return { ...light, alt, ...(dark ? { dark } : {}) };
}

const generated = (file: string, alt: string): Media => media(`/media/generated/${file}`, alt);

/**
 * The result plot of each verification example on the home page, exported
 * from the app (scenes home-<id> in media-scenes.ts), by problem id.
 */
export function homeExampleImage(id: string, title: string): Media {
  return media(`/media/home/${id}.png`, `cSlope's critical slip surface for ${title}, with its slices and factor of safety`);
}

export const MEDIA = {
  app: generated("result-app.png", "The cSlope window: the critical slip surface of a homogeneous slope with its center, slices and factor of safety, the models, the ribbon and the summary of the analysis"),
  criticalSurface: generated("result-critical-surface.png", "Result view: the critical slip surface of a homogeneous slope with its slices, factor of safety and material table"),
  allSurfaces: generated("result-all-surfaces.png", "Result view: every analyzed slip surface colored by its factor of safety, with a color bar"),
  annotations: generated(
    "result-annotations.png",
    "Result view of a slope with a water table: the title, the published and calculated factors of safety, a material table and the critical surface with its slices",
  ),
  showcaseResult: generated("result-showcase.png", "Result view: the optimized non-circular slip surface of Arai and Tagyo's slope, running along its weak layer"),
  materials: generated("edit-materials.png", "Edit view: a non-homogeneous slope with colored material regions"),
  showcase: generated("edit-showcase.png", "Edit view: Arai and Tagyo's slope with a weak layer between a stronger upper layer and a strong base"),
  geometry: generated("edit-geometry.png", "Edit view: slope geometry with its boundary points and the rulers"),
  waterTable: generated("edit-water-table.png", "Edit view: a slope with its piezometric line"),
  soilNails: media("/media/tutorials/soil-nails/02-model.png", "Edit view: a slope with three rows of soil nails"),
  sensitivity: media("/media/tutorials/probabilistic/01-sensitivity.png", "Sensitivity analysis: the factor of safety plotted against the unit weight"),
} satisfies Record<string, Media>;
