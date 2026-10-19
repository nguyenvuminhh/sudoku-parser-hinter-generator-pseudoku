import { describe, expect, it } from "vitest";
import { singleInkCluster, predictionFromScores } from "./ocr-processing";

function ink(rectangles: number[][]) {
  const binary = new Uint8Array(10000);
  for (const [x, y, w, h] of rectangles) {
    for (let row = y; row < y + h; row++) binary.fill(255, row * 100 + x, row * 100 + x + w);
  }
  return binary;
}

describe("OCR cell eligibility", () => {
  it("ignores empty cells and single small pencil notes", () => {
    expect(singleInkCluster(ink([]), 100, 100, 100)).toBeNull();
    expect(singleInkCluster(ink([[20, 20, 10, 20]]), 100, 100, 100)).toBeNull();
  });
  it("accepts tall narrow digits by their longest dimension", () => {
    expect(singleInkCluster(ink([[20, 20, 5, 50]]), 100, 100, 100)).toEqual({ x: 20, y: 20, width: 5, height: 50 });
  });
  it("accepts smaller full-size fonts starting at 40% of the original cell width", () => {
    expect(singleInkCluster(ink([[30, 25, 30, 40]]), 100, 100, 100)).toEqual({ x: 30, y: 25, width: 30, height: 40 });
    expect(singleInkCluster(ink([[30, 25, 30, 39]]), 100, 100, 100)).toBeNull();
  });
  it("requires both cluster sides to be strictly below 90% of the sampled cell width", () => {
    expect(singleInkCluster(ink([[5, 5, 5, 89]]), 100, 100, 100)).not.toBeNull();
    expect(singleInkCluster(ink([[5, 5, 5, 90]]), 100, 100, 100)).toBeNull();
    expect(singleInkCluster(ink([[5, 5, 90, 5]]), 100, 100, 100)).toBeNull();
  });
  it("rejects borders spanning the inset crop even when shorter than the original cell", () => {
    const vertical = new Uint8Array(42 * 42);
    for (let y = 0; y < 42; y++) vertical[y * 42] = 255;
    expect(singleInkCluster(vertical, 42, 42, 50)).toBeNull();
    const horizontal = new Uint8Array(42 * 42);
    horizontal.fill(255, 0, 42);
    expect(singleInkCluster(horizontal, 42, 42, 50)).toBeNull();
  });
  it("merges at 7% of original cell width, but rejects components beyond it", () => {
    expect(singleInkCluster(ink([[5, 20, 25, 40], [36, 20, 29, 40]]), 100, 100, 100)).not.toBeNull();
    expect(singleInkCluster(ink([[5, 20, 25, 40], [37, 20, 28, 40]]), 100, 100, 100)).toBeNull();
  });
  it("merges transitively and measures Euclidean distance", () => {
    expect(singleInkCluster(ink([[10, 20, 15, 60], [31, 20, 15, 60], [52, 20, 15, 60]]), 100, 100, 100)).not.toBeNull();
    expect(singleInkCluster(ink([[5, 5, 35, 35], [44, 44, 41, 41]]), 100, 100, 100)).toBeNull();
  });
  it("does not discard separate small notes beside a large digit", () => {
    expect(singleInkCluster(ink([[30, 25, 50, 55], [5, 5, 5, 5]]), 100, 100, 100)).toBeNull();
  });
});

describe("MNIST scores", () => {
  it("supports logits and treats label zero as blank", () => {
    expect(predictionFromScores([10, 0, 0, 0, 0, 0, 0, 0, 0, 0], false).value).toBeNull();
    expect(predictionFromScores([0, 0, 0, 0, 0, 0, 0, 10, 0, 0], false).value).toBe(7);
  });
  it("preserves the existing enclosed-loop correction for a five predicted as six", () => {
    expect(predictionFromScores([.01, .01, .01, .01, .01, .86, .06, .01, .01, .01], true).value).toBe(6);
  });
});
