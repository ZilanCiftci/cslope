import { RibbonIcon, type RibbonIconProps } from "../RibbonIcon";

/** Line loads (technical). */
export function LineLoadIcon(props: RibbonIconProps) {
  return (
    <RibbonIcon {...props} style="technical">
      <path d="M12 4v11" />
      <path d="M9 12l3 3 3-3" />
      <path d="M2 19h20" />
      <path d="M4 22l3-3M9 22l3-3M14 22l3-3M19 22l3-3" />
    </RibbonIcon>
  );
}
