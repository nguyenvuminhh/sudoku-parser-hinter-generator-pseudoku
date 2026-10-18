import type { OcrResponse } from "./api";
import { assetUrl } from "./static-assets";
import { parsePuzzleText, validateSudokuGrid, type OcrCell } from "./sudoku-state";

type Pending = { resolve: (cells: OcrCell[]) => void; reject: (error: Error) => void; timeout: ReturnType<typeof setTimeout> };
let worker: Worker | null = null;
let nextId = 0;
const pending = new Map<number, Pending>();

function fail(error: Error) {
  worker?.terminate(); worker = null;
  for (const request of pending.values()) { clearTimeout(request.timeout); request.reject(error); }
  pending.clear();
}

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(assetUrl("ocr/ocr-worker.js"));
    worker.onmessage = ({ data }: MessageEvent<{ id: number; cells?: OcrCell[]; error?: string }>) => {
      const request = pending.get(data.id);
      if (!request) return;
      clearTimeout(request.timeout); pending.delete(data.id);
      if (data.error || !data.cells) {
        request.reject(new Error(data.error || "Image recognition failed."));
        // Reset a possibly failed runtime so a subsequent import can retry.
        fail(new Error("Image recognition was interrupted. Please try again."));
      } else request.resolve(data.cells);
    };
    worker.onerror = () => fail(new Error("Image recognition could not start. Reload and try again."));
  }
  return worker;
}

export async function recognizeImageLocally(file: File): Promise<OcrResponse> {
  if (typeof Worker === "undefined") throw new Error("This browser does not support image import. Enter the puzzle manually.");
  const activeWorker = getWorker();
  const id = nextId++;
  const cells = await new Promise<OcrCell[]>((resolve, reject) => {
    const timeout = setTimeout(() => fail(new Error("Image recognition timed out. Try a smaller crop.")), 120_000);
    pending.set(id, { resolve, reject, timeout });
    try { activeWorker.postMessage({ type: "recognize", id, file }); }
    catch (error) { fail(error instanceof Error ? error : new Error("Could not read this image.")); }
  });
  const validation = validateSudokuGrid(parsePuzzleText(cells.map(cell => cell.value ?? 0).join("")));
  const warnings = validation.valid ? [] : ["Classified digits contain Sudoku conflicts. Fix highlighted cells before asking for a hint."];
  warnings.push(cells.some(cell => cell.value !== null)
    ? "Image read on your device. Review the classified digits before asking for a hint."
    : "Grid was detected, but no digits were classified. Review the correction grid manually.");
  return { cells, warnings };
}
