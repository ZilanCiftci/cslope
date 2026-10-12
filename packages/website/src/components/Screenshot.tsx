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
  className,
}: {
  src: string;
  alt: string;
  width: number;
  height: number;
  caption?: string;
  /** Load at once (above the fold) instead of lazily. */
  priority?: boolean;
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
        className="block h-auto w-full"
      />
      {caption && <figcaption className="border-t px-4 py-3 text-sm text-muted-foreground">{caption}</figcaption>}
    </figure>
  );
}
