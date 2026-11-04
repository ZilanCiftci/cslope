import { RibbonIcon, type RibbonIconProps } from "../RibbonIcon";

/** FE mesh (outline). */
export function FeMeshIcon(props: RibbonIconProps) {
  return (
    <RibbonIcon {...props} style="outline">
      <path d="M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" />
      <path d="M3 3l8 10M21 3l-10 10M3 21l8-8M21 21l-10-8" />
    </RibbonIcon>
  );
}
