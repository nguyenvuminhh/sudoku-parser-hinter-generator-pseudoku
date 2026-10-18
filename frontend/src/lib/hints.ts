import type { GeneratedPuzzleResponse, HintResponse } from "./puzzle-services";
import type { NoteEntryMode } from "./constants";
import type { HintResult } from "./hintEngine";
import {
  cellToIndex,
  indexToCell,
  notesToCandidatePayload,
  type BoardMarks,
  type CheckResult,
  type NotesGrid,
  type SudokuGrid,
  type ValidationConflict
} from "./sudoku-state";

export type HintCellKind = "primary" | "related" | "elimination";

function techniqueId(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/**
 * Serializes the board's pencil marks into the candidate string the l2sg engine
 * accepts (81 cells joined by '|', each a run of its candidate digits, empty for
 * filled cells). Returns "" when the player has no notes, so the engine derives
 * full candidates from the values itself. Reuses `notesToCandidatePayload` so
 * the candidates handed to the engine are always intersected with the legal set.
 */
export function buildCandidateString(grid: SudokuGrid, notes: NotesGrid): string {
  const payload = notesToCandidatePayload(grid, notes);
  if (!payload) {
    return "";
  }
  const segments: string[] = [];
  for (let index = 0; index < 81; index += 1) {
    const candidates = payload[String(index)] ?? [];
    segments.push(grid[index] === null ? candidates.join("") : "");
  }
  return segments.join("|");
}

/**
 * Maps an l2sg `HintResult` onto the `HintResponse` shape the UI renders, so
 * HintPanel, HistoryPanel, and applyHint keep working unchanged. Pattern cells
 * become `primary_cells` (blue), eliminations stay red, and a placement drives
 * the green preview via the place action.
 */
export function hintResultToResponse(hint: HintResult): HintResponse {
  const technique = { id: techniqueId(hint.technique), name: hint.technique, rank: hint.difficulty };
  const explanation = hint.explanation?.length ? hint.explanation : [hint.description];

  if (hint.placement) {
    const cell = indexToCell(hint.placement.cell);
    return {
      technique,
      action: { type: "place", cell, digit: hint.placement.digit, eliminations: [] },
      summary: technique.name,
      explanation,
      highlights: { primary_cells: [cell], related_cells: hint.causalCells.filter(index => index !== hint.placement!.cell).map(indexToCell), eliminations: [] }
    };
  }

  const eliminations = hint.eliminations.map((item) => ({ cell: indexToCell(item.cell), digit: item.digit }));
  return {
    technique,
    action: { type: "eliminate", cell: null, digit: null, eliminations },
    summary: technique.name,
    explanation,
    highlights: { primary_cells: hint.causalCells.map(indexToCell), related_cells: [], eliminations }
  };
}

export type HintPreview = { index: number; digit: number };

export function collectConflictIndexes(conflicts: ValidationConflict[]): Set<number> {
  return new Set(conflicts.flatMap((conflict) => conflict.cells.map(cellToIndex)));
}

export function collectHintCells(hint: HintResponse | null, kind: HintCellKind): Set<number> {
  if (!hint) {
    return new Set();
  }
  if (kind === "primary") {
    return new Set(hint.highlights.primary_cells.map(cellToIndex));
  }
  if (kind === "related") {
    return new Set(hint.highlights.related_cells.map(cellToIndex));
  }
  return new Set(hint.highlights.eliminations.map((item) => cellToIndex(item.cell)));
}

/**
 * Drops eliminations the player has already crossed off in their notes, so the
 * displayed hint is never redundant. Returns the trimmed hint, or null when
 * nothing new remains. Placement hints pass through unchanged.
 */
export function withoutAppliedEliminations(hint: HintResponse, notes: NotesGrid): HintResponse | null {
  if (hint.action.type !== "eliminate") {
    return hint;
  }
  const eliminations = hint.action.eliminations.filter((item) => {
    const cellNotes = notes[cellToIndex(item.cell)] ?? [];
    return cellNotes.length === 0 || cellNotes.includes(item.digit);
  });
  if (eliminations.length === 0) {
    return null;
  }
  return {
    ...hint,
    action: { ...hint.action, eliminations },
    highlights: { ...hint.highlights, eliminations }
  };
}

export function collectHintPreview(hint: HintResponse | null, grid: SudokuGrid): HintPreview | null {
  if (hint?.action.type !== "place" || !hint.action.cell || !hint.action.digit) {
    return null;
  }

  const index = cellToIndex(hint.action.cell);
  if (index < 0 || index > 80 || grid[index] !== null) {
    return null;
  }

  return { index, digit: hint.action.digit };
}

/**
 * The candidates the player is tracking for one cell. When a cell carries notes
 * in both layers the player's active note mode wins; otherwise whichever layer
 * has notes is used.
 */
export function effectiveCellNotes(corner: number[], center: number[], preferred: NoteEntryMode): number[] {
  if (corner.length > 0 && center.length > 0) {
    return preferred === "center" ? center : corner;
  }
  return corner.length > 0 ? corner : center;
}

/** Per-cell candidate notes for empty cells, collapsing the two note layers. */
export function effectiveNotesGrid(grid: SudokuGrid, marks: BoardMarks, preferred: NoteEntryMode): NotesGrid {
  return grid.map((value, index) =>
    value === null ? effectiveCellNotes(marks.corner[index] ?? [], marks.center[index] ?? [], preferred) : []
  );
}

export function checkResultMessage(result: CheckResult): string {
  if (result.status === "solved") {
    return "Solved! Every cell matches the solution.";
  }
  if (result.status === "incorrect") {
    const count = result.incorrectIndexes.length;
    return `Found ${count} wrong number${count === 1 ? "" : "s"}. Highlighted cells do not match the solution.`;
  }
  if (result.status === "unsolvable") {
    return "The locked givens have no valid solution, so the board cannot be checked.";
  }
  return "No mistakes so far. Some cells are still empty—keep going.";
}

export function generatedPuzzleMessage(generated: GeneratedPuzzleResponse): string {
  const requested = generated.requested_level.name;
  const rated = generated.level.name;
  const seRating = generated.se_rating ? `, SE ${generated.se_rating.toFixed(1)}` : "";
  return `Generated ${requested} puzzle. Rated ${rated}${seRating} by ${generated.attribution.name}. Review it, then confirm to lock the givens.`;
}
