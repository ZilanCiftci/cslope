import { RibbonIcon, type RibbonIconProps } from "../RibbonIcon";

/** Benchmarks (outline). */
export function BenchmarksIcon(props: RibbonIconProps) {
  return (
    <RibbonIcon {...props} style="outline">
      <path d="M2 20h4l11-12h5" />
      <path d="M3 8l3 3 6-7" />
    </RibbonIcon>
  );
}
