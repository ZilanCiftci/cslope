import { RibbonIcon, type RibbonIconProps } from "../RibbonIcon";

/** Slices (technical). */
export function SlicesIcon(props: RibbonIconProps) {
  return (
    <RibbonIcon {...props} style="technical">
      <path d="M2 20h4l11-12h5" />
      <path d="M4 20A12 12 0 0 0 19 8" />
      <path d="M9 16.7v3.5M12 13.5v5.8M15 10.2v7.4" />
    </RibbonIcon>
  );
}
