import { RibbonIcon, type RibbonIconProps } from "../RibbonIcon";

/** Frame: the sheet's plot frame with its ticks on the left and bottom edges (outline). */
export function FrameIcon(props: RibbonIconProps) {
  return (
    <RibbonIcon {...props} style="outline">
      <rect x="7" y="3" width="14" height="14" rx="1" />
      <path d="M7 7H4M7 12H4M11 17v3M16 17v3" />
    </RibbonIcon>
  );
}
