import { RibbonIcon, type RibbonIconProps } from "../RibbonIcon";

/** Piezometric lines (outline). */
export function PiezoIcon(props: RibbonIconProps) {
  return (
    <RibbonIcon {...props} style="outline">
      <path d="M8 5h8l-4 7z" />
      <path d="M2 13h20" />
      <path d="M6 17h12" />
    </RibbonIcon>
  );
}
