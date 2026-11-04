import { RibbonIcon, type RibbonIconProps } from "../RibbonIcon";

/** Plastic zone (technical). */
export function PlasticZoneIcon(props: RibbonIconProps) {
  return (
    <RibbonIcon {...props} style="technical">
      <path d="M2 20h4l11-12h5" />
      <path d="M4 20A12 12 0 0 0 19 8" />
      <path d="M7.97 17.85A9.5 9.5 0 0 0 16.5 8" />
      <path d="M15.23 13.15l2.16 1.25M13.11 15.68l1.6 1.91M10.25 17.33l.85 2.35" />
    </RibbonIcon>
  );
}
