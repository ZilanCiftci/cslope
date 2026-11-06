import { describe, expect, it } from "vitest";
import { DEFAULT_ANALYSIS_OPTIONS, publicDefaultOptions } from "@cslope/engine";
import { APP_DEFAULT_ANALYSIS_OPTIONS } from "./defaults";

// D-23: Python's cslope.analyse and the command line take the app's options
// for a new model, which the engine holds as public_default_options (a
// patch over its own defaults). They must not drift apart.
describe("the engine's public default options", () => {
  it("are the app's options for a new model", () => {
    expect({ ...DEFAULT_ANALYSIS_OPTIONS, ...publicDefaultOptions() }).toEqual(APP_DEFAULT_ANALYSIS_OPTIONS);
  });
});
