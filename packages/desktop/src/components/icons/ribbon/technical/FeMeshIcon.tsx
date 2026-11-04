import { RibbonIcon, type RibbonIconProps } from "../RibbonIcon";

/** FE mesh (technical). */
export function FeMeshIcon(props: RibbonIconProps) {
  return (
    <RibbonIcon {...props} style="technical">
      <path d="M3 3h18v18H3z" />
      <path d="M3 3l18 18M12 3 3 12M21 12 12 21" />
    </RibbonIcon>
  );
}
