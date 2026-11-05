import { RibbonIcon, type RibbonIconProps } from "../RibbonIcon";

/** Color bar (technical). */
export function ColorBarIcon(props: RibbonIconProps) {
  return (
    <RibbonIcon {...props} style="technical">
      <path d="M8 3h6v18H8z" />
      <path d="M8 9h6M8 15h6" />
      <path d="M14 3h3M14 9h3M14 15h3M14 21h3" />
    </RibbonIcon>
  );
}
