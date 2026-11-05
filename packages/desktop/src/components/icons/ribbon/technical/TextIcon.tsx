import { RibbonIcon, type RibbonIconProps } from "../RibbonIcon";

/** Text (technical). */
export function TextIcon(props: RibbonIconProps) {
  return (
    <RibbonIcon {...props} style="technical">
      <path d="M5 4h14M5 4v3M19 4v3" />
      <path d="M12 4v16M9 20h6" />
    </RibbonIcon>
  );
}
