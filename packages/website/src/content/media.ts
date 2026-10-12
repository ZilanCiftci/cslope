/**
 * The captured screenshots used on the site (see media-scenes.ts for how
 * they are made), with each image's own size in pixels so that the page
 * keeps its layout while they load. media.test.ts checks the sizes against
 * the files.
 */
export interface Media {
  src: string;
  alt: string;
  width: number;
  height: number;
}

/** Edit views are captured with the whole canvas, result views with the paper only. */
const EDIT = { width: 1142, height: 739 };
const RESULT = { width: 862, height: 739 };

const generated = (file: string, size: { width: number; height: number }, alt: string): Media => ({
  src: `/media/generated/${file}`,
  alt,
  ...size,
});

export const MEDIA = {
  criticalSurface: generated(
    "result-critical-surface.png",
    RESULT,
    "Result view: the critical slip surface of a homogeneous slope with its slices, factor of safety and material table",
  ),
  allSurfaces: generated(
    "result-all-surfaces.png",
    RESULT,
    "Result view: every analysed slip surface coloured by its factor of safety",
  ),
  annotations: generated(
    "result-annotations.png",
    RESULT,
    "Result view of a layered slope with a material table and text annotations",
  ),
  damResult: generated("result-dam.png", RESULT, "Critical slip surface through the zones of an embankment dam"),
  materials: generated("edit-materials.png", EDIT, "Edit view: a non-homogeneous slope with coloured material regions"),
  dam: generated("edit-dam.png", EDIT, "Edit view: an embankment dam cross-section with core, filter and rockfill zones"),
  geometry: generated("edit-geometry.png", EDIT, "Edit view: slope geometry with its boundary points"),
} satisfies Record<string, Media>;
