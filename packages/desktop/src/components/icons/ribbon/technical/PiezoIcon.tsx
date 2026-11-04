import { RibbonIcon, type RibbonIconProps } from "../RibbonIcon";

/** Piezometric lines (technical). */
export function PiezoIcon(props: RibbonIconProps) {
  return (
    <RibbonIcon {...props} style="technical">
      <path d="M8 5h8l-4 7z" />
      <path d="M2 13h20" />
      <path d="M6 17h12" />
      <path d="M9 21h6" />
    </RibbonIcon>
  );
}
