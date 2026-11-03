// @vitest-environment jsdom
// The importer fuzz corpus as geometry fixtures: runs the app's importer
// robustness tests (packages/desktop/src/features/project/
// import-robustness.test.ts, seeded mutations of real project files) with
// Slope.setMaterialBoundaries recorded, and writes every distinct region
// split they make, with the TypeScript (jsts) result, to
// fixtures/geometry/import_corpus.json.
//
//   cd packages/engine && bunx vitest run --config vitest.fixtures.config.ts geometry
//
// Unlike the other exporters this file holds the imported tests (they run
// here, under Node) and writes the fixture after them.
import { Slope } from "../../../engine/src/model/slope";
import { polygonizeRegionsDetailed } from "../../../engine/src/model/geometry-ops";
import { writeFixture } from "./write";

type Pt = [number, number];
const seen = new Set<string>();
const corpus: { name: string; px: number[]; py: number[]; lines: Pt[][]; output: unknown }[] = [];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const proto = Slope.prototype as any;
const original = proto.setMaterialBoundaries;
proto.setMaterialBoundaries = function (lines: Pt[][]) {
  const px: number[] = [...this._externalBoundaryPx];
  const py: number[] = [...this._externalBoundaryPy];
  const key = JSON.stringify([px, py, lines]);
  if (!seen.has(key)) {
    seen.add(key);
    let output: unknown;
    try {
      output = polygonizeRegionsDetailed(px, py, lines);
    } catch (e) {
      output = { error: String(e) };
    }
    corpus.push({ name: `import ${corpus.length}`, px, py, lines: lines.map((l) => l.map((p) => [p[0], p[1]] as Pt)), output });
  }
  return original.call(this, lines);
};

await import("../../../desktop/src/features/project/import-robustness.test");

afterAll(() => {
  writeFixture("geometry", "import_corpus", corpus.filter((c) => !("error" in (c.output as object))));
  console.log(`import corpus: ${corpus.length} distinct region splits`);
});
