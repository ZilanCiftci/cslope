/**
 * Writing a model as a .gsz project file: the regions, materials,
 * piezometric lines, distributed loads, point loads, method and entry and
 * exit ranges, with the tag paths of the format's own files. What has no
 * counterpart in the format is listed in `notes`.
 *
 * Only what the format's published example files show is written; the
 * receiving program remains the authority on its own format, so the file is
 * a starting point to check there, not a guaranteed round trip.
 */

import { suctionAngle, type MaterialModel } from "@cslope/engine";
import { buildSlopeDTOFromModel } from "../../../store/helpers";
import type { ModelEntry } from "../../../store/types";
import { computeRegions } from "../../../utils/regions";
import { writeZip } from "../../../utils/zip";
import { mainPiezoLine } from "../../../utils/piezo";

type Pt = [number, number];

/** The analysis kind the format expects, ROT13 like the names guarded in forbidden-names.ts. */
const KIND = "FYBCR/J".replace(/[A-Z]/g, (c) => String.fromCharCode(((c.charCodeAt(0) - 65 + 13) % 26) + 65));

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const n = (v: number) => (Number.isFinite(v) ? String(Number(v.toPrecision(12))) : "0");

function rgb(hex: string | undefined): string {
  const m = hex?.match(/^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i);
  return m ? `RGB=(${parseInt(m[1], 16)},${parseInt(m[2], 16)},${parseInt(m[3], 16)})` : "RGB=(200,200,200)";
}

/** The format's strength model and fields for a cSlope material. */
function materialXml(name: string, model: MaterialModel, notes: string[]): { slopeModel: string; fields: [string, number][] } {
  const gamma = model.unitWeightSat ?? model.unitWeight;
  if (model.unitWeightSat !== undefined && model.unitWeightSat !== model.unitWeight) {
    notes.push(`"${name}": one unit weight is written (${gamma} kN/m³, the saturated one); the unit weight above the water line (${model.unitWeight}) is not.`);
  }
  switch (model.kind) {
    case "mohr-coulomb": {
      if (model.cohesionRateOfChange) notes.push(`"${name}": c′ increasing with depth is written as its reference value.`);
      if (model.cFactor) notes.push(`"${name}": the combined (undrained) limit is not written; drained c′ and φ′ only.`);
      const c = model.cFactor ? model.cohesion * model.cFactor : model.cohesion;
      return { slopeModel: "MohrCoulomb", fields: [["UnitWeight", gamma], ["CohesionPrime", c], ["PhiPrime", model.frictionAngle], ...phiBField(model)] };
    }
    case "undrained":
      if (model.suRateOfChange) notes.push(`"${name}": Su increasing with depth is written as its reference value.`);
      return { slopeModel: "UndrainedPhiZero", fields: [["UnitWeight", gamma], ["Cohesion", model.undrainedShearStrength], ["CohesionPrime", model.undrainedShearStrength]] };
    case "impenetrable":
      return { slopeModel: "Bedrock", fields: [["UnitWeight", gamma]] };
    case "s-f-depth":
    case "s-f-datum":
      notes.push(`"${name}": strength as a function of ${model.kind === "s-f-depth" ? "depth" : "datum"} is written as undrained with its reference Su (${model.suRef} kPa); enter the variation by hand.`);
      if (suctionAngle(model) > 0) notes.push(`"${name}": the strength from suction (φb = ${suctionAngle(model)}°) of the drained branch is not written.`);
      return { slopeModel: "UndrainedPhiZero", fields: [["UnitWeight", gamma], ["Cohesion", model.suRef], ["CohesionPrime", model.suRef]] };
    case "anisotropic-function":
      notes.push(`"${name}": the anisotropy is not written; Mohr-Coulomb with c and φ only.`);
      return { slopeModel: "MohrCoulomb", fields: [["UnitWeight", gamma], ["CohesionPrime", model.cohesion], ["PhiPrime", model.frictionAngle], ...phiBField(model)] };
    default:
      notes.push(`"${name}": the material model "${model.kind}" has no counterpart in the export; written as Mohr-Coulomb with no strength, to be entered by hand.`);
      return { slopeModel: "MohrCoulomb", fields: [["UnitWeight", gamma], ["CohesionPrime", 0], ["PhiPrime", 0]] };
  }
}

/** φb of a material with strength from suction, as the format's UnsatPhiB (none without). */
function phiBField(model: MaterialModel): [string, number][] {
  const phiB = suctionAngle(model);
  return phiB > 0 ? [["UnsatPhiB", phiB]] : [];
}

function groundAt(outline: Pt[], x: number): number {
  let best = -Infinity;
  for (let i = 0; i < outline.length; i++) {
    const [x1, y1] = outline[i], [x2, y2] = outline[(i + 1) % outline.length];
    if (x < Math.min(x1, x2) || x > Math.max(x1, x2) || x1 === x2) continue;
    best = Math.max(best, y1 + ((x - x1) * (y2 - y1)) / (x2 - x1));
  }
  return best;
}

/** The project XML of one model (metric units). */
export function modelToGszXml(model: ModelEntry): { xml: string; notes: string[] } {
  const notes: string[] = [];
  const def = buildSlopeDTOFromModel(model);
  const outline = model.coordinates;
  if (outline.length < 3 || model.materials.length === 0) throw new Error("The model has no outline or no materials to export.");

  // regions with shared corner points
  const regions = computeRegions(outline, model.materialBoundaries, model.regionMaterials, model.materials[0].id);
  if (regions.some((r) => r.holes && r.holes.length > 0)) notes.push("A region that surrounds another (a hole) is written without the hole; check it.");
  const points: Pt[] = [];
  const pid = (p: Pt) => {
    const tol = 1e-6;
    let i = points.findIndex((q) => Math.abs(q[0] - p[0]) < tol && Math.abs(q[1] - p[1]) < tol);
    if (i < 0) {
      points.push([p[0], p[1]]);
      i = points.length - 1;
    }
    return i + 1;
  };
  const rings = regions.map((r) => {
    const pts: Pt[] = r.px.map((x, i) => [x, r.py[i]] as Pt);
    if (pts.length > 1 && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1]) pts.pop();
    return { ids: pts.map(pid), materialId: r.materialId };
  });
  // corners of a neighbour that lie on an edge become corners of that edge as well
  for (const ring of rings) {
    const out: number[] = [];
    for (let i = 0; i < ring.ids.length; i++) {
      const a = points[ring.ids[i] - 1], b = points[ring.ids[(i + 1) % ring.ids.length] - 1];
      out.push(ring.ids[i]);
      const len2 = (b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2;
      const on = points
        .map((p, k) => ({ k: k + 1, t: ((p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1])) / (len2 || 1), p }))
        .filter(({ t, p }) => {
          if (t <= 1e-9 || t >= 1 - 1e-9) return false;
          const qx = a[0] + t * (b[0] - a[0]) - p[0], qy = a[1] + t * (b[1] - a[1]) - p[1];
          return qx * qx + qy * qy < 1e-10;
        })
        .sort((u, v) => u.t - v.t);
      out.push(...on.map((o) => o.k));
    }
    ring.ids = out;
  }
  const lines: [number, number][] = [];
  const lineKey = new Set<string>();
  for (const r of rings) for (let i = 0; i < r.ids.length; i++) {
    const a = r.ids[i], b = r.ids[(i + 1) % r.ids.length];
    const k = a < b ? `${a},${b}` : `${b},${a}`;
    if (!lineKey.has(k)) {
      lineKey.add(k);
      lines.push([a, b]);
    }
  }

  // materials: ids in model order
  const matIndex = new Map(model.materials.map((m, i) => [m.id, i + 1]));
  const materialsXml = model.materials.map((m, i) => {
    const { slopeModel, fields } = materialXml(m.name, m.model, notes);
    return `    <Material>
      <ID>${i + 1}</ID>
      <Name>${esc(m.name)}</Name>
      <Color>${rgb(m.color)}</Color>
      <SlopeModel>${slopeModel}</SlopeModel>
      <StressStrain>
${fields.map(([k, v]) => `        <${k}>${n(v)}</${k}>`).join("\n")}
      </StressStrain>
    </Material>`;
  });

  // the analysis's own point list: water lines, surcharges and point loads refer to it
  const local: Pt[] = [];
  const lid = (p: Pt) => {
    local.push(p);
    return local.length;
  };
  const piezo = model.piezometricLine;
  const piezoLines = piezo?.enabled ? piezo.lines.filter((l) => l.coordinates.length >= 2) : [];
  const main = piezoLines.length > 0 ? (mainPiezoLine({ lines: piezoLines, mainLineId: piezo.mainLineId }) ?? piezoLines[0]) : undefined;
  const piezoIds = new Map(piezoLines.map((l, i) => [l.id, i + 1]));
  const lineOf = (materialId: string) => piezo.materialAssignment[materialId] ?? main?.id;
  const piezoXml = piezoLines.map((l) => {
    const ids = l.coordinates.map((c) => lid([c[0], c[1]]));
    // the cap on the suction belongs to the line in the format, to the material in cSlope
    const caps = model.materials
      .filter((m) => lineOf(m.id) === l.id && suctionAngle(m.model) > 0)
      .map((m) => (m.model as { maxSuction?: number }).maxSuction);
    const cap = caps.length > 0 && caps.every((c) => c !== undefined && c === caps[0]) ? caps[0] : undefined;
    if (caps.some((c) => c !== undefined) && cap === undefined) {
      notes.push(`The materials with φb on the line "${l.name}" have different maximum suctions; the format has one per line, so none is written.`);
    }
    return `          <PiezometricSurface>
            <ID>${piezoIds.get(l.id)}</ID>
            <DataPoints Len="${ids.length}">
${ids.map((d) => `              <DataPoint>${d}</DataPoint>`).join("\n")}
            </DataPoints>
            <CapSuction>${cap !== undefined ? "true" : "false"}</CapSuction>
            ${cap !== undefined ? `<MaxSuction>${n(cap)}</MaxSuction>` : `<MaxSuction Missing="true" />`}
          </PiezometricSurface>`;
  });
  const usesXml = main
    ? model.materials.map((m) => {
        const line = piezo.materialAssignment[m.id] ?? main.id;
        return `          <MaterialUsesPiez ID="${matIndex.get(m.id)}" UsesID="${piezoIds.get(line) ?? piezoIds.get(main.id)}" />`;
      })
    : [];
  if (piezo?.enabled && piezo.freeWater === false) notes.push("The water lines are clipped to the ground in cSlope; the format carries free water above the ground where a line is above it.");

  // distributed loads: a fill 1 m high above the ground of unit weight = the load
  const surchargeXml = (model.udls ?? []).map((u, i) => {
    const xs = [u.x1, ...outline.map((c) => c[0]).filter((x) => x > u.x1 && x < u.x2), u.x2].sort((a, b) => a - b);
    const ids = xs.map((x) => lid([x, groundAt(outline, x) + 1]));
    return `          <Surcharge>
            <ID>${i + 1}</ID>
            <Pressure>${n(u.magnitude)}</Pressure>
            <Direction>${u.direction === "normal" ? "Normal" : "Vertical"}</Direction>
            <DataPoints Len="${ids.length}">
${ids.map((d) => `              <DataPoint>${d}</DataPoint>`).join("\n")}
            </DataPoints>
          </Surcharge>`;
  });
  if ((model.udls ?? []).length > 0) notes.push("Distributed loads are written as surcharges: a fill 1 m above the ground whose unit weight is the load.");
  const lineLoadXml = (model.lineLoads ?? []).map((l) => {
    const id = lid([l.x, groundAt(outline, l.x)]);
    return `          <LineLoadPoint>
            <ID>${id}</ID>
            <LineLoad>
              <Value>${n(l.magnitude)}</Value>
              <Direction Plunge="90" Trend="0" />
            </LineLoad>
          </LineLoadPoint>`;
  });
  if ((model.reinforcements ?? []).length > 0 || (model.piles ?? []).length > 0) notes.push("Reinforcement and piles are not written.");

  // search: entry and exit ranges on the ground
  const xs = outline.map((c) => c[0]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), xm = (x0 + x1) / 2;
  const rtl = def.orientation === "rtl";
  const lim = model.analysisLimits;
  const [entry, exit]: [number, number][] = lim?.enabled
    ? [[lim.entryLeftX, lim.entryRightX], [lim.exitLeftX, lim.exitRightX]]
    : rtl ? [[xm, x1], [x0, xm]] : [[x0, xm], [xm, x1]];
  if (!lim?.enabled) notes.push("No search limits in the model: the entry and exit ranges written are the two halves of the ground; check them.");
  const [left, right] = rtl ? [exit, entry] : [entry, exit];
  const gp = (x: number) => `X="${n(x)}" Y="${n(groundAt(outline, x))}"`;

  const opts = model.options;
  const method =
    opts.method === "Bishop" ? "Bishop" : opts.method === "Janbu" ? "Janbu"
      : opts.intersliceFunction === "constant" ? "Spencer" : "Morgenstern-Price";
  if (opts.method === "Morgenstern-Price" && opts.intersliceFunction && !["constant", "half-sine"].includes(opts.intersliceFunction)) {
    notes.push(`The interslice function "${opts.intersliceFunction}" is not written (half-sine).`);
  }
  if ((opts.tensionCrackDepth ?? 0) > 0) notes.push("The tension crack depth is not written.");
  if (opts.partialFactors) notes.push("The partial factors are not written; the file has characteristic values.");

  const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<GSIData Version="11.11">
  <FileInfo FileVersion="11.11" Comments="Exported from cSlope" />
  <Analyses Len="1">
    <Analysis>
      <ID>1</ID>
      <Name>${esc(model.name || "Stability")}</Name>
      <Kind>${KIND}</Kind>
      <Method>${method}</Method>
      <GeometryId>1</GeometryId>
      <TimeIncrements>
        <Duration Missing="true" />
        <TimeSteps Len="1">
          <TimeStep Save="true" />
        </TimeSteps>
      </TimeIncrements>
      <ComputedPhysics SlopeStability="true" />
    </Analysis>
  </Analyses>
  <Contexts Len="1">
    <Context>
      <AnalysisID>1</AnalysisID>
      <GeometryUsesMaterials Len="${rings.length}">
${rings.map((r, i) => `        <GeometryUsesMaterial ID="Regions-${i + 1}" Entry="${matIndex.get(r.materialId) ?? 1}" />`).join("\n")}
      </GeometryUsesMaterials>
      <IsDefined>true</IsDefined>
    </Context>
  </Contexts>
  <Coordinates>
    <EngCoords UnitSystem="Metric" />
  </Coordinates>
  <Geometries Len="1">
    <Geometry>
      <Name>Default Geometry</Name>
      <Points Len="${points.length}">
${points.map((p, i) => `        <Point ID="${i + 1}" X="${n(p[0])}" Y="${n(p[1])}" />`).join("\n")}
      </Points>
      <Lines Len="${lines.length}">
${lines.map(([a, b], i) => `        <Line>
          <ID>${i + 1}</ID>
          <PointID1>${a}</PointID1>
          <PointID2>${b}</PointID2>
        </Line>`).join("\n")}
      </Lines>
      <Regions Len="${rings.length}">
${rings.map((r, i) => `        <Region>
          <ID>${i + 1}</ID>
          <PointIDs>${r.ids.join(",")}</PointIDs>
        </Region>`).join("\n")}
      </Regions>
    </Geometry>
  </Geometries>
  <Materials Len="${materialsXml.length}">
${materialsXml.join("\n")}
  </Materials>
  <StabilityItems Len="1">
    <StabilityItem>
      <AnalysisID>1</AnalysisID>
      <Entry>
        <DataPoints Len="${local.length}">
${local.map((p, i) => `          <DataPoint Number="${i + 1}" X="${n(p[0])}" Y="${n(p[1])}" />`).join("\n")}
        </DataPoints>
        <PiezometricSurfaces Len="${piezoXml.length}">
${piezoXml.join("\n")}
        </PiezometricSurfaces>
        <MaterialUsesPiezs Len="${usesXml.length}">
${usesXml.join("\n")}
        </MaterialUsesPiezs>
        <Surcharges Len="${surchargeXml.length}">
${surchargeXml.join("\n")}
        </Surcharges>
        <LineLoadPoints Len="${lineLoadXml.length}">
${lineLoadXml.join("\n")}
        </LineLoadPoints>
        <SlipSurface>
          <DirectionOfSlip>${rtl ? "RightToLeft" : "LeftToRight"}</DirectionOfSlip>
          <Option>EntryExit</Option>
          <EntryExit>
            <LeftSideLeftPt ${gp(left[0])} />
            <LeftSideRightPt ${gp(left[1])} />
            <RightSideLeftPt ${gp(right[0])} />
            <RightSideRightPt ${gp(right[1])} />
          </EntryExit>
          <NumberOfSlicesPerSlip>${Math.round(opts.slices ?? 30)}</NumberOfSlicesPerSlip>
        </SlipSurface>
      </Entry>
    </StabilityItem>
  </StabilityItems>
  <WaterItems Len="1">
    <WaterItem>
      <AnalysisID>1</AnalysisID>
      <Entry>
        <UnitWaterWeight>9.81</UnitWaterWeight>
        <ResultInputInfo>
          <Option>${main ? "PiezoSurface" : "None"}</Option>
        </ResultInputInfo>
      </Entry>
    </WaterItem>
  </WaterItems>
</GSIData>
`;
  return { xml, notes };
}

/** A .gsz file (ZIP) of one model. */
export function modelToGsz(model: ModelEntry): { bytes: Uint8Array; notes: string[] } {
  const { xml, notes } = modelToGszXml(model);
  const name = (model.name || "cslope").replace(/[\\/:*?"<>|]+/g, "_");
  return { bytes: writeZip([{ name: `${name}.xml`, data: xml }]), notes };
}
