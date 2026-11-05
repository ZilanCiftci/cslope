import { RibbonIcon, type RibbonIconProps } from "../RibbonIcon";

/** Results Plot (outline). */
export function ResultsPlotIcon(props: RibbonIconProps) {
  return (
    <RibbonIcon {...props} style="outline">
      <path d="M2 20h4l11-12h5" />
      <path d="M4 20A12 12 0 0 0 19 8" />
      <path d="M3 10V3h5M3 6.5h4" />
    </RibbonIcon>
  );
}
