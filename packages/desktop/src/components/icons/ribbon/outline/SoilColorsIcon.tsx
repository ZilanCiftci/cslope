import { RibbonIcon, type RibbonIconProps } from "../RibbonIcon";

/** Soil colors (outline). */
export function SoilColorsIcon(props: RibbonIconProps) {
  return (
    <RibbonIcon {...props} style="outline">
      <path d="M5 5h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z" />
      <path d="M3 9.7h18M3 14.3h18" />
      <path d="M7 14.3l3-4.6M12 14.3l3-4.6M17 14.3l3-4.6" />
    </RibbonIcon>
  );
}
