import { useThemeOrDefault } from "@/components/theme-provider";
import type { Media } from "@/content/media";

/** The full-size capture in the theme in effect: what a click on a figure opens. */
export function useFullSizeHref(media: Media): string {
  const { resolved } = useThemeOrDefault();
  return resolved === "dark" && media.dark ? media.dark.src : media.src;
}
