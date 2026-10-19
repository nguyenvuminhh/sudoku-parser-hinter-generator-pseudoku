import { type OcrCell } from "./sudoku-state";

export type HintResponse = {
  technique: {
    id: string;
    name: string;
    rank: number;
  };
  action: {
    type: "place" | "eliminate" | "none";
    cell?: { row: number; col: number } | null;
    digit?: number | null;
    eliminations: Array<{ cell: { row: number; col: number }; digit: number }>;
  };
  summary: string;
  explanation: string[];
  highlights: {
    primary_cells: Array<{ row: number; col: number }>;
    related_cells: Array<{ row: number; col: number }>;
    eliminations: Array<{ cell: { row: number; col: number }; digit: number }>;
  };
};

export type OcrResponse = {
  cells: OcrCell[];
  warnings: string[];
};

export type GeneratedPuzzleResponse = {
  puzzle: string;
  solution: string;
  level: {
    id: string;
    name: string;
    description: string;
    techniques: string[];
  };
  requested_level: {
    id: string;
    name: string;
    description: string;
    techniques: string[];
  };
  se_rating: number;
  techniques: string[];
  technique_profile: Record<string, number>;
  attribution: {
    name: string;
    url: string;
    license: string;
    copyright: string;
  };
};

// The public interface is retained for the workspace; all work is local/static.
export async function requestGeneratedPuzzle(level: string): Promise<GeneratedPuzzleResponse> {
  const { selectRatedPuzzle } = await import("./puzzle-collection");
  return selectRatedPuzzle(level);
}

export async function recognizeImage(file: File, alreadyCropped = false): Promise<OcrResponse> {
  const { recognizeImageLocally } = await import("./ocr-client");
  return recognizeImageLocally(file, alreadyCropped);
}
