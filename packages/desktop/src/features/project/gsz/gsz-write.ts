/**
 * Writing a model as a .gsz project file: the regions (a region around a
 * lens in pieces without holes), materials (SHANSEP with its functions),
 * piezometric lines, distributed loads, point loads, seismic coefficients,
 * method, entry and exit ranges or the given slip surfaces, with the tag
 * paths and order of the format's own files. What has no counterpart in
 * the format is listed in `notes`.
 *
 * Only what the format's published example files show is written; the
 * receiving program remains the authority on its own format, so the file is
 * a starting point to check there, not a guaranteed round trip.
 */

import { MATERIAL_MODEL_LABELS, WATER_UNIT_WEIGHT, suctionAngle, type MaterialModel } from "@cslope/engine";
import { buildSlopeDTOFromModel } from "../../../store/helpers";
import type { ModelEntry } from "../../../store/types";
import { computeRegions } from "../../../utils/regions";
import { holeFreeRegions, sharedRings } from "../../../utils/region-rings";
import { writeZip } from "../../../utils/zip";
import { mainPiezoLine } from "../../../utils/piezo";
import { surfaceYAtX } from "../../view/surface";

type Pt = [number, number];

/** The analysis kind the format expects, ROT13 like the names guarded in forbidden-names.ts. */
const KIND = "FYBCR/J".replace(/[A-Z]/g, (c) => String.fromCharCode(((c.charCodeAt(0) - 65 + 13) % 26) + 65));

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const n = (v: number) => (Number.isFinite(v) ? String(Number(v.toPrecision(12))) : "0");

function rgb(hex: string | undefined): string {
  const m = hex?.match(/^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i);
  return m ? `RGB=(${parseInt(m[1], 16)},${parseInt(m[2], 16)},${parseInt(m[3], 16)})` : "RGB=(200,200,200)";
}

/** A material function (Fn2D): what it gives from what, through its points. */
interface Fn2D {
  name: string;
  output: string;
  input: string;
  points: Pt[];
  spline?: { startSlope?: number; endSlope?: number };
}

/** The format's function definition of a Fn2D (as its example files write it). */
function fnDefinition(fn: Fn2D): string {
  const io = `OutputParam=${fn.output},InputParam=${fn.input}`;
  if (!fn.spline) return `Linear(${io},SlopeBefore=0,SlopeAfter=0)`;
  // the end slopes when given (absent: computed, a natural spline)
  const slopes = [fn.spline.startSlope !== undefined ? `SlopeBefore=${n(fn.spline.startSlope)}` : "", fn.spline.endSlope !== undefined ? `SlopeAfter=${n(fn.spline.endSlope)}` : ""].filter(Boolean);
  return `Spline(${[io, "Smooth=100", "Tension=100", ...slopes, "LogInput=false", "LogOutput=false"].join(",")})`;
}

/**
 * The format's strength model and fields for a cSlope material. `addFn`
 * adds a material function and gives its id; `elevations` is the range
 * of the model's elevations (for an OCR constant with elevation).
 */
function materialXml(
  name: string,
  model: MaterialModel,
  notes: string[],
  addFn: (fn: Fn2D) => number,
  elevations: [number, number],
): { slopeModel: string; fields: [string, number | string][] } {
  const gamma = model.unitWeightSat ?? model.unitWeight;
  if (model.unitWeightSat !== undefined && model.unitWeightSat !== model.unitWeight) {
    notes.push(`Material "${name}": one unit weight is written (${gamma} kN/m³, the saturated one); the unit weight above the water line (${model.unitWeight}) is not.`);
  }
  switch (model.kind) {
    case "mohr-coulomb": {
      if (model.cohesionRateOfChange) notes.push(`Material "${name}": c′ increasing with depth is written as its reference value.`);
      if (model.cFactor) notes.push(`Material "${name}": the combined (undrained) limit is not written; drained c′ and φ′ only.`);
      const c = model.cFactor ? model.cohesion * model.cFactor : model.cohesion;
      return { slopeModel: "MohrCoulomb", fields: [["UnitWeight", gamma], ["CohesionPrime", c], ["PhiPrime", model.frictionAngle], ...phiBField(model)] };
    }
    case "undrained":
      if (model.suRateOfChange) notes.push(`Material "${name}": Su increasing with depth is written as its reference value.`);
      return { slopeModel: "UndrainedPhiZero", fields: [["UnitWeight", gamma], ["Cohesion", model.undrainedShearStrength], ["CohesionPrime", model.undrainedShearStrength]] };
    case "impenetrable":
      return { slopeModel: "Bedrock", fields: [["UnitWeight", gamma]] };
    case "s-f-depth":
    case "s-f-datum":
      notes.push(`Material "${name}": strength as a function of ${model.kind === "s-f-depth" ? "depth" : "datum"} is written as undrained with its reference Su (${model.suRef} kPa); enter the variation by hand.`);
      if (suctionAngle(model) > 0) notes.push(`Material "${name}": the strength from suction (φb = ${suctionAngle(model)}°) of the drained branch is not written.`);
      return { slopeModel: "UndrainedPhiZero", fields: [["UnitWeight", gamma], ["Cohesion", model.suRef], ["CohesionPrime", model.suRef]] };
    case "shansep": {
      if (model.suMin) notes.push(`Material "${name}": the lower limit of Su (${model.suMin} kPa) is not written.`);
      if (model.anisotropy?.length) notes.push(`Material "${name}": the anisotropy of the undrained strength is not written.`);
      const spline = model.spline ? { spline: model.spline } : {};
      if (model.suByStress && model.suByStress.length > 0) {
        // Su as a function of σ′v
        const id = addFn({ name: `${name} Su`, output: "UndrainedShearStrength", input: "YEffectiveStress", points: model.suByStress, ...spline });
        return { slopeModel: "SHANSEP", fields: [["SlopeUndrainedStrengthModel", "Function"], ["UnitWeight", gamma], ["ShearVerticalFnNum", id]] };
      }
      const m = model.exponent ?? 0.8;
      if (model.pop !== undefined || model.yieldStress !== undefined || model.yieldFromEarlierStage) {
        notes.push(`Material "${name}": the ${model.pop !== undefined ? "POP" : "yield stress"} of its SHANSEP strength is not written (the format takes OCR as a function of elevation); written with OCR = 1.`);
      }
      const byElevation = model.pop === undefined && model.yieldStress === undefined && !model.yieldFromEarlierStage
        ? model.ocrByElevation && model.ocrByElevation.length > 0
          ? { points: model.ocrByElevation, ...spline }
          : (model.ocr ?? 1) !== 1 ? { points: [[elevations[0], model.ocr!], [elevations[1], model.ocr!]] as Pt[] } : undefined
        : undefined;
      if (byElevation) {
        // Su = σ′v·S·OCR^m with OCR a function of elevation (constant: a flat one)
        const id = addFn({ name: `${name} OCR`, output: "OverconsolidationRatio", input: "Y", ...byElevation });
        return { slopeModel: "SHANSEP", fields: [["SlopeUndrainedStrengthModel", "Custom"], ["UnitWeight", gamma], ["OCRFnNum", id], ["NCUndrainedStrengthRatio", model.ratio], ["SHANSEPExponent", m]] };
      }
      // OCR = 1: Su/σ′v constant
      return { slopeModel: "SHANSEP", fields: [["UnitWeight", gamma], ["TauSigmaRatio", model.ratio], ["NCUndrainedStrengthRatio", model.ratio], ["SHANSEPExponent", m]] };
    }
    case "anisotropic-function":
      notes.push(`Material "${name}": the anisotropy is not written; Mohr-Coulomb with c and φ only.`);
      return { slopeModel: "MohrCoulomb", fields: [["UnitWeight", gamma], ["CohesionPrime", model.cohesion], ["PhiPrime", model.frictionAngle], ...phiBField(model)] };
    default:
      notes.push(`Material "${name}": the material model "${MATERIAL_MODEL_LABELS[model.kind as MaterialModel["kind"]] ?? model.kind}" has no counterpart in the export; written as Mohr-Coulomb with no strength, to be entered by hand.`);
      return { slopeModel: "MohrCoulomb", fields: [["UnitWeight", gamma], ["CohesionPrime", 0], ["PhiPrime", 0]] };
  }
}

/** φb of a material with strength from suction, as the format's UnsatPhiB (none without). */
function phiBField(model: MaterialModel): [string, number][] {
  const phiB = suctionAngle(model);
  return phiB > 0 ? [["UnsatPhiB", phiB]] : [];
}

/** The ground (top of the outline) at x; -Infinity beside the outline. */
const groundAt = (outline: Pt[], x: number): number => surfaceYAtX(outline, x) ?? -Infinity;

/** The project XML of one model (metric units). */
export function modelToGszXml(model: ModelEntry): { xml: string; notes: string[] } {
  const notes: string[] = [];
  const def = buildSlopeDTOFromModel(model);
  const outline = model.coordinates;
  if (outline.length < 3 || model.materials.length === 0) throw new Error("The model has no outline or no materials to export.");

  // regions with shared corner points
  // regions may not overlap: a region around a lens is written as pieces without holes
  const regions = holeFreeRegions(computeRegions(outline, model.materialBoundaries, model.regionMaterials, model.materials[0].id));
  if (regions.some((r) => r.holes && r.holes.length > 0)) notes.push("A region that surrounds another (a hole) could not be split into pieces and is written without the hole; check it.");
  const { points, rings } = sharedRings(regions);
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
  const functions: Fn2D[] = [];
  const addFn = (fn: Fn2D) => functions.push(fn);
  const ys = outline.map((c) => c[1]);
  const elevations: [number, number] = [Math.min(...ys), Math.max(...ys)];
  const materialsXml = model.materials.map((m, i) => {
    const { slopeModel, fields } = materialXml(m.name, m.model, notes, addFn, elevations);
    return `    <Material>
      <ID>${i + 1}</ID>
      <Color>${rgb(m.color)}</Color>
      <Name>${esc(m.name)}</Name>
      <SlopeModel>${slopeModel}</SlopeModel>
      <StressStrain>
${fields.map(([k, v]) => `        <${k}>${typeof v === "number" ? n(v) : esc(v)}</${k}>`).join("\n")}
      </StressStrain>
    </Material>`;
  });
  const functionsXml = functions.length > 0
    ? `  <Functions>
    <Material>
      <Fn2Ds Len="${functions.length}">
${functions.map((fn, i) => `        <Fn2D>
          <ID>${i + 1}</ID>
          <Name>${esc(fn.name)}</Name>
          <Function>${fnDefinition(fn)}</Function>
          <Points Len="${fn.points.length}">
${fn.points.map(([x, y]) => `            <Point X="${n(x)}" Y="${n(y)}" />`).join("\n")}
          </Points>
        </Fn2D>`).join("\n")}
      </Fn2Ds>
    </Material>
  </Functions>
`
    : "";

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
  if (def.waternet) notes.push("The head and reference lines (waternet) are not written; the format has piezometric lines per material.");
  if (def.earlierStage) notes.push("The earlier stage (the stress history it gives) is not written.");
  for (const m of model.materials) {
    const mm = m.model as { aboveWater?: unknown };
    if (mm.aboveWater) notes.push(`"${m.name}": the strength above the water line is not written.`);
    if (m.model.ru) notes.push(`"${m.name}": the pore pressure ratio rᵤ = ${m.model.ru} is not written.`);
  }
  if ((model.udls ?? []).some((u) => (u.excessPorePressure ?? []).length > 0)) notes.push("The excess pore pressure of loads not yet consolidated is not written.");
  if (piezo?.rapidDrawdown) {
    notes.push("Rapid drawdown: the three-stage analysis is not written; the water lines written are the water after drawdown, and the materials are drained.");
  } else if (model.materials.some((m) => m.model.kind === "mohr-coulomb" && m.model.drawdownStrength)) {
    notes.push("The drawdown strengths (R envelope, cR, φR) of the materials are not written.");
  }

  // B-bar: B̄ of a material, and whether its weight counts as fill (the
  // format's option with B-bar on the piezometric lines)
  const bBarXml = main
    ? model.materials.flatMap((m) => {
        const mm = m.model as { bBar?: number; bBarLoad?: boolean };
        if (mm.bBar === undefined && !mm.bBarLoad) return [];
        const attrs = [mm.bBar !== undefined ? `BBar="${n(mm.bBar)}"` : "", mm.bBarLoad ? `IsIncluded="true"` : ""].filter(Boolean).join(" ");
        return [`          <MaterialUsesBBarParam>
            <ID>${matIndex.get(m.id)}</ID>
            <Entry ${attrs} />
          </MaterialUsesBBarParam>`];
      })
    : [];
  if (bBarXml.length > 0) notes.push("B̄ is written as a value on each material; the receiving program may expect a B̄ function instead (the format's examples give one), so check it there.");
  if (!main && model.materials.some((m) => (m.model as { bBar?: number }).bBar !== undefined)) notes.push("B̄ is not written: the format applies it with piezometric lines, and the model has none.");

  // distributed loads: a fill 1 m high above the ground of unit weight = the load
  const surchargeXml = (model.udls ?? []).map((u, i) => {
    const xs = [u.x1, ...outline.map((c) => c[0]).filter((x) => x > u.x1 && x < u.x2), u.x2].sort((a, b) => a - b);
    const ids = xs.map((x) => lid([x, groundAt(outline, x) + 1]));
    return `          <Surcharge>
            <ID>${i + 1}</ID>
            <DataPoints Len="${ids.length}">
${ids.map((d) => `              <DataPoint>${d}</DataPoint>`).join("\n")}
            </DataPoints>
            <Pressure>${n(u.magnitude)}</Pressure>
${u.direction === "normal" ? "            <Direction>Normal</Direction>\n" : ""}          </Surcharge>`;
  });
  if ((model.udls ?? []).length > 0) notes.push("Distributed loads are written as surcharges: a fill 1 m above the ground whose unit weight is the load.");
  const lineLoadXml = (model.lineLoads ?? []).map((l) => {
    // the direction as the plunge below the horizontal and the compass trend
    // of the horizontal part (90: +x, 270: −x), from the angle from the
    // downward vertical (positive towards +x)
    const a = Number.isFinite(l.angle) ? ((l.angle ?? 0) * Math.PI) / 180 : 0;
    const sin = Math.abs(Math.sin(a)) < 1e-12 ? 0 : Math.sin(a);
    const plunge = (Math.asin(Math.max(-1, Math.min(1, Math.cos(a)))) * 180) / Math.PI;
    const trend = sin > 0 ? 90 : sin < 0 ? 270 : 0;
    // the load point: on a wall face when given, else the ground at x
    const y = a !== 0 && l.y !== undefined && Number.isFinite(l.y) ? l.y : groundAt(outline, l.x);
    const id = lid([l.x, y]);
    return `          <LineLoadPoint>
            <ID>${id}</ID>
            <LineLoad>
              <Value>${n(l.magnitude)}</Value>
              <Direction Plunge="${n(Number(plunge.toFixed(9)))}" Trend="${trend}" />
            </LineLoad>
          </LineLoadPoint>`;
  });
  if ((model.lineLoads ?? []).some((l) => Number.isFinite(l.angle) && Math.abs(Math.sin(((l.angle ?? 0) * Math.PI) / 180)) > 1e-12)) {
    notes.push("Inclined line loads are written with a plunge and a compass trend (90° towards +x, 270° towards −x); this direction convention of the format is unverified, so check their direction there.");
  }
  if ((model.reinforcements ?? []).length > 0 || (model.piles ?? []).length > 0) notes.push("Reinforcement and piles are not written.");

  // search: entry and exit ranges on the ground
  const xs = outline.map((c) => c[0]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), xm = (x0 + x1) / 2;
  const rtl = def.orientation === "rtl";
  const lim = model.analysisLimits;
  const [entry, exit]: [number, number][] = lim?.enabled
    ? [[lim.entryLeftX, lim.entryRightX], [lim.exitLeftX, lim.exitRightX]]
    : rtl ? [[xm, x1], [x0, xm]] : [[x0, xm], [xm, x1]];
  const [left, right] = rtl ? [exit, entry] : [entry, exit];
  const gp = (x: number) => `X="${n(x)}" Y="${n(groundAt(outline, x))}"`;

  // given slip surfaces, analysed alone: the format's fully specified
  // surfaces (a circle as a polyline along it, its centre as the axis)
  const planes = model.customSearchPlanes ?? [];
  const circles = planes.filter((p) => !p.points);
  const polylines = planes.filter((p) => p.points && p.points.length >= 2);
  const given = model.customPlanesOnly && circles.length + polylines.length > 0;
  if (!given && circles.length + polylines.length > 0) {
    notes.push("The custom slip surfaces are not written: the format analyzes either the given surfaces or a search, and the model searches as well.");
  }
  if (!given && !lim?.enabled) notes.push("No search limits in the model: the entry and exit ranges written are the two halves of the ground; check them.");
  const arc = (c: { cx: number; cy: number; radius: number }): Pt[] => {
    // from the bottom of the circle up each side, in 2° steps, to the first point above the ground
    const at = (t: number): Pt => [c.cx + c.radius * Math.sin(t), c.cy - c.radius * Math.cos(t)];
    const side = (dir: 1 | -1) => {
      const out: Pt[] = [];
      for (let k = 1; k <= 90; k++) {
        const p = at((dir * k * Math.PI) / 90);
        out.push(p);
        if (!(p[1] <= groundAt(outline, p[0]))) break;
      }
      return out;
    };
    return [...side(-1).reverse(), at(0), ...side(1)];
  };
  const slipLines: Pt[][] = given ? [...circles.map(arc), ...polylines.map((p) => p.points!.map(([x, y]) => [x, y] as Pt))] : [];
  const slipIds = slipLines.map((l) => l.map((p) => lid(p)));
  // one axis for all the surfaces: the centre of the circles when they share it
  const centre = circles[0];
  const axisId = given && polylines.length === 0 && circles.every((c) => c.cx === centre.cx && c.cy === centre.cy) ? lid([centre.cx, centre.cy]) : undefined;
  if (given) {
    if (circles.length > 0) notes.push(`${circles.length === 1 ? "The custom circle is" : "The custom circles are"} written as fully specified slip surfaces along the circle (in 2° steps)${axisId !== undefined ? ", with the center as the axis" : ""}.`);
    if (axisId === undefined) notes.push("The fully specified slip surfaces are written without an axis; the receiving program takes its own.");
  }
  const slipXml = given
    ? `          <Option>FullySpecified</Option>
`
    : "";
  const axisXml = axisId !== undefined ? `          <Axis ID="${axisId}" />
` : "";
  const fullyXml = given
    ? `          <FullySpecifiedSlips Len="${slipIds.length}">
${slipIds.map((ids, i) => `            <FullySpecifiedSlip>
              <ID>${i + 1}</ID>
              <DataPoints Len="${ids.length}">
${ids.map((d) => `                <DataPoint>${d}</DataPoint>`).join("\n")}
              </DataPoints>
            </FullySpecifiedSlip>`).join("\n")}
          </FullySpecifiedSlips>
`
    : "";

  const opts = model.options;
  const method =
    opts.method === "Bishop" ? "Bishop" : opts.method === "Janbu" ? "Janbu"
      : opts.intersliceFunction === "constant" ? "Spencer" : "Morgenstern-Price";
  if (opts.method === "Morgenstern-Price" && opts.intersliceFunction && !["constant", "half-sine"].includes(opts.intersliceFunction)) {
    notes.push(`The interslice function "${opts.intersliceFunction}" is not written (half-sine).`);
  }
  if ((opts.tensionCrackDepth ?? 0) > 0 || opts.tensionCrackAuto) notes.push("The tension crack depth is not written (the crack angle is).");
  const crackXml =
    (opts.tensionCrackAngle ?? 0) > 0
      ? `        <TensionCrack>
          <TensionOption>Angle</TensionOption>
          <Angle>${n(rtl ? opts.tensionCrackAngle! : 180 - opts.tensionCrackAngle!)}</Angle>
          <PctFilledWithWater>${n(opts.tensionCrackWater ?? 0)}</PctFilledWithWater>
        </TensionCrack>
`
      : "";
  if (opts.partialFactors) notes.push("The partial factors are not written; the file has characteristic values.");
  // pseudostatic coefficients (kv positive downward, as cSlope's); blank when none, as the format writes it
  const kh = opts.seismicHorizontal ?? 0, kv = opts.seismicVertical ?? 0;
  const seismicXml = `        <Seismic Horizontal="${kh !== 0 ? n(kh) : ""}" Vertical="${kv !== 0 ? n(kv) : ""}" />
`;
  // an element with its items, left out when there are none (as the format's files do)
  const list = (tag: string, item: string[]) => (item.length > 0 ? `        <${tag} Len="${item.length}">
${item.join("\n")}
        </${tag}>
` : "");
  // the phreatic correction of the pore pressure; left out for the default (the vertical head)
  const controlXml = opts.porePressureHead === "phreatic-correction" ? `        <Control>
          <IsPiezPhreatic>true</IsPiezPhreatic>
        </Control>
` : "";
  // the limits on the slip surfaces: the smallest sliding mass (per unit width, m²) and depth; left out when not set
  const limitsXml = [
    (opts.minSlipArea ?? 0) > 0 ? `          <MinimumVolume>${n(opts.minSlipArea!)}</MinimumVolume>\n` : "",
    (opts.minSlipDepth ?? 0) > 0 ? `          <MinimumDepth>${n(opts.minSlipDepth!)}</MinimumDepth>\n` : "",
  ].join("");
  const waterOption = main ? (bBarXml.length > 0 ? "PiezoSurfaceBbar" : "PiezoSurface") : undefined;

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
${functionsXml}  <Geometries Len="1">
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
${controlXml}${list("DataPoints", local.map((p, i) => `          <DataPoint Number="${i + 1}" X="${n(p[0])}" Y="${n(p[1])}" />`))}        <SlipSurface>
${slipXml}          <EntryExit>
            <LeftSideLeftPt ${gp(left[0])} />
            <LeftSideRightPt ${gp(left[1])} />
            <RightSideLeftPt ${gp(right[0])} />
            <RightSideRightPt ${gp(right[1])} />
          </EntryExit>
${axisXml}${rtl ? `          <DirectionOfSlip>RightToLeft</DirectionOfSlip>
` : ""}${fullyXml}          <NumberOfSlicesPerSlip>${Math.round(opts.slices ?? 30)}</NumberOfSlicesPerSlip>
${limitsXml}        </SlipSurface>
${list("LineLoadPoints", lineLoadXml)}${list("Surcharges", surchargeXml)}${seismicXml}${crackXml}${list("PiezometricSurfaces", piezoXml)}${list("MaterialUsesPiezs", usesXml)}${list("MaterialUsesBBarParams", bBarXml)}      </Entry>
    </StabilityItem>
  </StabilityItems>
  <WaterItems Len="1">
    <WaterItem>
      <AnalysisID>1</AnalysisID>
      <Entry>
        <UnitWaterWeight>${opts.waterUnitWeight ?? WATER_UNIT_WEIGHT}</UnitWaterWeight>
${waterOption ? `        <ResultInputInfo>
          <Option>${waterOption}</Option>
        </ResultInputInfo>
` : ""}      </Entry>
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
