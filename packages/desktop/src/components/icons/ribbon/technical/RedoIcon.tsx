import { RibbonIcon, type RibbonIconProps } from "../RibbonIcon";

/** Redo (technical). */
export function RedoIcon(props: RibbonIconProps) {
  return (
    <RibbonIcon {...props} style="technical">
      <path d="M16 5l4 4-4 4" />
      <path d="M20 9H10a5 5 0 0 0 0 10h3" />
    </RibbonIcon>
  );
}
