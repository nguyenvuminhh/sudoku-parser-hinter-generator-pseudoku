import type { GeneratedPuzzleResponse } from "./api";
import { GENERATED_LEVELS } from "./constants";
import { assetUrl } from "./static-assets";

type Manifest = { levels: Record<string, { name: string; count: number; chunkSize: number }> };
type PuzzleRecord = [puzzle: string, solution: string, rating: number, technique: string];

async function readCollection<T>(path: string): Promise<T> {
  const response = await fetch(assetUrl(`puzzles/${path}`));
  if (!response.ok) throw new Error("The puzzle collection could not be loaded. Please try again.");
  return response.json();
}

export async function selectRatedPuzzle(id: string): Promise<GeneratedPuzzleResponse> {
  if (!GENERATED_LEVELS.some(level => level.id === id)) throw new Error("Unknown Sudoku difficulty level.");
  const manifest = await readCollection<Manifest>("manifest.json");
  const bucket = manifest.levels[id];
  if (!bucket || bucket.count < 1 || bucket.chunkSize < 1) throw new Error("This difficulty is missing from the puzzle collection.");
  // Choose the record first: even the smaller final chunk gets its fair weight.
  const index = Math.floor(Math.random() * bucket.count);
  const records = await readCollection<PuzzleRecord[]>(`${id}/${Math.floor(index / bucket.chunkSize)}.json`);
  const record = records[index % bucket.chunkSize];
  if (!record || !/^[0-9]{81}$/.test(record[0]) || !/^[1-9]{81}$/.test(record[1])) {
    throw new Error("The puzzle collection contains an unreadable puzzle.");
  }
  const [puzzle, solution, rating, technique] = record;
  const techniques = technique ? [technique] : [];
  const level = { id, name: bucket.name, description: "From the rated SE puzzle collection.", techniques };
  return {
    puzzle, solution, se_rating: rating, level, requested_level: level, techniques,
    technique_profile: technique ? { [technique]: 1 } : {},
    attribution: { name: "Puzzle Hint SE bucket corpus", url: "https://github.com/SudokuMonster/SukakuExplainer", license: "Generated puzzle corpus", copyright: "" }
  };
}
