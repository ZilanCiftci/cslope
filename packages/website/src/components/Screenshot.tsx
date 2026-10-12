import { cn } from "@/lib/utils";

/**
 * A screenshot from the app (public/media/...), framed. Width and height
 * are the image's own, so the page does not jump while it loads.
 */
export function Screenshot({
  src,
  alt,
  width,
  height,
  caption,
  priority = false,
  aspect,
  className,
}: {
  src: string;
  alt: string;
  width: number;
  height: number;
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
  return (
    <figure className={cn("overflow-hidden rounded-lg border bg-card shadow-sm", className)}>
      <img
        src={src}
        alt={alt}
        width={width}
        height={height}
        loading={priority ? "eager" : "lazy"}
        decoding="async"
        className={aspect ? "block w-full bg-white object-contain" : "block h-auto w-full"}
        style={aspect ? { aspectRatio: aspect } : undefined}
      />
      {caption && <figcaption className="border-t px-4 py-3 text-sm text-muted-foreground">{caption}</figcaption>}
    </figure>
  );
}
