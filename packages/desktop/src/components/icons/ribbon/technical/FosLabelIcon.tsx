import { RibbonIcon, type RibbonIconProps } from "../RibbonIcon";

/** FOS label (technical). */
export function FosLabelIcon(props: RibbonIconProps) {
  return (
    <RibbonIcon {...props} style="technical">
      <path d="M3 5h15v10H3z" />
      <path d="M8 13V7h4M8 10h3" />
      <path d="M18 15l3 4" />
      <circle cx="21" cy="19" r="1.2" fill="currentColor" stroke="none" />
    </RibbonIcon>
  );
}
