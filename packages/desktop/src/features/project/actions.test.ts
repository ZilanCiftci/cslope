import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  ensureJsonName,
  stripJsonExt,
  triggerBrowserDownload,
  buildProjectJson,
} from "./actions";
import type { AppState } from "../../store/types";

// ── ensureJsonName ──────────────────────────────────────────────────

describe("ensureJsonName", () => {
  it("appends .json when extension is missing", () => {
    expect(ensureJsonName("my-project")).toBe("my-project.json");
  });

  it("returns the name unchanged when it already ends in .json", () => {
    expect(ensureJsonName("my-project.json")).toBe("my-project.json");
  });

  it("is case-insensitive", () => {
    expect(ensureJsonName("foo.JSON")).toBe("foo.JSON");
    expect(ensureJsonName("bar.Json")).toBe("bar.Json");
  });

  it("handles empty string", () => {
    expect(ensureJsonName("")).toBe(".json");
  });
});

// ── stripJsonExt ────────────────────────────────────────────────────

describe("stripJsonExt", () => {
  it("removes .json extension", () => {
    expect(stripJsonExt("project.json")).toBe("project");
  });

  it("is case-insensitive", () => {
    expect(stripJsonExt("project.JSON")).toBe("project");
    expect(stripJsonExt("project.Json")).toBe("project");
  });

  it("returns the name unchanged when there is no .json extension", () => {
    expect(stripJsonExt("project")).toBe("project");
    expect(stripJsonExt("project.txt")).toBe("project.txt");
  });

  it("handles empty string", () => {
    expect(stripJsonExt("")).toBe("");
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
    triggerBrowserDownload('{"hello":"world"}', "test.json");

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

    expect(parsed.version).toBe(1);
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
