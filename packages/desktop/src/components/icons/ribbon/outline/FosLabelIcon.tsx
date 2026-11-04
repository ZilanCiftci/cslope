import { RibbonIcon, type RibbonIconProps } from "../RibbonIcon";

/** FOS label (outline). */
export function FosLabelIcon(props: RibbonIconProps) {
  return (
    <RibbonIcon {...props} style="outline">
      <path d="M3 5h13.5a1.5 1.5 0 0 1 1.5 1.5v7a1.5 1.5 0 0 1-1.5 1.5H3z" />
      <path d="M8 13V7h4M8 10h3" />
      <path d="M18 15l3 4" />
    </RibbonIcon>
  );
}
