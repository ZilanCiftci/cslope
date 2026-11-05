import { RibbonIcon, type RibbonIconProps } from "../RibbonIcon";

/** Materials (technical). */
export function MaterialsIcon(props: RibbonIconProps) {
  return (
    <RibbonIcon {...props} style="technical">
      <path d="M3 19h18V5h-8L3 14z" />
      <path d="M7.5 10H21M3 15h18" />
      <path d="M6 19l3-4M11 19l3-4M16 19l3-4" />
    </RibbonIcon>
  );
}
