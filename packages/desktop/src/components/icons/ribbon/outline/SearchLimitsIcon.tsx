import { RibbonIcon, type RibbonIconProps } from "../RibbonIcon";

/** Search limits (outline). */
export function SearchLimitsIcon(props: RibbonIconProps) {
  return (
    <RibbonIcon {...props} style="outline">
      <path d="M2 20h4l11-12h5" />
      <path d="M16.5 2.5v4.5l3.5-2.25z" fill="currentColor" stroke="none" />
      <path d="M22 2.5v4.5l-3.5-2.25z" fill="currentColor" stroke="none" />
      <path d="M2 14.5v4.5l2.5-2.25z" fill="currentColor" stroke="none" />
      <path d="M6.5 14.5v4.5L4 16.75z" fill="currentColor" stroke="none" />
    </RibbonIcon>
  );
}
