import type { OcrResponse } from "./puzzle-services";
import { assetUrl } from "./static-assets";
import { parsePuzzleText, validateSudokuGrid, type OcrCell } from "./sudoku-state";
import type { Bounds } from "./ocr-processing";

type WorkerResponse = { id: number; cells?: OcrCell[]; bounds?: Bounds | null; error?: string };
type Pending = { resolve: (response: WorkerResponse) => void; reject: (error: Error) => void; timeout: ReturnType<typeof setTimeout> };
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
    worker.onmessage = ({ data }: MessageEvent<WorkerResponse>) => {
      const request = pending.get(data.id);
      if (!request) return;
      clearTimeout(request.timeout); pending.delete(data.id);
      if (data.error) {
        request.reject(new Error(data.error || "Image recognition failed."));
        // Reset a possibly failed runtime so a subsequent import can retry.
        fail(new Error("Image recognition was interrupted. Please try again."));
      } else request.resolve(data);
    };
    worker.onerror = () => fail(new Error("Image recognition could not start. Reload and try again."));
  }
  return worker;
}

async function requestImage(file: File, type: "detect" | "recognize", alreadyCropped = false): Promise<WorkerResponse> {
  if (typeof Worker === "undefined") throw new Error("This browser does not support image import. Enter the puzzle manually.");
  const activeWorker = getWorker();
  const id = nextId++;
  return new Promise<WorkerResponse>((resolve, reject) => {
    const timeout = setTimeout(() => fail(new Error("Image recognition timed out. Try a smaller crop.")), 120_000);
    pending.set(id, { resolve, reject, timeout });
    try { activeWorker.postMessage({ type, id, file, alreadyCropped }); }
    catch (error) { fail(error instanceof Error ? error : new Error("Could not read this image.")); }
  });
}

export async function detectBoardLocally(file: File): Promise<Bounds | null> {
  return (await requestImage(file, "detect")).bounds ?? null;
}

export async function recognizeImageLocally(file: File, alreadyCropped = false): Promise<OcrResponse> {
  const { cells } = await requestImage(file, "recognize", alreadyCropped);
  if (!cells) throw new Error("Image recognition failed.");
  const validation = validateSudokuGrid(parsePuzzleText(cells.map(cell => cell.value ?? 0).join("")));
  const warnings = validation.valid ? [] : ["Classified digits contain Sudoku conflicts. Fix highlighted cells before asking for a hint."];
  warnings.push(cells.some(cell => cell.value !== null)
    ? "Image read on your device. Review the classified digits before asking for a hint."
    : "Grid was detected, but no digits were classified. Review the correction grid manually.");
  return { cells, warnings };
}
