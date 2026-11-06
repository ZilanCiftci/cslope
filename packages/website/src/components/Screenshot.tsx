import { Picture } from "@/components/Picture";
import { useFullSizeHref } from "@/lib/full-size";
import type { Media } from "@/content/media";
import { cn } from "@/lib/utils";

/**
 * A screenshot from the app (public/media/...), framed, in the theme of
 * the site. A click opens it at full size.
 */
export function Screenshot({
  media,
  sizes,
  caption,
  priority = false,
  aspect,
  className,
}: {
  media: Media;
  /** The width the image is shown at, for the choice of its variant. */
  sizes: string;
  caption?: string;
  /** Load at once (above the fold) instead of lazily. */
  priority?: boolean;
  /**
   * Show the image in a frame of this aspect ratio (CSS, e.g. "3 / 2"),
   * scaled to fit, so that screenshots of different shapes line up.
   */
  aspect?: string;
  className?: string;
}) {
  const href = useFullSizeHref(media);
  return (
    <figure className={cn("overflow-hidden rounded-lg border bg-card shadow-sm", className)}>
      <a href={href} target="_blank" rel="noopener" className="block cursor-zoom-in" title="Open at full size">
        <Picture
          media={media}
          sizes={sizes}
          priority={priority}
          className={aspect ? "block w-full bg-card object-contain" : "block h-auto w-full"}
          style={aspect ? { aspectRatio: aspect } : undefined}
        />
      </a>
      {caption && <figcaption className="border-t px-4 py-3 text-sm text-muted-foreground">{caption}</figcaption>}
    </figure>
  );
}
