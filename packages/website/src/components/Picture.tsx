import type { CSSProperties } from "react";

import { useThemeOrDefault } from "@/components/theme-provider";
import type { Media } from "@/content/media";

/**
 * The media query of the dark capture's <source>: the operating system's
 * theme while the site follows it, otherwise always or never. The server
 * renders the first, so a visitor on the default theme loads one image
 * only; a chosen theme switches the source once the page has started.
 */
function darkQuery(theme: "dark" | "light" | "system"): string {
  return theme === "system" ? "(prefers-color-scheme: dark)" : theme === "dark" ? "all" : "not all";
}

/**
 * A capture of the app (public/media/...): WebP at the width the page
 * shows it (`sizes`), the dark-theme capture in the site's dark theme,
 * the PNG as the fallback. Width and height are the image's own, so the
 * page does not jump while it loads.
 */
export function Picture({
  media,
  alt,
  sizes,
  priority = false,
  className,
  style,
}: {
  media: Media;
  /** Instead of the media's own alt text. */
  alt?: string;
  /** The `sizes` of the variants: the width the image is shown at. */
  sizes: string;
  /** Load at once (above the fold, the page's largest image) instead of lazily. */
  priority?: boolean;
  className?: string;
  style?: CSSProperties;
}) {
  const { theme } = useThemeOrDefault();
  const { dark } = media;
  return (
    <picture>
      {dark && (
        <source media={darkQuery(theme)} type="image/webp" srcSet={dark.srcSet} sizes={sizes} width={dark.width} height={dark.height} />
      )}
      {media.srcSet && <source type="image/webp" srcSet={media.srcSet} sizes={sizes} width={media.width} height={media.height} />}
      <img
        src={media.src}
        alt={alt ?? media.alt}
        width={media.width}
        height={media.height}
        loading={priority ? "eager" : "lazy"}
        fetchPriority={priority ? "high" : undefined}
        decoding="async"
        className={className}
        style={style}
      />
    </picture>
  );
}
