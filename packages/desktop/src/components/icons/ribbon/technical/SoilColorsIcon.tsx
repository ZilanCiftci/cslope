import { RibbonIcon, type RibbonIconProps } from "../RibbonIcon";

/** Soil colors (technical). */
export function SoilColorsIcon(props: RibbonIconProps) {
  return (
    <RibbonIcon {...props} style="technical">
      <path d="M3 5h18v14H3z" />
      <path d="M3 9.7h18M3 14.3h18" />
      <path d="M6 19l3-4.7M11 19l3-4.7M16 19l3-4.7" />
    </RibbonIcon>
  );
}
