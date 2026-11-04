import { RibbonIcon, type RibbonIconProps } from "../RibbonIcon";

/** Undo (technical). */
export function UndoIcon(props: RibbonIconProps) {
  return (
    <RibbonIcon {...props} style="technical">
      <path d="M8 5 4 9l4 4" />
      <path d="M4 9h10a5 5 0 0 1 0 10h-3" />
    </RibbonIcon>
  );
}
