import { RibbonIcon, type RibbonIconProps } from "../RibbonIcon";

/** Exterior (outline). */
export function ExteriorIcon(props: RibbonIconProps) {
  return (
    <RibbonIcon {...props} style="outline">
      <path d="M3 19h18V5h-8L3 14z" />
      <circle cx="3" cy="14" r="1.6" fill="currentColor" stroke="none" />
      <circle cx="13" cy="5" r="1.6" fill="currentColor" stroke="none" />
    </RibbonIcon>
  );
}
