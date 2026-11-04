import { RibbonIcon, type RibbonIconProps } from "../RibbonIcon";

/** Exit (technical). */
export function ExitIcon(props: RibbonIconProps) {
  return (
    <RibbonIcon {...props} style="technical">
      <path d="M10 2H3v20h7" />
      <path d="M12 12h10M18 8l4 4-4 4" />
    </RibbonIcon>
  );
}
