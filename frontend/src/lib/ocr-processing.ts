import type * as OpenCV from "@techstark/opencv-js";

export type Cv = typeof OpenCV;
export const COMPONENT_MERGE_DISTANCE_RATIO = 0.07;
export type Bounds = { x: number; y: number; width: number; height: number };
export type ExtractedDigit = { row: number; col: number; image: Uint8Array | null; hasLoop: boolean };

/** Union ink pixels within the merge radius; preserve 8-connected strokes. */
export function singleInkCluster(binary: Uint8Array, width: number, height: number, cellWidth: number): Bounds | null {
  const parents = new Int32Array(binary.length).fill(-1);
  const root = (index: number): number => {
    while (parents[index] !== index) {
      parents[index] = parents[parents[index]];
      index = parents[index];
    }
    return index;
  };
  const radius = cellWidth * COMPONENT_MERGE_DISTANCE_RATIO;
  const reach = Math.max(1, Math.floor(radius));
  const offsets: Array<[number, number]> = [];
  for (let dy = 0; dy <= reach; dy++) {
    for (let dx = -reach; dx <= reach; dx++) {
      if (dy === 0 && dx >= 0) continue;
      if (dx * dx + dy * dy <= radius * radius || (Math.abs(dx) <= 1 && dy <= 1)) offsets.push([dx, -dy]);
    }
  }
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = y * width + x;
      if (!binary[index]) continue;
      parents[index] = index;
      minX = Math.min(minX, x); minY = Math.min(minY, y);
      maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
      for (const [dx, dy] of offsets) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || nx >= width || ny < 0) continue;
        const neighbor = ny * width + nx;
        if (parents[neighbor] !== -1) parents[root(index)] = root(neighbor);
      }
    }
  }
  if (maxX < 0 || Math.max(maxX - minX + 1, maxY - minY + 1) < cellWidth * 0.5) return null;
  const first = root(minY * width + binary.subarray(minY * width, (minY + 1) * width).findIndex(value => value !== 0));
  for (let index = 0; index < binary.length; index++) {
    if (parents[index] !== -1 && root(index) !== first) return null;
  }
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

/** Every OpenCV allocation belongs to a scope, including failure paths. */
function scope<T>(work: (own: <R extends { delete(): void }>(resource: R) => R) => T): T {
  const resources: Array<{ delete(): void }> = [];
  try { return work(resource => { resources.push(resource); return resource; }); }
  finally { resources.reverse().forEach(resource => resource.delete()); }
}

export function prepareCellInk(cv: Cv, gray: OpenCV.Mat): OpenCV.Mat {
  const binary = new cv.Mat();
  try {
    cv.threshold(gray, binary, 0, 255, cv.THRESH_BINARY | cv.THRESH_OTSU);
    if (cv.countNonZero(binary) > binary.rows * binary.cols / 2) cv.bitwise_not(binary, binary);
    return binary;
  } catch (error) { binary.delete(); throw error; }
}

export function normalizeDigit(cv: Cv, gray: OpenCV.Mat, cellWidth: number): { image: Uint8Array | null; hasLoop: boolean } {
  return scope(own => {
    const binary = own(prepareCellInk(cv, gray));
    const bounds = singleInkCluster(binary.data, binary.cols, binary.rows, cellWidth);
    if (!bounds) return { image: null, hasLoop: false };
    const digit = own(binary.roi(new cv.Rect(bounds.x, bounds.y, bounds.width, bounds.height)));
    const scale = Math.min(20 / bounds.width, 20 / bounds.height);
    const resized = own(new cv.Mat());
    cv.resize(digit, resized, new cv.Size(Math.max(1, Math.floor(bounds.width * scale)), Math.max(1, Math.floor(bounds.height * scale))), 0, 0, cv.INTER_AREA);
    const normalized = own(cv.Mat.zeros(28, 28, cv.CV_8UC1));
    const target = own(normalized.roi(new cv.Rect(Math.floor((28 - resized.cols) / 2), Math.floor((28 - resized.rows) / 2), resized.cols, resized.rows)));
    resized.copyTo(target);
    const loopMask = own(new cv.Mat());
    cv.threshold(normalized, loopMask, 0, 255, cv.THRESH_BINARY | cv.THRESH_OTSU);
    const contours = own(new cv.MatVector()), hierarchy = own(new cv.Mat());
    cv.findContours(loopMask, contours, hierarchy, cv.RETR_CCOMP, cv.CHAIN_APPROX_SIMPLE);
    let hasLoop = false;
    for (let index = 0; index < contours.size(); index++) {
      if (hierarchy.data32S[index * 4 + 3] === -1) continue;
      const contour = own(contours.get(index));
      const box = cv.boundingRect(contour);
      if (cv.contourArea(contour) >= 4 && box.width >= 2 && box.height >= 2) hasLoop = true;
    }
    return { image: new Uint8Array(normalized.data), hasLoop };
  });
}

/** Detect and warp the grid before splitting it into 81 centered cell images. */
export function extractDigits(cv: Cv, frame: ImageData): ExtractedDigit[] {
  return scope(own => {
    const source = own(cv.matFromImageData(frame)), gray = own(new cv.Mat());
    cv.cvtColor(source, gray, cv.COLOR_RGBA2GRAY);
    const blurred = own(new cv.Mat()), threshold = own(new cv.Mat());
    cv.GaussianBlur(gray, blurred, new cv.Size(7, 7), 0);
    cv.adaptiveThreshold(blurred, threshold, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY_INV, 11, 2);
    const contours = own(new cv.MatVector()), hierarchy = own(new cv.Mat());
    cv.findContours(threshold, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
    const ranked = Array.from({ length: contours.size() }, (_, index) => {
      const contour = own(contours.get(index));
      return { contour, area: cv.contourArea(contour) };
    }).sort((a, b) => b.area - a.area);
    let outline: Array<[number, number]> | null = null;
    for (const { contour, area } of ranked.slice(0, 12)) {
      const approx = own(new cv.Mat());
      cv.approxPolyDP(contour, approx, 0.02 * cv.arcLength(contour, true), true);
      if (approx.rows !== 4 || area <= gray.rows * gray.cols * 0.15) continue;
      outline = Array.from({ length: 4 }, (_, index) => [approx.data32S[index * 2], approx.data32S[index * 2 + 1]]);
      break;
    }
    if (!outline) throw new Error("Could not find a Sudoku grid. Use a crop with the full outer border visible.");
    const sorted = (score: (point: [number, number]) => number) => [...outline!].sort((a, b) => score(a) - score(b));
    const sums = sorted(([x, y]) => x + y), diffs = sorted(([x, y]) => y - x);
    const points = own(cv.matFromArray(4, 1, cv.CV_32FC2, [sums[0], diffs[0], sums[3], diffs[3]].flat()));
    const target = own(cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, 449, 0, 449, 449, 0, 449]));
    const transform = own(cv.getPerspectiveTransform(points, target)), warped = own(new cv.Mat());
    cv.warpPerspective(gray, warped, transform, new cv.Size(450, 450));
    const cells: ExtractedDigit[] = [];
    for (let row = 0; row < 9; row++) for (let col = 0; col < 9; col++) {
      const digit = scope(ownCell => {
        const center = ownCell(warped.roi(new cv.Rect(col * 50 + 4, row * 50 + 4, 42, 42)));
        return normalizeDigit(cv, center, 50);
      });
      cells.push({ row: row + 1, col: col + 1, ...digit });
    }
    return cells;
  });
}

export function predictionFromScores(scores: ArrayLike<number>, hasLoop: boolean): { value: number | null; confidence: number } {
  let probabilities = Array.from(scores);
  const sum = probabilities.reduce((total, value) => total + value, 0);
  if (probabilities.length !== 10 || probabilities.some(value => value < 0) || sum < .98 || sum > 1.02) {
    const max = Math.max(...probabilities);
    const exps = probabilities.map(value => Math.exp(value - max));
    const total = exps.reduce((a, b) => a + b, 0);
    probabilities = exps.map(value => value / total);
  }
  const label = probabilities.indexOf(Math.max(...probabilities));
  if (label === 5 && hasLoop) return { value: 6, confidence: Math.max(probabilities[6], Math.min(probabilities[5], .86)) };
  return { value: label === 0 ? null : label, confidence: probabilities[label] };
}
