import { RibbonIcon, type RibbonIconProps } from "../RibbonIcon";

/** Search limits (technical). */
export function SearchLimitsIcon(props: RibbonIconProps) {
  return (
    <RibbonIcon {...props} style="technical">
      <path d="M2 20h4l11-12h5" />
      <path d="M17 3v4M22 3v4M17 5h5" />
      <path d="M2 15v4M6 15v4M2 17h4" />
    </RibbonIcon>
  );
}
