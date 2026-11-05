import { RibbonIcon, type RibbonIconProps } from "../RibbonIcon";

/** Grid (technical). */
export function GridIcon(props: RibbonIconProps) {
  return (
    <RibbonIcon {...props} style="technical">
      <path d="M3 3h18v18H3z" />
      <path d="M9 3v18M15 3v18M3 9h18M3 15h18" />
    </RibbonIcon>
  );
}
