import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  ensureCslpName,
  stripProjectExt,
  triggerBrowserDownload,
  buildProjectJson,
} from "./actions";
import type { AppState } from "../../store/types";
import { PROJECT_FILE_VERSION } from "../../store/persistence";

// ── ensureCslpName ──────────────────────────────────────────────────

describe("ensureCslpName", () => {
  it("appends .cslp when the extension is missing", () => {
    expect(ensureCslpName("my-project")).toBe("my-project.cslp");
  });

  it("gives .cslp exactly once, replacing the project extensions of earlier versions", () => {
    expect(ensureCslpName("my-project.cslp")).toBe("my-project.cslp");
    expect(ensureCslpName("test.cslope")).toBe("test.cslp");
    expect(ensureCslpName("test.cslope.cslp")).toBe("test.cslp");
    expect(ensureCslpName("test.cslp.cslp")).toBe("test.cslp");
    expect(ensureCslpName("test.json")).toBe("test.cslp");
    expect(ensureCslpName("test.cslope.json")).toBe("test.cslp");
  });

  it("is case-insensitive", () => {
    expect(ensureCslpName("foo.CSLP")).toBe("foo.cslp");
    expect(ensureCslpName("bar.Json")).toBe("bar.cslp");
  });

  it("keeps other dots as part of the name", () => {
    expect(ensureCslpName("Slope 1.5 m")).toBe("Slope 1.5 m.cslp");
    expect(ensureCslpName("notes.txt")).toBe("notes.txt.cslp");
  });

  it("names an empty name cslope-project", () => {
    expect(ensureCslpName("")).toBe("cslope-project.cslp");
    expect(ensureCslpName("  .cslp ")).toBe("cslope-project.cslp");
  });
});

// ── stripProjectExt ─────────────────────────────────────────────────

describe("stripProjectExt", () => {
  it("removes the .cslp, .json and .cslope extensions", () => {
    expect(stripProjectExt("project.cslp")).toBe("project");
    expect(stripProjectExt("project.json")).toBe("project");
    expect(stripProjectExt("project.cslope")).toBe("project");
  });

  it("is case-insensitive", () => {
    expect(stripProjectExt("project.CSLP")).toBe("project");
    expect(stripProjectExt("project.Json")).toBe("project");
  });

  it("returns the name unchanged when there is no project extension", () => {
    expect(stripProjectExt("project")).toBe("project");
    expect(stripProjectExt("project.txt")).toBe("project.txt");
  });

  it("handles empty string", () => {
    expect(stripProjectExt("")).toBe("");
  });
});

// ── triggerBrowserDownload ──────────────────────────────────────────

describe("triggerBrowserDownload", () => {
  let clickSpy: ReturnType<typeof vi.fn>;
  let revokeObjectURLSpy: ReturnType<typeof vi.fn>;
  let createObjectURLSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    clickSpy = vi.fn();
    vi.spyOn(document, "createElement").mockReturnValue({
      set href(_v: string) {
        /* noop */
      },
      set download(_v: string) {
        /* noop */
      },
      click: clickSpy,
    } as unknown as HTMLAnchorElement);

    createObjectURLSpy = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValue("blob:fake");
    revokeObjectURLSpy = vi.spyOn(URL, "revokeObjectURL").mockReturnValue();
  });

  it("creates a blob URL and clicks the anchor", () => {
    triggerBrowserDownload(new Uint8Array([0x50, 0x4b, 3, 4]), "test.cslp");

    expect(createObjectURLSpy).toHaveBeenCalledOnce();
    expect(clickSpy).toHaveBeenCalledOnce();
    expect(revokeObjectURLSpy).toHaveBeenCalledWith("blob:fake");
  });
});

// ── buildProjectJson ────────────────────────────────────────────────

describe("buildProjectJson", () => {
  it("returns pretty-printed JSON with version, activeModelId, and models", () => {
    const fakeState = {
      activeModelId: "m1",
      models: [{ id: "m1", name: "Test Model" }],
    } as unknown as AppState;

    const json = buildProjectJson(fakeState);
    const parsed = JSON.parse(json);

    expect(parsed.version).toBe(PROJECT_FILE_VERSION);
    expect(parsed.activeModelId).toBe("m1");
    expect(parsed.models).toHaveLength(1);
  });

  it("produces indented output", () => {
    const fakeState = {
      activeModelId: "m1",
      models: [{ id: "m1", name: "Test" }],
    } as unknown as AppState;

    const json = buildProjectJson(fakeState);
    // Pretty-printed JSON contains newlines and indentation
    expect(json).toContain("\n");
    expect(json).toContain("  ");
  });
});
