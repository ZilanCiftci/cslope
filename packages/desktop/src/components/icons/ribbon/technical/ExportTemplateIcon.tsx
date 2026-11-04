import { RibbonIcon, type RibbonIconProps } from "../RibbonIcon";

/** Export template (technical). */
export function ExportTemplateIcon(props: RibbonIconProps) {
  return (
    <RibbonIcon {...props} style="technical">
      <path d="M5 2h9l5 5v15H5z" />
      <path d="M14 2v5h5" />
      <path d="M12 18v-7M9 14l3-3 3 3" />
    </RibbonIcon>
  );
}
