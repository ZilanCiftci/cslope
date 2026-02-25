import { useState } from "react";
import type { MaterialPickerState } from "../types";

export function useMaterialPicker() {
  const [materialPicker, setMaterialPicker] =
    useState<MaterialPickerState | null>(null);

  return { materialPicker, setMaterialPicker };
}
