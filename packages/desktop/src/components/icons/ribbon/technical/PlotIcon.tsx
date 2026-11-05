import { RibbonIcon, type RibbonIconProps } from "../RibbonIcon";

/** Plot (technical). */
export function PlotIcon(props: RibbonIconProps) {
  return (
    <RibbonIcon {...props} style="technical">
      <path d="M3 3v18h18" />
      <path d="M2 9h1M2 15h1M9 21v1M15 21v1" />
      <path d="M6 16l4-5 4 2 5-8" />
    </RibbonIcon>
  );
}
