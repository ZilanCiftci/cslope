import { RibbonIcon, type RibbonIconProps } from "../RibbonIcon";

/** Benchmarks (technical). */
export function BenchmarksIcon(props: RibbonIconProps) {
  return (
    <RibbonIcon {...props} style="technical">
      <path d="M2 20h4l11-12h5" />
      <path d="M14 4.5h8M14 3v3M18 3v3M22 3v3" />
    </RibbonIcon>
  );
}
