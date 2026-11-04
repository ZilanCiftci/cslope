import { RibbonIcon, type RibbonIconProps } from "../RibbonIcon";

/** Save (technical). */
export function SaveIcon(props: RibbonIconProps) {
  return (
    <RibbonIcon {...props} style="technical">
      <path d="M3 3h14l4 4v14H3z" />
      <path d="M7 3v5h8V3" />
      <path d="M7 21v-7h10v7" />
    </RibbonIcon>
  );
}
