import { RibbonIcon, type RibbonIconProps } from "../RibbonIcon";

/** Materials (outline). */
export function MaterialsIcon(props: RibbonIconProps) {
  return (
    <RibbonIcon {...props} style="outline">
      <path d="M3 19h18V5h-8L3 14z" />
      <path d="M7.5 10H21M3 15h18" />
    </RibbonIcon>
  );
}
