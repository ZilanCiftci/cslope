import { RibbonIcon, type RibbonIconProps } from "../RibbonIcon";

/** Color bar (outline). */
export function ColorBarIcon(props: RibbonIconProps) {
  return (
    <RibbonIcon {...props} style="outline">
      <path d="M8 3h6v18H8z" />
      <path d="M8 9h6M8 15h6" />
      <path d="M16 3h3M16 9h3M16 15h3M16 21h3" />
    </RibbonIcon>
  );
}
