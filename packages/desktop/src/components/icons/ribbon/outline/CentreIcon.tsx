import { RibbonIcon, type RibbonIconProps } from "../RibbonIcon";

/** Centre (outline). */
export function CentreIcon(props: RibbonIconProps) {
  return (
    <RibbonIcon {...props} style="outline">
      <path d="M8 3v10M3 8h10" />
      <circle cx="8" cy="8" r="2.5" />
      <path d="M20 8A12 12 0 0 1 8 20" />
    </RibbonIcon>
  );
}
