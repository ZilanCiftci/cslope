import { RibbonIcon, type RibbonIconProps } from "../RibbonIcon";

/** Line loads (outline). */
export function LineLoadIcon(props: RibbonIconProps) {
  return (
    <RibbonIcon {...props} style="outline">
      <path d="M12 4v11" />
      <path d="M9 12l3 3 3-3" />
      <path d="M2 19h20" />
    </RibbonIcon>
  );
}
