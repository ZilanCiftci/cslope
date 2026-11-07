/**
 * The layers' colors: the swatches the form offers, each with its name. The
 * first six are the app's material colors (MATERIAL_COLORS in the desktop
 * app's store/defaults.ts, copied; a test checks they are the same), which
 * the app gives a material without a color by its position; the others are
 * earth tones of the same lightness. A chosen color is data: it goes into
 * the analysis document's material `color` when it is not the one the app
 * would give the material anyway.
 */

/** The app's material colors, by material index (the app repeats them). */
export const APP_MATERIAL_COLORS = ["#d4a373", "#a8c686", "#b5838d", "#6d6875", "#e5989b", "#ffb4a2"] as const;

/** The swatches of the form, in its order, with their names (the swatches' accessible names). */
export const LAYER_COLORS: readonly { color: string; name: string }[] = [
  { color: "#d4a373", name: "Tan" },
  { color: "#a8c686", name: "Sage" },
  { color: "#b5838d", name: "Mauve" },
  { color: "#6d6875", name: "Slate" },
  { color: "#e5989b", name: "Rose" },
  { color: "#ffb4a2", name: "Salmon" },
  { color: "#8d6e4f", name: "Brown" },
  { color: "#c2b280", name: "Sand" },
  { color: "#7f9172", name: "Olive" },
  { color: "#9fb7c9", name: "Grey blue" },
  { color: "#e0c068", name: "Ochre" },
  { color: "#a0522d", name: "Sienna" },
  { color: "#b0a99f", name: "Stone" },
  { color: "#5f7f7a", name: "Teal grey" },
];

/** The color of the layer at `index` that has none of its own: the swatches in turn. */
export const defaultLayerColor = (index: number) => LAYER_COLORS[index % LAYER_COLORS.length].color;

/** The color the app gives the material at `index` that has none. */
export const appMaterialColor = (index: number) => APP_MATERIAL_COLORS[index % APP_MATERIAL_COLORS.length];

/** A swatch's color as written in an address or a document ("#a0522d"), or null when it is not one of the swatches. */
export function layerColorOf(text: string | null | undefined): string | null {
  const t = (text ?? "").trim().toLowerCase().replace(/^#?/, "#");
  return LAYER_COLORS.some((c) => c.color === t) ? t : null;
}

/** A swatch's name: "Tan"; the color itself when it is not one of the swatches. */
export const layerColorName = (color: string) => LAYER_COLORS.find((c) => c.color === color)?.name ?? color;

/**
 * A layer's color is data, drawn in its hue in both themes, but see-through
 * over the card (more so in the dark theme), so that the layers' names and
 * the lines in the theme's ink stay readable on every swatch (a test checks
 * the contrast). Section.tsx draws with these.
 */
export const LAYER_FILL_OPACITY = { light: 0.6, dark: 0.4 } as const;
