import { describe, expect, it } from "vitest";
import type { AnalysisMethod } from "../types/analysis";
import { analyseSlope } from "./solvers";
import { toCanonicalSlopeDefinition } from "./canonical";
import { buildSlope } from "./build-slope";
import type { SlopeDefinition } from "../types/slope-definition";

function makeDefinition(opts: {
  orientation: "ltr" | "rtl";
  withLimits: boolean;
  withWater: boolean;
  withLayers: boolean;
}): SlopeDefinition {
  const coordinates: [number, number][] =
    opts.orientation === "rtl"
      ? [
          [0, -15],
          [0, -10],
          [10, -10],
          [30, 0],
          [50, 0],
          [50, -15],
        ]
      : [
          [0, -15],
          [0, 0],
          [20, 0],
          [40, -10],
          [50, -10],
          [50, -15],
        ];

  const def: SlopeDefinition = {
    orientation: opts.orientation,
    coordinates,
    materials: opts.withLayers
      ? [
          {
            name: "Soil A",
            unitWeight: 20,
            frictionAngle: 30,
            cohesion: 5,
          },
          {
            name: "Soil B",
            unitWeight: 19,
            frictionAngle: 22,
            cohesion: 7,
          },
        ]
      : [
          {
            name: "Soil",
            unitWeight: 20,
            frictionAngle: 30,
            cohesion: 5,
          },
        ],
  };

  if (opts.withLayers) {
    def.materialBoundaries = [
      {
        coordinates: [
          [0, -8],
          [25, -8],
          [50, -12],
        ],
        materialName: "Soil B",
      },
    ];
    def.topRegionMaterialName = "Soil A";
  }

  if (opts.withWater) {
    def.waterTable = {
      mode: "custom",
      value: [
        [0, -2],
        [25, -4],
        [50, -7],
      ],
      followBoundary: false,
    };
  }

  if (opts.withLimits) {
    def.analysisLimits = {
      ...(opts.orientation === "rtl"
        ? {
            entryLeftX: 34,
            entryRightX: 45,
            exitLeftX: 15,
            exitRightX: 23,
          }
        : {
            entryLeftX: 15,
            entryRightX: 23,
            exitLeftX: 34,
            exitRightX: 45,
          }),
    };
  }

  return def;
}

describe("Orientation matrix", () => {
  const methods: AnalysisMethod[] = ["Bishop", "Janbu", "Morgenstern-Price"];
  const bools = [false, true] as const;

  for (const method of methods) {
    for (const orientation of ["ltr", "rtl"] as const) {
      for (const withLimits of bools) {
        for (const withWater of bools) {
          for (const withLayers of bools) {
            it(`${method} ${orientation} limits:${withLimits} water:${withWater} layers:${withLayers}`, () => {
              const definition = makeDefinition({
                orientation,
                withLimits,
                withWater,
                withLayers,
              });

              const canonical = toCanonicalSlopeDefinition(definition);
              const slope = buildSlope(canonical);
              slope.updateAnalysisOptions({
                method,
                slices: 24,
                iterations: 320,
              });

              const fos = analyseSlope(slope);

              expect(fos).not.toBeNull();
              expect(Number.isFinite(fos!)).toBe(true);
              expect(Math.abs(fos!)).toBeLessThan(100);
              expect(slope.search.length).toBeGreaterThan(0);
            }, 20_000);
          }
        }
      }
    }
  }
});
