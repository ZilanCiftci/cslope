import { RibbonIcon, type RibbonIconProps } from "../RibbonIcon";

/** Drawing: a sheet with a section line on it, placed under the model (outline). */
export function DrawingIcon(props: RibbonIconProps) {
  return (
    <RibbonIcon {...props} style="outline">
      <path d="M5 3h10l4 4v14H5z" />
      <path d="M15 3v4h4" />
      <path d="M7.5 17.5h3l2.5-4h1.5l2-2" />
    </RibbonIcon>
  );
}
