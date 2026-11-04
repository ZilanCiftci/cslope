import { RibbonIcon, type RibbonIconProps } from "../RibbonIcon";

/** Custom planes (outline). */
export function CustomPlanesIcon(props: RibbonIconProps) {
  return (
    <RibbonIcon {...props} style="outline">
      <path d="M2 20h4l11-12h5" />
      <path d="M4 20A12 12 0 0 0 19 8" />
      <circle cx="7" cy="8.4" r="1.5" fill="currentColor" stroke="none" />
    </RibbonIcon>
  );
}
