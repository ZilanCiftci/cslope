import { RibbonIcon, type RibbonIconProps } from "../RibbonIcon";

/** PDF (technical). */
export function PdfIcon(props: RibbonIconProps) {
  return (
    <RibbonIcon {...props} style="technical">
      <path d="M5 2h9l5 5v15H5z" />
      <path d="M14 2v5h5" />
      <path d="M8 11h3M8 14.5h8M8 18h8" />
    </RibbonIcon>
  );
}
