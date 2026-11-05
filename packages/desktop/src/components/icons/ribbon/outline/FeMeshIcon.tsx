import { RibbonIcon, type RibbonIconProps } from "../RibbonIcon";

/** FE mesh (outline). */
export function FeMeshIcon(props: RibbonIconProps) {
  return (
    <RibbonIcon {...props} style="outline">
      <path d="M3 4h18v16H3z" />
      <path d="M3 12h18M12 4v16" />
      <path d="M3 20 21 4M3 12l9-8M12 20l9-8" />
    </RibbonIcon>
  );
}
