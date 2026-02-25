import { BoundariesSection } from "./sections/BoundariesSection";
import { GeometrySection } from "./sections/GeometrySection";
import { LoadsSection } from "./sections/LoadsSection";
import { MaterialAssignmentSection } from "./sections/MaterialAssignmentSection";
import { MaterialsSection } from "./sections/MaterialsSection";
import { OptionsSection } from "./sections/OptionsSection";
import { PiezometricLineSection } from "./sections/PiezometricLineSection";
import { SearchLimitsSection } from "./sections/SearchLimitsSection";

export function PropertiesPanel() {
  return (
    <div
      className="h-full overflow-y-auto"
      style={{
        background: "var(--color-vsc-sidebar)",
      }}
    >
      <GeometrySection />
      <BoundariesSection />
      <MaterialsSection />
      <MaterialAssignmentSection />
      <PiezometricLineSection />
      <LoadsSection />
      <SearchLimitsSection />
      <OptionsSection />
    </div>
  );
}
