import { RibbonIcon, type RibbonIconProps } from "../RibbonIcon";

/** Surfaces (outline). */
export function SurfacesIcon(props: RibbonIconProps) {
  return (
    <RibbonIcon {...props} style="outline">
      <path d="M2 20h4l11-12h5" />
      <path d="M2.5 20A13 13 0 0 0 20.5 8" />
      <path d="M6 20A7.5 7.5 0 0 0 15.5 9.6" />
    </RibbonIcon>
  );
}
