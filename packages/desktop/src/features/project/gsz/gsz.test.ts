import { describe, expect, it } from "vitest";
import { analyseSlope, buildSlope, DEFAULT_ANALYSIS_OPTIONS, toCanonicalSlopeDefinition, type SlopeDefinition } from "@cslope/engine";
import { readZip, writeZip } from "../../../utils/zip";
import { parseGszXml, parseSlipSurfaceCsv, readGsz } from "./gsz-read";
import { gszToDefinition } from "./gsz-to-definition";
import { modelToGsz, modelToGszXml } from "./gsz-write";
import { gszImports } from "../importGsz";
import { modelFromDefinition } from "../../../store/definition-model";

async function deflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const source = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(data);
      c.close();
    },
  });
  const out = source.pipeThrough(new CompressionStream("deflate-raw") as unknown as ReadableWritablePair<Uint8Array, Uint8Array>);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

/** A ZIP with one deflated entry, as the format's files are written. */
async function deflatedZip(name: string, text: string): Promise<Uint8Array> {
  const data = new TextEncoder().encode(text);
  const comp = await deflateRaw(data);
  const stored = writeZip([{ name, data }]);
  // rewrite the stored entry as method 8 with the compressed bytes
  const nameBytes = new TextEncoder().encode(name);
  const local = new Uint8Array(30 + nameBytes.length);
  local.set(stored.subarray(0, 30 + nameBytes.length));
  const lv = new DataView(local.buffer);
  lv.setUint16(8, 8, true);
  lv.setUint32(18, comp.length, true);
  const cenStart = 30 + nameBytes.length + data.length;
  const cen = stored.slice(cenStart, cenStart + 46 + nameBytes.length);
  const cv = new DataView(cen.buffer);
  cv.setUint16(10, 8, true);
  cv.setUint32(20, comp.length, true);
  const end = stored.slice(stored.length - 22);
  const ev = new DataView(end.buffer);
  ev.setUint32(16, local.length + comp.length, true);
  const out = new Uint8Array(local.length + comp.length + cen.length + end.length);
  out.set(local, 0);
  out.set(comp, local.length);
  out.set(cen, local.length + comp.length);
  out.set(end, local.length + comp.length + cen.length);
  return out;
}

// Two layers under a 1:2 slope from y = 10 (x ≤ 10) down to y = 5 (x ≥ 20);
// the layer boundary at y = 3 has a corner (point 9) on the right edge only
// of the lower region (a T-junction for the upper one).
const XML = `<?xml version="1.0" encoding="UTF-8"?>
<GSIData Version="11.11">
  <Analyses Len="2">
    <Analysis><ID>1</ID><Name>Short term</Name><Kind>Slope stability</Kind><Method>Spencer</Method><GeometryId>1</GeometryId></Analysis>
    <Analysis><ID>2</ID><Name>Seepage</Name><Kind>Seepage</Kind><GeometryId>1</GeometryId></Analysis>
  </Analyses>
  <Contexts Len="1">
    <Context>
      <AnalysisID>1</AnalysisID>
      <GeometryUsesMaterials Len="2">
        <GeometryUsesMaterial ID="Regions-1" Entry="1" />
        <GeometryUsesMaterial ID="Regions-2" Entry="2" />
      </GeometryUsesMaterials>
    </Context>
  </Contexts>
  <Coordinates><EngCoords UnitSystem="Metric" /></Coordinates>
  <Geometries Len="1">
    <Geometry>
      <Points Len="9">
        <Point ID="1" X="0" Y="10" /><Point ID="2" X="10" Y="10" /><Point ID="3" X="20" Y="5" />
        <Point ID="4" X="30" Y="5" /><Point ID="5" X="30" Y="3" /><Point ID="6" X="0" Y="3" />
        <Point ID="7" X="0" Y="0" /><Point ID="8" X="30" Y="0" /><Point ID="9" X="15" Y="3" />
      </Points>
      <Regions Len="2">
        <Region><ID>1</ID><PointIDs>1,2,3,4,5,6</PointIDs></Region>
        <Region><ID>2</ID><PointIDs>6,9,5,8,7</PointIDs></Region>
      </Regions>
    </Geometry>
  </Geometries>
  <Materials Len="2">
    <Material><ID>1</ID><Name>Fill</Name><Color>RGB=(255,128,0)</Color><SlopeModel>MohrCoulomb</SlopeModel>
      <StressStrain><UnitWeight>19</UnitWeight><CohesionPrime>2</CohesionPrime><PhiPrime>32</PhiPrime><Rf Missing="true" /></StressStrain></Material>
    <Material><ID>2</ID><Name>Clay</Name><SlopeModel>UndrainedPhiZero</SlopeModel>
      <StressStrain><UnitWeight>17</UnitWeight><Cohesion>25</Cohesion></StressStrain></Material>
  </Materials>
  <StabilityItems Len="1">
    <StabilityItem>
      <AnalysisID>1</AnalysisID>
      <Entry>
        <DataPoints Len="5">
          <DataPoint Number="1" X="0" Y="6" /><DataPoint Number="2" X="30" Y="4" />
          <DataPoint Number="3" X="2" Y="11.5" /><DataPoint Number="4" X="8" Y="11.5" /><DataPoint Number="5" X="5" Y="10" />
        </DataPoints>
        <PiezometricSurfaces Len="1">
          <PiezometricSurface><ID>1</ID><DataPoints Len="2"><DataPoint>1</DataPoint><DataPoint>2</DataPoint></DataPoints></PiezometricSurface>
        </PiezometricSurfaces>
        <MaterialUsesPiezs Len="1"><MaterialUsesPiez ID="1" UsesID="1" /></MaterialUsesPiezs>
        <Surcharges Len="1">
          <Surcharge><ID>1</ID><Pressure>20</Pressure><DataPoints Len="2"><DataPoint>3</DataPoint><DataPoint>4</DataPoint></DataPoints></Surcharge>
        </Surcharges>
        <LineLoadPoints Len="1">
          <LineLoadPoint><ID>5</ID><LineLoad><Value>40</Value><Direction Plunge="90" Trend="0" /></LineLoad></LineLoadPoint>
        </LineLoadPoints>
        <SlipSurface>
          <DirectionOfSlip>LeftToRight</DirectionOfSlip>
          <Option>EntryExit</Option>
          <EntryExit>
            <LeftSideLeftPt X="1" Y="10" /><LeftSideRightPt X="9" Y="10" />
            <RightSideLeftPt X="21" Y="5" /><RightSideRightPt X="29" Y="5" />
          </EntryExit>
          <NumberOfSlicesPerSlip>40</NumberOfSlicesPerSlip>
        </SlipSurface>
      </Entry>
    </StabilityItem>
  </StabilityItems>
  <WaterItems Len="1">
    <WaterItem><AnalysisID>1</AnalysisID><Entry><UnitWaterWeight>9.807</UnitWaterWeight><ResultInputInfo><Option>PiezoSurface</Option></ResultInputInfo></Entry></WaterItem>
  </WaterItems>
</GSIData>`;

const CSV = "SlipNum,SlipFOS,SlipCenterX,SlipCenterY,SlipRadiusX,SlipWeight,SlipOrigSearchMethod,MobilizedShearDirection\n1,1.5,15,18,14,900,5,-1.5707963\n2,999,15,18,1,0,5,-1.57\n3,1.4,14,17,13.5,800,5,-1.5707963\n";

const fos = (def: SlopeDefinition, options: object = {}) => {
  const s = buildSlope(toCanonicalSlopeDefinition(def));
  // circles only: a short search, so that the import, not the search, is compared
  s.updateAnalysisOptions({ ...DEFAULT_ANALYSIS_OPTIONS, slices: 30, iterations: 300, refinedIterations: 150, compositeSurfaces: false, ...options });
  return analyseSlope(s) as number;
};

describe("ZIP", () => {
  it("reads back what it writes and reads deflated entries", async () => {
    const z = writeZip([{ name: "a.xml", data: "<x>å</x>" }, { name: "dir/b.csv", data: "1,2" }]);
    const r = await readZip(z);
    expect(new TextDecoder().decode(r.get("a.xml"))).toBe("<x>å</x>");
    expect(new TextDecoder().decode(r.get("dir/b.csv"))).toBe("1,2");
    const d = await readZip(await deflatedZip("m.xml", XML));
    expect(new TextDecoder().decode(d.get("m.xml"))).toBe(XML);
  });

  it("refuses entries above the limits before unpacking them", async () => {
    const z = writeZip([{ name: "a.xml", data: "x".repeat(12) }, { name: "b.xml", data: "y".repeat(8) }]);
    await expect(readZip(z, undefined, { entryBytes: 10, totalBytes: 100 })).rejects.toThrow(/a\.xml is too large to import \(1 MB unpacked; at most 1 MB\)/);
    await expect(readZip(z, undefined, { entryBytes: 20, totalBytes: 15 })).rejects.toThrow(/archive is too large to import \(its entries unpack to more than 1 MB\)/);
    // the limits count only the entries wanted
    expect((await readZip(z, (n) => n === "b.xml", { entryBytes: 20, totalBytes: 15 })).size).toBe(1);
    expect((await readZip(z, undefined, { entryBytes: 20, totalBytes: 20 })).size).toBe(2);
  });
});

describe(".gsz import", () => {
  it("refuses a model XML with a document type declaration", async () => {
    const doctype = XML.replace("<GSIData", '<!DOCTYPE GSIData [<!ENTITY a "aaaaaaaaaa"><!ENTITY b "&a;&a;&a;&a;&a;&a;&a;&a;&a;&a;">]>\n<GSIData');
    expect(() => parseGszXml(doctype)).toThrow(/DOCTYPE declaration, which a \.gsz file never has/);
    expect(() => parseGszXml(XML.replace("<GSIData", "<!doctype GSIData>\n<GSIData"))).toThrow(/DOCTYPE/);
    await expect(readGsz(writeZip([{ name: "m.xml", data: doctype }]))).rejects.toThrow(/DOCTYPE/);
  });

  it("reads the analyses, regions, materials, water, loads and search", () => {
    const f = parseGszXml(XML);
    expect(f.units).toBe("metric");
    expect(f.analyses.map((a) => a.name)).toEqual(["Short term", "Seepage"]);
    expect(f.materials.get(1)).toMatchObject({ name: "Fill", model: "MohrCoulomb", color: [255, 128, 0] });
    expect(f.materials.get(1)!.fields).not.toHaveProperty("Rf");
    const st = f.stability.get(1)!;
    expect(st.piezometric.get(1)).toEqual([[0, 6], [30, 4]]);
    expect(st.surcharges[0]).toMatchObject({ unitWeight: 20, line: [[2, 11.5], [8, 11.5]] });
    expect(st.lineLoads[0]).toMatchObject({ x: 5, y: 10, value: 40, plunge: 90 });
    expect(st.entryExit).toEqual({ left: [1, 9], right: [21, 29] });
  });

  it("builds a slope definition from one stability analysis", () => {
    const f = { ...parseGszXml(XML), results: new Map([["short term", parseSlipSurfaceCsv(CSV)]]) };
    const imp = gszToDefinition(f, 1, "Section A.gsz");
    const d = imp.definition;
    expect(imp.name).toBe("Section A");
    // outline from the edges used once
    expect(d.coordinates).toHaveLength(8);
    expect(d.coordinates).toEqual(expect.arrayContaining([[0, 3], [30, 3], [0, 0], [30, 0], [10, 10]]));
    // the layer boundary from x = 0 to x = 30 through the T-junction
    expect(d.materialBoundaries).toHaveLength(1);
    const b = d.materialBoundaries![0].coordinates;
    expect(b.map((p) => p[1])).toEqual([3, 3, 3]);
    expect(d.materials.map((m) => [m.name, m.model?.kind])).toEqual([["Fill", "mohr-coulomb"], ["Clay", "undrained"]]);
    expect(d.materials[0].color).toBe("#ff8000");
    expect(d.regionAssignments!.find((a) => a.materialName === "Clay")!.point[1]).toBeLessThan(3);
    // the fill uses the line, the clay has none (a line below the model)
    expect(d.waterTable).toEqual({ mode: "custom", value: [[0, 6], [30, 4]], followBoundary: false });
    expect(d.materials[1].waterTableId).toBe("no-water");
    expect(d.waterTables![0].coordinates[0][1]).toBeLessThan(0);
    // and the app takes it (all lines with the same free-water setting)
    expect(() => modelFromDefinition(d, { id: "x", name: "x" })).not.toThrow();
    // surcharge: 20 kN/m³ × 1.5 m above the crest = 30 kPa on x 2–8
    expect(d.udls!.every((u) => u.magnitude === 30)).toBe(true);
    expect(Math.min(...d.udls!.map((u) => u.x1))).toBe(2);
    expect(Math.max(...d.udls!.map((u) => u.x2))).toBe(8);
    expect(d.lineLoads).toEqual([{ magnitude: 40, x: 5 }]);
    expect(d.orientation).toBe("ltr");
    expect(d.analysisLimits).toEqual({ entryLeftX: 1, entryRightX: 9, exitLeftX: 21, exitRightX: 29 });
    expect(imp.options).toMatchObject({ method: "Morgenstern-Price", intersliceFunction: "constant", slices: 40 });
    // the file's critical circle (the sentinel factor 999 left out)
    expect(imp.reference).toMatchObject({ fos: 1.4, cx: 14, cy: 17, r: 13.5 });
    expect(d.customSearchPlanes).toEqual([{ cx: 14, cy: 17, radius: 13.5 }]);
    expect(imp.notes.join(" ")).toMatch(/Materials without a piezometric line \(Clay\)/);
    expect(Number.isFinite(fos(d, imp.options))).toBe(true);
  });

  it("does not take a surface with projected ends for a circle", () => {
    const xml = XML.replace("<NumberOfSlicesPerSlip>", '<Radius NumInc="10" UseRightAngle="true" RightAngle="30" /><NumberOfSlicesPerSlip>');
    const imp = gszToDefinition({ ...parseGszXml(xml), results: new Map([["short term", parseSlipSurfaceCsv(CSV)]]) }, 1);
    expect(imp.reference).toBeUndefined();
    expect(imp.notes.join(" ")).toMatch(/not a circle/);
  });

  it("gives a material whose strength is a function a placeholder the model accepts", () => {
    const xml = XML.replace("<SlopeModel>UndrainedPhiZero</SlopeModel>", "<SlopeModel>MohrCoulombSpatial</SlopeModel>").replace("<Cohesion>25</Cohesion>", "<CohesionSpatialFnNum>1</CohesionSpatialFnNum>");
    const imp = gszToDefinition({ ...parseGszXml(xml), results: new Map() }, 1);
    expect(imp.definition.materials[1].model).toMatchObject({ kind: "mohr-coulomb", cohesion: 0.001, frictionAngle: 0 });
    expect(Number.isFinite(fos(imp.definition))).toBe(true);
  });

  it("imports a surcharge normal to the ground as a load normal to it, and exports it back", async () => {
    const xml = XML.replace("<Pressure>20</Pressure>", "<Pressure>20</Pressure><Direction>Normal</Direction>");
    const imp = gszToDefinition({ ...parseGszXml(xml), results: new Map() }, 1);
    expect(imp.definition.udls!.every((u) => u.direction === "normal")).toBe(true);
    expect(imp.notes.join(" ")).not.toMatch(/imported as vertical/);
    const model = modelFromDefinition(imp.definition, { id: "n", name: "N" });
    const { xml: out } = modelToGszXml(model);
    expect(out).toContain("<Direction>Normal</Direction>");
    const [back] = await gszImports(modelToGsz(model).bytes, "N.gsz");
    expect(back.definition.udls!.every((u) => u.direction === "normal")).toBe(true);
  });

  it("reads the default search (no Option) and an exit given as a point", () => {
    const xml = XML.replace("<Option>EntryExit</Option>", "")
      .replace('<RightSideLeftPt X="21" Y="5" /><RightSideRightPt X="29" Y="5" />', '<RightOption>Point</RightOption><RightSideLeftPt X="21" Y="5" />');
    const d = gszToDefinition({ ...parseGszXml(xml), results: new Map() }, 1).definition;
    expect(d.analysisLimits).toEqual({ entryLeftX: 1, entryRightX: 9, exitLeftX: 21, exitRightX: 21 });
  });

  it("imports a fully specified slip surface with its axis, analysed alone", () => {
    const xml = XML.replace('<DataPoint Number="5" X="5" Y="10" />', '<DataPoint Number="5" X="5" Y="10" /><DataPoint Number="6" X="4" Y="10" /><DataPoint Number="7" X="12" Y="4" /><DataPoint Number="8" X="24" Y="5" /><DataPoint Number="9" X="14" Y="18" />')
      .replace("<Option>EntryExit</Option>", "<Option>FullySpecified</Option><Axis ID=\"9\" /><FullySpecifiedSlips Len=\"1\"><FullySpecifiedSlip><ID>1</ID><DataPoints Len=\"3\"><DataPoint>6</DataPoint><DataPoint>7</DataPoint><DataPoint>8</DataPoint></DataPoints></FullySpecifiedSlip></FullySpecifiedSlips>");
    const imp = gszToDefinition({ ...parseGszXml(xml), results: new Map() }, 1);
    expect(imp.definition.customSurfaces).toEqual([{ points: [[4, 10], [12, 4], [24, 5]], axis: [14, 18] }]);
    expect(imp.definition.customPlanesOnly).toBe(true);
    expect(imp.notes.join(" ")).toMatch(/fully specified slip surface is imported/);
    expect(imp.notes.join(" ")).not.toMatch(/search \("FullySpecified"\) is not imported/);
  });

  it("imports a block search: its grids as windows, its end angles as inclinations", () => {
    const xml = XML.replace('<DataPoint Number="5" X="5" Y="10" />', '<DataPoint Number="5" X="5" Y="10" /><DataPoint Number="6" X="6" Y="6" /><DataPoint Number="7" X="6" Y="3" /><DataPoint Number="8" X="10" Y="3" /><DataPoint Number="9" X="18" Y="4" /><DataPoint Number="10" X="18" Y="2" /><DataPoint Number="11" X="24" Y="2" />')
      .replace("<Option>EntryExit</Option>", '<Option>Block</Option><Block><LeftGrid Angle1="115" Angle2="135" PointUL="6" PointLL="7" PointLR="8" /><RightGrid Angle1="30" Angle2="45" PointUL="9" PointLL="10" PointLR="11" /></Block><IsOptimizationOn>true</IsOptimizationOn>');
    const imp = gszToDefinition({ ...parseGszXml(xml), results: new Map() }, 1);
    expect(imp.definition.blockSearchObjects).toEqual([
      { points: [[6, 6], [6, 3], [10, 3], [10, 6]] },
      { points: [[18, 4], [18, 2], [24, 2], [24, 4]] },
    ]);
    // 115–135° counter-clockwise from +x: the upslope end rises backwards at 45–65°
    expect(imp.options).toMatchObject({ searchMethod: "block", blockActiveAngle: [45, 65], blockPassiveAngle: [30, 45], nonCircularOptimization: true });
  });

  it("leaves the Rankine angle for block end angles outside 0–90° and reads one angle as fixed", () => {
    const xml = XML.replace('<DataPoint Number="5" X="5" Y="10" />', '<DataPoint Number="5" X="5" Y="10" /><DataPoint Number="6" X="6" Y="6" /><DataPoint Number="7" X="6" Y="3" /><DataPoint Number="8" X="10" Y="3" /><DataPoint Number="9" X="18" Y="4" /><DataPoint Number="10" X="18" Y="2" /><DataPoint Number="11" X="24" Y="2" />')
      .replace("<Option>EntryExit</Option>", '<Option>Block</Option><Block><LeftGrid Angle1="125" Angle2="" PointUL="6" PointLL="7" PointLR="8" /><RightGrid Angle1="10" Angle2="-15" PointUL="9" PointLL="10" PointLR="11" /></Block>');
    const imp = gszToDefinition({ ...parseGszXml(xml), results: new Map() }, 1);
    expect(imp.options.blockActiveAngle).toEqual([55, 55]);
    expect(imp.options.blockPassiveAngle).toBeUndefined();
    expect(imp.notes.join(" ")).toMatch(/downslope end angles of the block search \(-15° to 10° from the horizontal\) are outside 0–90°/);
  });

  it("finds the results of an analysis with a slash in its name", async () => {
    const xml = XML.replace("<Name>Short term</Name>", "<Name>Short/long term</Name>");
    const imps = await gszImports(writeZip([{ name: "S.xml", data: xml }, { name: "Short&3long term/001/slip_surface.csv", data: CSV }]), "S.gsz");
    expect(imps[0].reference?.fos).toBe(1.4);
  });

  it("imports S = f(depth) from the top of the layer, with an anisotropy function", () => {
    const xml = XML.replace("<SlopeModel>MohrCoulomb</SlopeModel>", "<SlopeModel>SFnDepth</SlopeModel>")
      .replace("<CohesionPrime>", "<ShearAnisoFnNum>1</ShearAnisoFnNum><CTopOfLayer>12</CTopOfLayer><CRateOfIncrease>2</CRateOfIncrease><CohesionPrime>")
      .replace("</GSIData>", '<Functions><Material><StressStrain><AnisoFns Len="1"><AnisoFn><ID>1</ID><Points Len="3"><Point X="10" Y="1" /><Point X="-10" Y="1" /><Point X="0" Y="0.7" /></Points></AnisoFn></AnisoFns></StressStrain></Material></Functions></GSIData>');
    const imp = gszToDefinition({ ...parseGszXml(xml), results: new Map() }, 1);
    const m = imp.definition.materials.find((x) => x.model?.kind === "s-f-depth")!;
    expect(m.model).toMatchObject({ suRef: 12, depthRef: 0, rate: 2, depthReference: "layer-top", anisotropy: [[-10, 1], [0, 0.7], [10, 1]] });
    expect(imp.notes.join(" ")).toMatch(/anisotropy function is imported as factors interpolated linearly/);
  });

  it("imports Hoek-Brown from GSI, mi (10 when not given) and D, or from mb, s and a", () => {
    const hb = (fields: string) => XML.replace("<SlopeModel>MohrCoulomb</SlopeModel>", "<SlopeModel>HoekBrown</SlopeModel>")
      .replace("<CohesionPrime>2</CohesionPrime><PhiPrime>32</PhiPrime>", fields);
    const a = gszToDefinition({ ...parseGszXml(hb("<UniaxialCompressiveStrength>20000</UniaxialCompressiveStrength><GeologicalStrengthIndex>20</GeologicalStrengthIndex><DisturbanceFactor>1</DisturbanceFactor><IsHoekBrownDerivedCalc>true</IsHoekBrownDerivedCalc>")), results: new Map() }, 1);
    expect(a.definition.materials.find((m) => m.name === "Fill")!.model).toMatchObject({ kind: "hoek-brown", ucs: 20000, gsi: 20, mi: 10, disturbance: 1 });
    expect(a.notes.join(" ")).toMatch(/no mi in the file; 10 used/);
    const b = gszToDefinition({ ...parseGszXml(hb("<UniaxialCompressiveStrength>20000</UniaxialCompressiveStrength><HoekBrownMB>0.045</HoekBrownMB><HoekBrownS>1e-06</HoekBrownS>")), results: new Map() }, 1);
    expect(b.definition.materials.find((m) => m.name === "Fill")!.model).toMatchObject({ kind: "hoek-brown", ucs: 20000, mb: 0.045, s: 1e-6 });
  });

  it("imports anchors, nails, geosynthetics and piles (old files' reduction factors applied)", () => {
    const reinf = (body: string) => `<Reinforcements Len="1"><Reinforcement><Name>R</Name><ID>1</ID>${body}</Reinforcement></Reinforcements><StabilityItems`;
    const line = '<DataPoint Number="5" X="5" Y="10" /><DataPoint Number="6" X="10" Y="9" /><DataPoint Number="7" X="2" Y="7" />';
    const lines = '<ReinforcementLines Len="1"><ReinforcementLine ID="1" Reinforcement="1" Point1Id="6" Point2Id="7" /></ReinforcementLines></Entry>';
    const imp = (body: string) => {
      const xml = XML.replace("<StabilityItems", reinf(body)).replace('<DataPoint Number="5" X="5" Y="10" />', line).replace("</Entry>", lines);
      return gszToDefinition({ ...parseGszXml(xml), results: new Map() }, 1);
    };
    // an anchor: bond (a stress) over π × the diameter, over the bonded length; its head on the wall
    const a = imp("<Spacing>2</Spacing><BondLength>3</BondLength><BondDiameter>0.31831</BondDiameter><TensileCapacity>2000</TensileCapacity><ReinforcementForceReductionFactor>2</ReinforcementForceReductionFactor><PulloutResistance>300</PulloutResistance><PulloutReductionFactor>1.5</PulloutReductionFactor><FofSDependent>true</FofSDependent>");
    expect(a.definition.reinforcements).toHaveLength(1);
    expect(a.definition.reinforcements![0]).toMatchObject({ x1: 10, y1: 9, x2: 2, y2: 7, tensileCapacity: 1000, spacing: 2, end1Capacity: 1000, direction: "axial", application: "passive" });
    expect(a.definition.reinforcements![0].pullout).toMatchObject({ kind: "bond", bondedLength: 3 });
    expect((a.definition.reinforcements![0].pullout as { strength: number }).strength).toBeCloseTo(200, 3);
    expect(a.notes.join(" ")).toMatch(/Distributed reinforcement forces/);
    // a nail without a plate: bond along all of it, nothing at the head
    const n = imp("<Type>Nail</Type><Spacing>2</Spacing><BondDiameter>0.31831</BondDiameter><Tensile>200</Tensile><PulloutResistance>66.7</PulloutResistance><ForceDistribution>Concentrated</ForceDistribution>");
    expect(n.definition.reinforcements![0]).toMatchObject({ end1Capacity: 0, application: "active" });
    expect(n.definition.reinforcements![0].pullout).not.toHaveProperty("bondedLength");
    expect(n.notes.join(" ")).not.toMatch(/Distributed/);
    // a geosynthetic with the pullout from the overburden; along the slip surface
    const g = imp("<Type>Geosynthetic</Type><CalculatedPulloutResistance>true</CalculatedPulloutResistance><InterfaceShearAngle>21</InterfaceShearAngle><SurfaceAreaFactor>1</SurfaceAreaFactor><Tensile>120</Tensile><PlateCapacity>120</PlateCapacity><ForceOrientation>1</ForceOrientation>");
    expect(g.definition.reinforcements![0]).toMatchObject({ tensileCapacity: 120, end1Capacity: 120, direction: "tangent", pullout: { kind: "interface", adhesion: 0, frictionAngle: 21, coverage: 0.5 } });
    expect(g.definition.reinforcements![0]).not.toHaveProperty("spacing");
    // a pile: its shear force along the slip surface; an anchor with shear adds one
    const p = imp("<Type>Pile</Type><Shear>50</Shear>");
    expect(p.definition.reinforcements).toBeUndefined();
    expect(p.definition.piles).toEqual([{ x1: 10, y1: 9, x2: 2, y2: 7, force: 50, direction: "tangent", application: "active" }]);
    const s = imp("<Spacing>2</Spacing><Tensile>1000</Tensile><Shear>25</Shear>");
    expect(s.definition.reinforcements).toHaveLength(1);
    expect(s.definition.piles![0]).toMatchObject({ force: 25, spacing: 2 });
    // a user-defined force is not imported
    const u = imp("<Type>UserDefined</Type><ReinfForceVsDistanceFnNum>1</ReinfForceVsDistanceFnNum>");
    expect(u.definition.reinforcements).toBeUndefined();
    expect(u.notes.join(" ")).toMatch(/user-defined force/);
  });

  it("takes the circle's centre from its slices when the file reports the moment axis", async () => {
    const { circleFromColumns } = await import("./gsz-read");
    // a circle centred (40, 23), radius 26.5, from x 14.2 to 20
    const y = (x: number) => 23 - Math.sqrt(26.5 ** 2 - (x - 40) ** 2);
    const csv = ["ColumnNum,XLeft,XRight,YBackBotLeft,YBackBotRight", `1,14.2,15,${y(14.2)},${y(15)}`, `2,15,20,${y(15)},${y(20)}`].join("\n");
    const c = circleFromColumns(csv, 26.5)!;
    expect(c[0]).toBeCloseTo(40, 9);
    expect(c[1]).toBeCloseTo(23, 9);
  });

  it("imports SHANSEP with its OCR spline, shear-normal functions, B-bar pore pressure and seismic coefficients", () => {
    const fns = `<Functions><Material><Fn2Ds Len="1"><Fn2D><ID>1</ID><Function>Spline(OutputParam=OverconsolidationRatio,InputParam=Y,Smooth=100,Tension=100,SlopeBefore=0,SlopeAfter=0,LogInput=false,LogOutput=false)</Function><Points Len="2"><Point X="2" Y="2" /><Point X="0" Y="1" /></Points></Fn2D></Fn2Ds><StressStrain><StrengthFns Len="1"><StrengthFn><ID>1</ID><Function>Spline(OutputParam=ShearStress,InputParam=NormalStress,Smooth=100,Tension=100,SlopeBefore=Calc,SlopeAfter=Calc,LogInput=false,LogOutput=false)</Function><Points Len="3"><Point X="0" Y="0" /><Point X="50" Y="30" /><Point X="100" Y="50" /></Points></StrengthFn></StrengthFns></StressStrain></Material></Functions><StabilityItems`;
    const clay = (body: string) =>
      XML.replace("<StabilityItems", fns)
        .replace(/<Material><ID>2<\/ID><Name>Clay<\/Name><SlopeModel>UndrainedPhiZero<\/SlopeModel>\s*<StressStrain><UnitWeight>17<\/UnitWeight><Cohesion>25<\/Cohesion><\/StressStrain><\/Material>/, `<Material><ID>2</ID><Name>Clay</Name>${body}</Material>`);
    const shansep = gszToDefinition({ ...parseGszXml(clay("<SlopeModel>SHANSEP</SlopeModel><StressStrain><UnitWeight>17</UnitWeight><SlopeUndrainedStrengthModel>Custom</SlopeUndrainedStrengthModel><OCRFnNum>1</OCRFnNum><NCUndrainedStrengthRatio>0.3</NCUndrainedStrengthRatio><SHANSEPExponent>0.8</SHANSEPExponent></StressStrain>")), results: new Map() }, 1);
    expect(shansep.definition.materials.find((m) => m.name === "Clay")!.model).toEqual({ kind: "shansep", unitWeight: 17, ratio: 0.3, exponent: 0.8, ocrByElevation: [[0, 1], [2, 2]], spline: { startSlope: 0, endSlope: 0 } });
    const sn = gszToDefinition({ ...parseGszXml(clay("<SlopeModel>ShearNormalFn</SlopeModel><StressStrain><UnitWeight>17</UnitWeight><StrengthFnNum>1</StrengthFnNum></StressStrain>")), results: new Map() }, 1);
    expect(sn.definition.materials.find((m) => m.name === "Clay")!.model).toEqual({ kind: "shear-normal", unitWeight: 17, points: [[0, 0], [50, 30], [100, 50]], spline: {} });
    // B-bar: the fill raises the clay's pore pressure; seismic coefficients
    const bb = XML.replace("<Option>PiezoSurface</Option>", "<Option>PiezoSurfaceBbar</Option>")
      .replace("<SlipSurface>", '<MaterialUsesBBarParams Len="2"><MaterialUsesBBarParam><ID>1</ID><Entry IsIncluded="true" /></MaterialUsesBBarParam><MaterialUsesBBarParam><ID>2</ID><Entry Function="1" /></MaterialUsesBBarParam></MaterialUsesBBarParams><Seismic Horizontal="0.1" Vertical="-0.05" /><SlipSurface>');
    const b = gszToDefinition({ ...parseGszXml(bb), results: new Map() }, 1);
    expect(b.definition.materials.find((m) => m.name === "Fill")!.model).toMatchObject({ bBarLoad: true });
    expect(b.definition.materials.find((m) => m.name === "Clay")!.model).toMatchObject({ bBar: 1 });
    expect(b.options).toMatchObject({ seismicHorizontal: 0.1, seismicVertical: -0.05 });
  });

  it("imports and exports a tension crack at a limiting angle", async () => {
    // The file's angle is counter-clockwise from +x: 120° for sliding to
    // the right is a base inclination of 60° (the format's own example).
    const xml = XML.replace("<SlipSurface>", "<TensionCrack><TensionOption>Angle</TensionOption><Angle>120</Angle><PctFilledWithWater>0.5</PctFilledWithWater></TensionCrack><SlipSurface>");
    const imp = gszToDefinition({ ...parseGszXml(xml), results: new Map() }, 1);
    expect(imp.options).toMatchObject({ tensionCrackAngle: 60, tensionCrackWater: 0.5 });
    expect(imp.notes.join(" ")).not.toMatch(/tension crack/);
    const model = modelFromDefinition(imp.definition, { id: "c", name: "C", options: imp.options });
    const written = modelToGszXml(model).xml;
    expect(written).toMatch(/<Angle>120<\/Angle>/);
    const [back] = await gszImports(modelToGsz(model).bytes, "C.gsz");
    expect(back.options).toMatchObject({ tensionCrackAngle: 60, tensionCrackWater: 0.5 });
    // Sliding to the left: the angle is the inclination itself.
    const rtl = gszToDefinition({ ...parseGszXml(xml.replace("LeftToRight", "RightToLeft")), results: new Map() }, 1);
    expect(rtl.options.tensionCrackAngle).toBeUndefined();
    expect(rtl.notes.join(" ")).toMatch(/tension crack angle 120°/);
    const rtl62 = gszToDefinition({ ...parseGszXml(xml.replace("LeftToRight", "RightToLeft").replace("<Angle>120", "<Angle>62")), results: new Map() }, 1);
    expect(rtl62.options.tensionCrackAngle).toBe(62);
  });

  it("exports B̄ and the fill flag with the B-bar option, and reads them back", async () => {
    const imp = gszToDefinition({ ...parseGszXml(XML), results: new Map() }, 1);
    expect(imp.definition.waterTable).toBeDefined();
    const [first, ...rest] = imp.definition.materials;
    const def = { ...imp.definition, materials: [{ ...first, model: { ...first.model!, bBar: 0.7 } }, ...rest.map((m) => ({ ...m, model: { ...m.model!, bBarLoad: true } }))] };
    const model = modelFromDefinition(def, { id: "b", name: "B", options: imp.options });
    const { xml, notes } = modelToGszXml(model);
    expect(xml).toMatch(/<Option>PiezoSurfaceBbar<\/Option>/);
    expect(xml).toMatch(/<Entry BBar="0.7" \/>/);
    expect(notes.join(" ")).toMatch(/B̄ is written as a value/);
    const [back] = await gszImports(modelToGsz(model).bytes, "B.gsz");
    expect(back.definition.materials[0].model).toMatchObject({ bBar: 0.7 });
    if (rest.length > 0) expect(back.definition.materials[1].model).toMatchObject({ bBarLoad: true });
  });

  it("reports a strength model it cannot read and keeps its parameters", () => {
    const xml = XML.replace("<SlopeModel>UndrainedPhiZero</SlopeModel>", "<SlopeModel>SHANSEP</SlopeModel>");
    const imp = gszToDefinition({ ...parseGszXml(xml), results: new Map() }, 1);
    expect(imp.notes.join(" ")).toMatch(/"Clay": the strength model "SHANSEP" has no counterpart.*Cohesion = 25/);
  });

  it("imports φb (UnsatPhiB) and the line's cap on the suction", () => {
    const xml = XML.replace("<PhiPrime>32</PhiPrime>", "<PhiPrime>32</PhiPrime><UnsatPhiB>15</UnsatPhiB>").replace(
      "<DataPoint>2</DataPoint></DataPoints></PiezometricSurface>",
      "<DataPoint>2</DataPoint></DataPoints><CapSuction>true</CapSuction><MaxSuction>50</MaxSuction></PiezometricSurface>",
    );
    const f = parseGszXml(xml);
    expect(f.stability.get(1)!.piezometricMaxSuction.get(1)).toBe(50);
    const imp = gszToDefinition({ ...f, results: new Map() }, 1);
    expect(imp.definition.materials[0].model).toMatchObject({ kind: "mohr-coulomb", phiB: 15, maxSuction: 50 });
    expect(imp.notes.join(" ")).not.toMatch(/suction/);
    // the strength from suction raises the factor of safety
    const without = gszToDefinition({ ...parseGszXml(XML), results: new Map() }, 1);
    expect(fos(imp.definition)).toBeGreaterThan(fos(without.definition));
    // a line without a cap: no maximum
    const uncapped = gszToDefinition({ ...parseGszXml(xml.replace("<CapSuction>true</CapSuction>", "<CapSuction>false</CapSuction>")), results: new Map() }, 1);
    expect(uncapped.definition.materials[0].model).toEqual({ kind: "mohr-coulomb", unitWeight: 19, cohesion: 2, frictionAngle: 32, phiB: 15 });
  });

  it("names a suction strength it does not import", () => {
    // φb on a material without a piezometric line, and suction from a function
    const xml = XML.replace("<SlopeModel>UndrainedPhiZero</SlopeModel>", "<SlopeModel>MohrCoulomb</SlopeModel>")
      .replace("<Cohesion>25</Cohesion>", "<CohesionPrime>25</CohesionPrime><PhiPrime>0</PhiPrime><UnsatPhiB>10</UnsatPhiB>")
      .replace("<StressStrain><UnitWeight>19</UnitWeight>", "<StressStrain><SlopeSuctionModel>Function</SlopeSuctionModel><UnitWeight>19</UnitWeight>");
    const imp = gszToDefinition({ ...parseGszXml(xml), results: new Map() }, 1);
    const [fill, clay] = imp.definition.materials.map((m) => m.model!);
    expect(fill).not.toHaveProperty("phiB");
    expect(clay).not.toHaveProperty("phiB");
    const notes = imp.notes.join(" ");
    expect(notes).toMatch(/"Fill": the strength from suction is given by a function/);
    expect(notes).toMatch(/"Clay": φb = 10° without a piezometric line/);
  });

  it("converts an Imperial file", () => {
    const xml = XML.replace('UnitSystem="Metric"', 'UnitSystem="Imperial"');
    const imp = gszToDefinition({ ...parseGszXml(xml), results: new Map() }, 1);
    expect(imp.definition.coordinates).toEqual(expect.arrayContaining([[30 * 0.3048, 0]]));
    expect(imp.definition.materials[1].model).toMatchObject({ unitWeight: 17 * 0.157087463, undrainedShearStrength: 25 * 0.0478802589 });
  });

  it("imports every stability analysis of a ZIP and skips the seepage one", async () => {
    const bytes = writeZip([{ name: "Section A.xml", data: XML }, { name: "Short term/001/slip_surface.csv", data: CSV }]);
    const imps = await gszImports(bytes, "Section A.gsz");
    expect(imps).toHaveLength(1);
    expect(imps[0].reference?.fos).toBe(1.4);
    await expect(readGsz(new Uint8Array([1, 2, 3]))).rejects.toThrow(/Not a \.gsz/);
  });

  it("reads a version 8 file (2012) and imports the analyses it can", async () => {
    // GeometryItems instead of Geometries, RegionUsesMaterials, SlopeItems
    // with SlipEntryExit and piezometric lines on the geometry's points,
    // no water items, SlipRadius in the results.
    const v8 = `<?xml version="1.0"?>
<GSIData Version="8.16">
  <Analyses Len="2">
    <Analysis><ID>1</ID><Name>Wet</Name><Kind>Slope stability</Kind><Method>Bishop</Method></Analysis>
    <Analysis><ID>2</ID><Name>Empty</Name><Kind>Slope stability</Kind><Method>Bishop</Method></Analysis>
  </Analyses>
  <Contexts Len="2">
    <Context><AnalysisID>1</AnalysisID><RegionUsesMaterials Len="1"><RegionUsesMaterial ID="1" UsesID="1" /></RegionUsesMaterials></Context>
    <Context><AnalysisID>2</AnalysisID></Context>
  </Contexts>
  <GeometryItems>
    <Points Len="6">
      <Point ID="1" X="0" Y="10" /><Point ID="2" X="10" Y="10" /><Point ID="3" X="20" Y="5" />
      <Point ID="4" X="30" Y="5" /><Point ID="5" X="30" Y="0" /><Point ID="6" X="0" Y="0" />
      <Point ID="7" X="0" Y="8" /><Point ID="8" X="30" Y="4" />
    </Points>
    <Regions Len="1"><Region><ID>1</ID><PointIDs>1,2,3,4,5,6</PointIDs></Region></Regions>
  </GeometryItems>
  <Materials Len="1">
    <Material><ID>1</ID><Name>Clay</Name><SlopeModel>MohrCoulomb</SlopeModel>
      <StressStrain><UnitWeight>18</UnitWeight><CohesionPrime>8</CohesionPrime><PhiPrime>25</PhiPrime></StressStrain></Material>
  </Materials>
  <SlopeItems Len="1">
    <SlopeItem><AnalysisID>1</AnalysisID><Entry>
      <SlipEntryExit>
        <LeftSideLeftPt X="1" Y="10" /><LeftSideRightPt X="9" Y="10" />
        <RightOption>Point</RightOption><RightSideLeftPt X="20" Y="5" />
      </SlipEntryExit>
      <PiezometricLines Len="1"><PiezometricLine><ID>1</ID><DataPoints Len="2"><DataPoint>7</DataPoint><DataPoint>8</DataPoint></DataPoints></PiezometricLine></PiezometricLines>
      <MaterialUsesPiezs Len="1"><MaterialUsesPiez ID="1" UsesID="1" /></MaterialUsesPiezs>
    </Entry></SlopeItem>
  </SlopeItems>
</GSIData>`;
    const csv = "SlipNum,SlipFOS,SlipCenterX,SlipCenterY,SlipRadius,SlipVolume,SlipWeight\n1,1.31,18,20,16,40,720\n";
    const imps = await gszImports(writeZip([{ name: "Old.xml", data: v8 }, { name: "Wet/001/slip_surface.csv", data: csv }]), "Old.gsz");
    expect(imps).toHaveLength(1);
    const [imp] = imps;
    expect(imp.definition.coordinates).toHaveLength(6);
    expect(imp.definition.materials.map((m) => m.name)).toEqual(["Clay"]);
    expect(imp.definition.waterTable?.value).toEqual([[0, 8], [30, 4]]);
    expect(imp.definition.analysisLimits).toEqual({ entryLeftX: 1, entryRightX: 9, exitLeftX: 20, exitRightX: 20 });
    expect(imp.options.method).toBe("Bishop");
    expect(imp.reference).toMatchObject({ fos: 1.31, cx: 18, cy: 20, r: 16 });
    // the analysis without materials is named, not a reason to fail
    expect(imp.notes.join(" ")).toMatch(/Not imported: Analysis "Empty" assigns no material/);
  });
});

describe(".gsz export", () => {
  const def: SlopeDefinition = {
    orientation: "ltr",
    coordinates: [[0, 0], [0, 10], [10, 10], [20, 5], [30, 5], [30, 0]],
    materials: [
      { name: "Fill", color: "#ff8000", model: { kind: "mohr-coulomb", unitWeight: 19, cohesion: 2, frictionAngle: 32 } },
      { name: "Clay", model: { kind: "undrained", unitWeight: 17, undrainedShearStrength: 25 } },
    ],
    materialBoundaries: [{ coordinates: [[0, 3], [30, 3]], materialName: "" }],
    regionAssignments: [{ point: [5, 6], materialName: "Fill" }, { point: [5, 1], materialName: "Clay" }],
    waterTable: { mode: "custom", value: [[0, 6], [30, 4]] },
    udls: [{ magnitude: 20, x1: 2, x2: 8 }],
    lineLoads: [{ magnitude: 40, x: 5 }],
    analysisLimits: { entryLeftX: 1, entryRightX: 9, exitLeftX: 21, exitRightX: 29 },
  } as SlopeDefinition;
  const model = modelFromDefinition(def, { id: "m", name: "Section A", options: { method: "Morgenstern-Price", intersliceFunction: "constant" } });

  it("writes the regions, materials, water, loads and search, and reads back the same slope", async () => {
    const { bytes, notes } = modelToGsz(model);
    const [imp] = await gszImports(bytes, "Section A.gsz");
    const d = imp.definition;
    expect(d.materials.map((m) => [m.name, m.model?.kind])).toEqual([["Fill", "mohr-coulomb"], ["Clay", "undrained"]]);
    expect(d.udls!.every((u) => Math.abs(u.magnitude - 20) < 1e-9)).toBe(true);
    expect(d.lineLoads).toEqual([{ magnitude: 40, x: 5 }]);
    expect(d.analysisLimits).toEqual(def.analysisLimits);
    expect(imp.options).toMatchObject({ method: "Morgenstern-Price", intersliceFunction: "constant" });
    expect(notes.join(" ")).toMatch(/surcharges/);
    // the same factor of safety
    const opts = { method: "Morgenstern-Price", intersliceFunction: "constant" };
    expect(fos(d, opts)).toBeCloseTo(fos(def, opts), 6);
  });

  it("writes the direction and point of inclined line loads, and reads back the same angle and y", async () => {
    const inclined = modelFromDefinition(
      {
        ...def,
        lineLoads: [
          { magnitude: 40, x: 5 },
          { magnitude: 30, x: 4, angle: 30 },
          { magnitude: 25, x: 0, angle: 60, y: 7.5 },
          { magnitude: 20, x: 25, angle: -45, y: 5 },
          { magnitude: 10, x: 12, angle: 120 },
        ],
      } as SlopeDefinition,
      { id: "m", name: "Section A" },
    );
    // the import into the model keeps the angle and the point
    expect(inclined.lineLoads[2]).toMatchObject({ angle: 60, y: 7.5 });
    const { xml } = modelToGszXml(inclined);
    expect(xml).toContain(`<Direction Plunge="90" Trend="0" />`);
    expect(xml).toContain(`<Direction Plunge="60" Trend="90" />`);
    expect(xml).toContain(`<Direction Plunge="45" Trend="270" />`);
    expect(xml).toContain(`<Direction Plunge="-30" Trend="90" />`);
    const [imp] = await gszImports(modelToGsz(inclined).bytes, "Section A.gsz");
    const back = imp.definition.lineLoads!;
    expect(back[0]).toEqual({ magnitude: 40, x: 5 });
    // without a point given: on the ground at x
    expect(back[1].angle).toBeCloseTo(30, 9);
    expect(back[1].y).toBeCloseTo(10, 9);
    expect(back[2].angle).toBeCloseTo(60, 9);
    expect(back[2].y).toBeCloseTo(7.5, 9);
    expect(back[3].angle).toBeCloseTo(-45, 9);
    expect(back[3].y).toBeCloseTo(5, 9);
    expect(back[4].angle).toBeCloseTo(120, 9);
    expect(back[4].x).toBeCloseTo(12, 9);
  });

  it("writes φb as UnsatPhiB and the maximum suction on the line, and reads them back", async () => {
    const withPhiB = (maxSuction?: number) => ({
      ...model,
      materials: model.materials.map((x, i) =>
        i === 0 ? { ...x, model: { ...x.model, phiB: 15, ...(maxSuction !== undefined ? { maxSuction } : {}) } as typeof x.model } : x,
      ),
    });
    const { xml } = modelToGszXml(withPhiB(50));
    const { bytes } = modelToGsz(withPhiB(50));
    expect(xml).toContain("<UnsatPhiB>15</UnsatPhiB>");
    expect(xml).toContain("<CapSuction>true</CapSuction>");
    expect(xml).toContain("<MaxSuction>50</MaxSuction>");
    const [imp] = await gszImports(bytes, "Section A.gsz");
    expect(imp.definition.materials[0].model).toMatchObject({ phiB: 15, maxSuction: 50 });
    // without a maximum: no cap on the line
    expect(modelToGszXml(withPhiB()).xml).toContain("<CapSuction>false</CapSuction>");
    expect(modelToGszXml(model).xml).not.toContain("UnsatPhiB");
  });

  it("keeps a rapid drawdown from the definition, and notes that it is not written", () => {
    const rd = modelFromDefinition(
      {
        ...def,
        materials: [
          { ...def.materials[0], model: { kind: "mohr-coulomb", unitWeight: 19, cohesion: 2, frictionAngle: 32, drawdownStrength: { cohesion: 5, frictionAngle: 18 } } },
          def.materials[1],
        ],
        rapidDrawdown: { waterBefore: [[0, 9], [30, 9]] },
      } as SlopeDefinition,
      { id: "m", name: "Section A" },
    );
    expect(rd.piezometricLine.rapidDrawdown).toEqual({ waterBefore: [[0, 9], [30, 9]] });
    expect(rd.materials[0].model).toMatchObject({ drawdownStrength: { cohesion: 5, frictionAngle: 18 } });
    expect(modelToGszXml(rd).notes.join(" ")).toMatch(/Rapid drawdown: the three-stage analysis is not written/);
    // without the analysis: only the envelopes are left out
    const plain = { ...rd, piezometricLine: { ...rd.piezometricLine, rapidDrawdown: undefined } };
    expect(modelToGszXml(plain).notes.join(" ")).toMatch(/drawdown strengths \(R envelope, cR, φR\) of the materials are not written/);
  });

  it("names what it cannot write", () => {
    const m = { ...model, materials: model.materials.map((x, i) => (i === 1 ? { ...x, model: { kind: "s-f-depth", unitWeight: 17, suRef: 10, depthRef: 0, rate: 1.5 } as const } : x)) };
    const { xml, notes } = modelToGszXml(m);
    expect(xml).toContain("<SlopeModel>UndrainedPhiZero</SlopeModel>");
    expect(notes.join(" ")).toMatch(/"Clay": strength as a function of depth is written as undrained with its reference Su \(10 kPa\)/);
  });

  it("writes a region around a lens as pieces without holes, so that no regions overlap, and reads back the same slope", async () => {
    const lens = {
      ...def,
      materials: [...def.materials, { name: "Lens", model: { kind: "mohr-coulomb", unitWeight: 20, cohesion: 0, frictionAngle: 36 } }],
      materialBoundaries: [...def.materialBoundaries!, { coordinates: [[6, 5], [9, 5], [9, 8], [6, 8], [6, 5]], materialName: "" }],
      regionAssignments: [...def.regionAssignments!, { point: [7.5, 6.5], materialName: "Lens" }],
    } as SlopeDefinition;
    const m = modelFromDefinition(lens, { id: "m", name: "Lens", options: { method: "Bishop" } });
    const { xml, notes } = modelToGszXml(m);
    expect(notes.join(" ")).not.toMatch(/hole/);
    const file = parseGszXml(xml);
    const geo = file.geometries.get(1)!;
    const area = (ids: number[]) => Math.abs(ids.reduce((s, id, i) => {
      const p = geo.points.get(id)!, q = geo.points.get(ids[(i + 1) % ids.length])!;
      return s + p[0] * q[1] - q[0] * p[1];
    }, 0)) / 2;
    const areas = [...geo.regions.entries()].map(([id, ids]) => ({ material: file.regionMaterials.get(1)!.get(id)!, area: area(ids) }));
    // the regions tile the outline (225 m²); the fill around the lens is in two pieces, the lens 9 m²
    expect(areas.reduce((s, r) => s + r.area, 0)).toBeCloseTo(225, 9);
    expect(areas.filter((r) => r.material === 1)).toHaveLength(2);
    expect(areas.filter((r) => r.material === 3).map((r) => r.area)).toEqual([expect.closeTo(9, 9)]);
    const [imp] = await gszImports(modelToGsz(m).bytes, "Lens.gsz");
    // the same slope on a circle through the lens: the same factor of safety as with the cuts
    // between the pieces of fill drawn as boundaries (the slices also break there), and within 0.1 % without
    const onCircle = (d: SlopeDefinition) => fos({ ...d, customSearchPlanes: [{ cx: 16, cy: 18, radius: 15 }], customPlanesOnly: true }, { method: "Bishop" });
    const cut = { ...lens, materialBoundaries: [...lens.materialBoundaries!, { coordinates: [[7.5, 3], [7.5, 5]], materialName: "" }, { coordinates: [[7.5, 8], [7.5, 10]], materialName: "" }] } as SlopeDefinition;
    expect(onCircle(imp.definition)).toBeCloseTo(onCircle(cut), 6);
    expect(Math.abs(onCircle(imp.definition) / onCircle(lens) - 1)).toBeLessThan(1e-3);
  });

  it("writes the seismic coefficients and reads them back", async () => {
    const quake = { ...model, options: { ...model.options, seismicHorizontal: 0.15, seismicVertical: 0.05 } };
    expect(modelToGszXml(quake).xml).toContain(`<Seismic Horizontal="0.15" Vertical="0.05" />`);
    const [imp] = await gszImports(modelToGsz(quake).bytes, "Q.gsz");
    expect(imp.options).toMatchObject({ seismicHorizontal: 0.15, seismicVertical: 0.05 });
    // none: blank, as the format's files write it
    expect(modelToGszXml(model).xml).toContain(`<Seismic Horizontal="" Vertical="" />`);
    const [dry] = await gszImports(modelToGsz(model).bytes, "Q.gsz");
    expect(dry.options.seismicHorizontal).toBeUndefined();
  });

  it("writes given circles and surfaces analysed alone as fully specified slip surfaces, and notes them when the model also searches", async () => {
    const circle = { cx: 16, cy: 18, radius: 15 };
    const onCircle = modelFromDefinition({ ...def, customSearchPlanes: [circle], customPlanesOnly: true } as SlopeDefinition, { id: "m", name: "C", options: { method: "Bishop" } });
    const { xml, notes } = modelToGszXml(onCircle);
    expect(xml).toContain("<Option>FullySpecified</Option>");
    expect(xml).toMatch(/<Axis ID="\d+" \/>/);
    expect(notes.join(" ")).toMatch(/custom circle is written as fully specified slip surfaces along the circle/);
    const [imp] = await gszImports(modelToGsz(onCircle).bytes, "C.gsz");
    expect(imp.definition.customPlanesOnly).toBe(true);
    const [surface] = imp.definition.customSurfaces!;
    expect(surface.axis).toEqual([16, 18]);
    // the points are on the circle and reach above the ground at both ends
    expect(surface.points.every(([x, y]) => Math.abs(Math.hypot(x - 16, y - 18) - 15) < 1e-9)).toBe(true);
    // a polyline in 2° steps: the factor of safety of the circle within 0.2 %
    const f0 = fos({ ...def, customSearchPlanes: [circle], customPlanesOnly: true } as SlopeDefinition, { method: "Bishop" });
    expect(Math.abs(fos(imp.definition, { method: "Bishop" }) / f0 - 1)).toBeLessThan(2e-3);
    // a surface: its points, no axis
    const pts: [number, number][] = [[4, 10], [12, 4], [22, 3.5], [27, 5]];
    const onSurface = modelFromDefinition({ ...def, customSurfaces: [{ points: pts }], customPlanesOnly: true } as SlopeDefinition, { id: "m", name: "S" });
    const [back] = await gszImports(modelToGsz(onSurface).bytes, "S.gsz");
    expect(back.definition.customSurfaces).toEqual([{ points: pts }]);
    // with the search as well: not written, with a note
    const both = modelFromDefinition({ ...def, customSearchPlanes: [circle], customPlanesOnly: false } as SlopeDefinition, { id: "m", name: "B" });
    const out = modelToGszXml(both);
    expect(out.xml).not.toContain("FullySpecified");
    expect(out.notes.join(" ")).toMatch(/custom slip surfaces are not written/);
  });

  it("writes SHANSEP with its ratio, exponent and OCR (a function of elevation), and reads it back with the same factor of safety", async () => {
    const withClay = (clay: object) => {
      const d = { ...def, materials: [def.materials[0], { name: "Clay", model: { kind: "shansep", unitWeight: 17, ...clay } }] } as SlopeDefinition;
      return { d, m: modelFromDefinition(d, { id: "m", name: "Shansep", options: { method: "Bishop" } }) };
    };
    const back = async (clay: object) => {
      const { d, m } = withClay(clay);
      const { xml, notes } = modelToGszXml(m);
      const [imp] = await gszImports(modelToGsz(m).bytes, "S.gsz");
      return { d, xml, notes, imp, model: imp.definition.materials[1].model };
    };
    // OCR 1: Su/σ′v constant
    const one = await back({ ratio: 0.25, exponent: 0.8 });
    expect(one.xml).toContain("<SlopeModel>SHANSEP</SlopeModel>");
    expect(one.xml).toContain("<TauSigmaRatio>0.25</TauSigmaRatio>");
    expect(one.xml).not.toContain("SlopeUndrainedStrengthModel");
    expect(one.model).toMatchObject({ kind: "shansep", unitWeight: 17, ratio: 0.25, ocr: 1 });
    expect(fos(one.imp.definition, { method: "Bishop" })).toBeCloseTo(fos(one.d, { method: "Bishop" }), 6);
    // a constant OCR: a flat function of elevation
    const two = await back({ ratio: 0.25, exponent: 0.8, ocr: 2 });
    expect(two.xml).toContain("<SlopeUndrainedStrengthModel>Custom</SlopeUndrainedStrengthModel>");
    expect(two.xml).toContain("<NCUndrainedStrengthRatio>0.25</NCUndrainedStrengthRatio>");
    expect(two.xml).toContain("<SHANSEPExponent>0.8</SHANSEPExponent>");
    expect(two.xml).toMatch(/<Functions>\s*<Material>\s*<Fn2Ds Len="1">\s*<Fn2D>\s*<ID>1<\/ID>/);
    expect(two.xml).toContain("<Function>Linear(OutputParam=OverconsolidationRatio,InputParam=Y,SlopeBefore=0,SlopeAfter=0)</Function>");
    expect(two.model).toMatchObject({ kind: "shansep", ratio: 0.25, exponent: 0.8, ocrByElevation: [[0, 2], [10, 2]] });
    expect(fos(two.imp.definition, { method: "Bishop" })).toBeCloseTo(fos(two.d, { method: "Bishop" }), 6);
    // OCR against elevation, with a spline
    const byY = await back({ ratio: 0.3, exponent: 0.85, ocrByElevation: [[0, 3], [2, 1.5], [3, 1]], spline: { startSlope: 0, endSlope: 0 } });
    expect(byY.xml).toContain("<Function>Spline(OutputParam=OverconsolidationRatio,InputParam=Y,Smooth=100,Tension=100,SlopeBefore=0,SlopeAfter=0,LogInput=false,LogOutput=false)</Function>");
    expect(byY.model).toMatchObject({ ratio: 0.3, exponent: 0.85, ocrByElevation: [[0, 3], [2, 1.5], [3, 1]], spline: { startSlope: 0, endSlope: 0 } });
    expect(fos(byY.imp.definition, { method: "Bishop" })).toBeCloseTo(fos(byY.d, { method: "Bishop" }), 6);
    // Su as a function of σ′v
    const su = await back({ ratio: 0.25, suByStress: [[0, 5], [50, 15], [100, 28]] });
    expect(su.xml).toContain("<SlopeUndrainedStrengthModel>Function</SlopeUndrainedStrengthModel>");
    expect(su.model).toMatchObject({ suByStress: [[0, 5], [50, 15], [100, 28]] });
    expect(fos(su.imp.definition, { method: "Bishop" })).toBeCloseTo(fos(su.d, { method: "Bishop" }), 6);
    // POP: not written, with a note
    const pop = await back({ ratio: 0.25, pop: 20 });
    expect(pop.notes.join(" ")).toMatch(/"Clay": the POP of its SHANSEP strength is not written/);
    expect(pop.model).toMatchObject({ ratio: 0.25, ocr: 1 });
  });

  it("writes what the format's files leave out only when it differs from their default, in their order", async () => {
    const parse = (xml: string) => new DOMParser().parseFromString(xml, "application/xml");
    const { xml } = modelToGszXml(model);
    // the entry and exit search and sliding to the right are not written
    expect(xml).not.toContain("<Option>EntryExit</Option>");
    expect(xml).not.toContain("DirectionOfSlip");
    // a vertical surcharge has no direction
    expect(xml).not.toMatch(/<Surcharge>[\s\S]*<Direction>/);
    const doc = parse(xml);
    const tags = (el: Element | null | undefined) => Array.from(el?.children ?? []).map((c) => c.tagName);
    expect(tags(doc.querySelector("Material"))).toEqual(["ID", "Color", "Name", "SlopeModel", "StressStrain"]);
    expect(tags(doc.querySelector("StabilityItem > Entry"))).toEqual(["DataPoints", "SlipSurface", "LineLoadPoints", "Surcharges", "Seismic", "PiezometricSurfaces", "MaterialUsesPiezs"]);
    expect(tags(doc.querySelector("Surcharge"))).toEqual(["ID", "DataPoints", "Pressure"]);
    // read back: the search, sliding to the right
    const [imp] = await gszImports(modelToGsz(model).bytes, "A.gsz");
    expect(imp.definition.analysisLimits).toEqual(def.analysisLimits);
    expect(imp.definition.orientation ?? "ltr").toBe("ltr");
    // sliding to the left is written, and read back
    const rtl = modelFromDefinition({ ...def, orientation: "rtl", coordinates: def.coordinates.map(([x, y]) => [30 - x, y] as [number, number]).reverse(), analysisLimits: undefined } as SlopeDefinition, { id: "m", name: "L" });
    expect(modelToGszXml(rtl).xml).toContain("<DirectionOfSlip>RightToLeft</DirectionOfSlip>");
    const [left] = await gszImports(modelToGsz(rtl).bytes, "L.gsz");
    expect(left.definition.orientation).toBe("rtl");
    // dry: no pore pressure option and no empty lists
    const dry = modelFromDefinition({ ...def, waterTable: undefined, udls: [], lineLoads: [] } as SlopeDefinition, { id: "m", name: "D" });
    const dryXml = modelToGszXml(dry).xml;
    expect(dryXml).not.toContain("ResultInputInfo");
    expect(tags(parse(dryXml).querySelector("StabilityItem > Entry"))).toEqual(["SlipSurface", "Seismic"]);
    const [d] = await gszImports(modelToGsz(dry).bytes, "D.gsz");
    expect(d.definition.waterTable).toBeUndefined();
  });

  it("notes that the direction convention of an inclined line load is unverified", () => {
    const inclined = { ...model, lineLoads: [{ ...model.lineLoads[0], angle: 30 }] };
    expect(modelToGszXml(inclined).notes.join(" ")).toMatch(/direction convention of the format is unverified/);
    expect(modelToGszXml(model).notes.join(" ")).not.toMatch(/unverified/);
  });
});
