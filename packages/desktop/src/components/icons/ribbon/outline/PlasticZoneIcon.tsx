import { RibbonIcon, type RibbonIconProps } from "../RibbonIcon";

/** Plastic zone (outline). */
export function PlasticZoneIcon(props: RibbonIconProps) {
  return (
    <RibbonIcon {...props} style="outline">
      <path d="M2 20h4l11-12h5" />
      <path d="M4 20A12 12 0 0 0 19 8" />
      <path d="M4 20A12 12 0 0 0 19 8h-2.5A9.5 9.5 0 0 1 7.97 17.85L6 20z" fill="currentColor" fillOpacity={0.25} stroke="none" />
    </RibbonIcon>
  );
}
