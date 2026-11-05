import { RibbonIcon, type RibbonIconProps } from "../RibbonIcon";

/** Save As (technical). */
export function SaveAsIcon(props: RibbonIconProps) {
  return (
    <RibbonIcon {...props} style="technical">
      <path d="M3 7h12l4 4v10H3z" />
      <path d="M7 7v4h6V7" />
      <path d="M7 21v-5h8v5" />
      <path d="M7 7V3h10l4 4v3" />
    </RibbonIcon>
  );
}
