import { RibbonIcon, type RibbonIconProps } from "../RibbonIcon";

/** Plot (outline). */
export function PlotIcon(props: RibbonIconProps) {
  return (
    <RibbonIcon {...props} style="outline">
      <path d="M3 3v18h18" />
      <path d="M6 16l4-5 4 2 5-8" />
    </RibbonIcon>
  );
}
