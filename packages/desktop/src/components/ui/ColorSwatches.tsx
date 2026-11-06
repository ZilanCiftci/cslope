/**
 * A row of color swatches with a first button for the drawing's own color
 * (the theme's): the color picker of the properties sidebar (reference
 * lines, display layers). The swatches shrink (up to 20 px) to fit the
 * sidebar's width. A chosen color is data: drawn as chosen in both themes.
 */

/** The swatches offered: dark and light grey, the common line colors, white. */
const SWATCH_COLORS = ["#a21caf", "#e879f9", "#cc0000", "#cc6600", "#00cc00", "#0066cc", "#000000", "#666666", "#ffffff"];

export function ColorSwatches({
  value,
  onChange,
  defaultLabel = "Default",
  defaultTitle = "The drawing's own color (the theme's ink)",
  colors = SWATCH_COLORS,
}: {
  /** The chosen color; "" or undefined: the default. Mixed values: null. */
  value: string | undefined | null;
  onChange: (color: string | undefined) => void;
  defaultLabel?: string;
  defaultTitle?: string;
  colors?: readonly string[];
}) {
  const isDefault = value === undefined || value === "";
  return (
    <div className="flex gap-1 items-center">
      <button
        type="button"
        onClick={() => onChange(undefined)}
        className="h-5 px-1.5 shrink-0 rounded-sm cursor-pointer text-[10px]"
        aria-pressed={isDefault}
        title={defaultTitle}
        style={{
          border: isDefault ? "2px solid var(--color-vsc-accent)" : "1px solid var(--color-vsc-border)",
          color: "var(--color-vsc-text)",
          background: "transparent",
        }}
      >
        {defaultLabel}
      </button>
      {colors.map((c) => (
        <button
          type="button"
          key={c}
          onClick={() => onChange(c)}
          className="flex-1 min-w-0 max-w-5 aspect-square rounded-sm cursor-pointer"
          aria-label={`Color ${c}`}
          aria-pressed={value === c}
          style={{
            background: c,
            border: value === c ? "2px solid var(--color-vsc-accent)" : "1px solid var(--color-vsc-border)",
          }}
        />
      ))}
    </div>
  );
}
