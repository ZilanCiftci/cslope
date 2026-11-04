import { RibbonIcon, type RibbonIconProps } from "../RibbonIcon";

/** Import template (technical). */
export function ImportTemplateIcon(props: RibbonIconProps) {
  return (
    <RibbonIcon {...props} style="technical">
      <path d="M5 2h9l5 5v15H5z" />
      <path d="M14 2v5h5" />
      <path d="M12 11v7M9 15l3 3 3-3" />
    </RibbonIcon>
  );
}
