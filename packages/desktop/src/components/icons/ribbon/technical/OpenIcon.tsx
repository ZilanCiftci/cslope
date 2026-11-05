import { RibbonIcon, type RibbonIconProps } from "../RibbonIcon";

/** Open (technical). */
export function OpenIcon(props: RibbonIconProps) {
  return (
    <RibbonIcon {...props} style="technical">
      <path d="M2 20V5h7l2 2h11v4" />
      <path d="M5 11h17l-2 9H2" />
    </RibbonIcon>
  );
}
