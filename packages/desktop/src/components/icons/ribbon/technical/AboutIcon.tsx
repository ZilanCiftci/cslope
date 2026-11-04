import { RibbonIcon, type RibbonIconProps } from "../RibbonIcon";

/** About (technical). */
export function AboutIcon(props: RibbonIconProps) {
  return (
    <RibbonIcon {...props} style="technical">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v6M12 7.5v1" />
    </RibbonIcon>
  );
}
