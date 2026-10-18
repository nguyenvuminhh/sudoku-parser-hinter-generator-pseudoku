import { afterEach, describe, expect, it, vi } from "vitest";
import { requestGeneratedPuzzle } from "./puzzle-services";

describe("static puzzle selection", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("selects from the requested rated bucket without calling an API", async () => {
    const record = ["0".repeat(81), "1".repeat(81), 8.4, "Region Forcing Chains"];
    const fetchMock = vi.fn(async (url: string) => new Response(JSON.stringify(
      url.endsWith("manifest.json")
        ? { levels: { advanced_8_plus: { count: 1, chunkSize: 256, name: "Advanced 8+" } } }
        : [record]
    )));
    vi.stubGlobal("fetch", fetchMock);
    const result = await requestGeneratedPuzzle("advanced_8_plus");
    expect(result.level.id).toBe("advanced_8_plus");
    expect(result.se_rating).toBe(8.4);
    expect(result.techniques).toEqual(["Region Forcing Chains"]);
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "/puzzles/manifest.json", "/puzzles/advanced_8_plus/0.json"
    ]);
  });
  it("reports unavailable static files", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("missing", { status: 404 })));
    await expect(requestGeneratedPuzzle("easy")).rejects.toThrow(/puzzle collection/i);
  });
  it("rejects unknown levels before requesting files", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(requestGeneratedPuzzle("../private")).rejects.toThrow(/difficulty/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
