import { RibbonIcon, type RibbonIconProps } from "../RibbonIcon";

/** New (technical). */
export function NewIcon(props: RibbonIconProps) {
  return (
    <RibbonIcon {...props} style="technical">
      <path d="M5 2h9l5 5v15H5z" />
      <path d="M14 2v5h5" />
      <path d="M12 11v6M9 14h6" />
    </RibbonIcon>
  );
}
