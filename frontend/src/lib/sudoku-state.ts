export type CellValue = number | null;
export type SudokuGrid = CellValue[];
export type NotesGrid = number[][];
export type GivenMask = boolean[];
export type MatchingDigitHighlights = {
  valueIndexes: number[];
  noteIndexes: number[];
};

export type CellColors = Array<number | null>;

export type BoardMarks = {
  corner: NotesGrid;
  center: NotesGrid;
  // Auto-fill candidate layer (corner-style). Independent of the manual corner
  // notes so toggling auto-fill never destroys the player's own pencil marks.
  auto: NotesGrid;
  colors: CellColors;
};

export type BoardSnapshot = {
  grid: SudokuGrid;
  marks: BoardMarks;
  selectedIndex: number;
  lowConfidence: number[];
};

export type ValidationConflict = {
  unit: "row" | "col" | "box";
  unitNumber: number;
  digit: number;
  cells: Array<{ row: number; col: number }>;
};

export type ValidationResponse = {
  valid: boolean;
  conflicts: ValidationConflict[];
  candidates: Record<string, number[]>;
};

export type CandidateElimination = { cell: { row: number; col: number }; digit: number };
export type CandidatePayload = Record<string, number[]>;

export type CheckStatus = "solved" | "incomplete" | "incorrect" | "unsolvable";

export type CheckResult = {
  status: CheckStatus;
  incorrectIndexes: number[];
};

const DIGITS = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const;

export type OcrCell = {
  row: number;
  col: number;
  value: CellValue;
  confidence: number;
};

export function createEmptyGrid(): SudokuGrid {
  return Array.from({ length: 81 }, () => null);
}

export function createEmptyNotes(): NotesGrid {
  return Array.from({ length: 81 }, () => []);
}

export function createGivenMask(grid: SudokuGrid): GivenMask {
  return grid.map((value) => value !== null);
}

export function createEmptyColors(): CellColors {
  return Array.from({ length: 81 }, () => null);
}

export function createEmptyMarks(): BoardMarks {
  return { corner: createEmptyNotes(), center: createEmptyNotes(), auto: createEmptyNotes(), colors: createEmptyColors() };
}

export function cloneMarks(marks: BoardMarks): BoardMarks {
  return {
    corner: cloneNotes(marks.corner),
    center: cloneNotes(marks.center),
    auto: cloneNotes(marks.auto),
    colors: [...marks.colors]
  };
}

export function createBoardSnapshot(
  grid: SudokuGrid,
  marks: BoardMarks,
  selectedIndex: number,
  lowConfidence: number[]
): BoardSnapshot {
  return {
    grid: [...grid],
    marks: cloneMarks(marks),
    selectedIndex,
    lowConfidence: [...lowConfidence]
  };
}

export function pushUndoSnapshot(stack: BoardSnapshot[], snapshot: BoardSnapshot, limit = 50): BoardSnapshot[] {
  if (limit <= 0) {
    return [];
  }

  return [cloneBoardSnapshot(snapshot), ...stack.map(cloneBoardSnapshot)].slice(0, limit);
}

export function restoreUndoSnapshot(stack: BoardSnapshot[]): { snapshot: BoardSnapshot | null; stack: BoardSnapshot[] } {
  if (stack.length === 0) {
    return { snapshot: null, stack: [] };
  }

  const [snapshot, ...remaining] = stack;
  return {
    snapshot: cloneBoardSnapshot(snapshot),
    stack: remaining.map(cloneBoardSnapshot)
  };
}

export function parsePuzzleText(text: string): SudokuGrid {
  const compact = text.replace(/[^0-9.]/g, "");
  if (compact.length !== 81) {
    throw new Error("Puzzle text must contain exactly 81 digits, zeroes, or dots.");
  }

  return compact.split("").map((char) => {
    if (char === "." || char === "0") {
      return null;
    }
    const digit = Number(char);
    if (!Number.isInteger(digit) || digit < 1 || digit > 9) {
      throw new Error("Only digits 1-9, zeroes, and dots are allowed.");
    }
    return digit;
  });
}

export function gridToPayload(grid: SudokuGrid): string {
  return grid.map((value) => value ?? 0).join("");
}

export function setCellValue(grid: SudokuGrid, index: number, value: CellValue): SudokuGrid {
  if (index < 0 || index > 80) {
    return grid;
  }
  if (value !== null && (value < 1 || value > 9)) {
    return grid;
  }
  const next = [...grid];
  next[index] = value;
  return next;
}

export function setCellValueWithNotes(
  grid: SudokuGrid,
  notes: NotesGrid,
  index: number,
  value: CellValue
): { grid: SudokuGrid; notes: NotesGrid } {
  const nextGrid = setCellValue(grid, index, value);
  if (nextGrid === grid) {
    return { grid, notes };
  }

  const nextNotes = cloneNotes(notes);
  nextNotes[index] = [];
  if (value !== null) {
    for (const peer of relatedIndexes(index)) {
      nextNotes[peer] = nextNotes[peer].filter((note) => note !== value);
    }
  }

  return { grid: nextGrid, notes: nextNotes };
}

/**
 * Sets a cell value while clearing both note layers in the cell and pruning
 * the placed digit from peer notes. Colors are left untouched.
 */
export function setCellValueWithMarks(
  grid: SudokuGrid,
  marks: BoardMarks,
  index: number,
  value: CellValue
): { grid: SudokuGrid; marks: BoardMarks } {
  const center = setCellValueWithNotes(grid, marks.center, index, value);
  if (center.grid === grid) {
    return { grid, marks };
  }
  const corner = setCellValueWithNotes(grid, marks.corner, index, value);
  const auto = setCellValueWithNotes(grid, marks.auto, index, value);
  return {
    grid: center.grid,
    marks: { corner: corner.notes, center: center.notes, auto: auto.notes, colors: [...marks.colors] }
  };
}

/**
 * Smart-toggles a note digit across cells: if every empty cell in the group
 * already holds the note it is removed everywhere, otherwise it is added to
 * each empty cell. Filled cells are skipped.
 */
export function toggleNoteOnCells(notes: NotesGrid, grid: SudokuGrid, indexes: number[], digit: number): NotesGrid {
  const targets = indexes.filter((index) => index >= 0 && index <= 80 && grid[index] === null);
  if (targets.length === 0 || !DIGITS.includes(digit as (typeof DIGITS)[number])) {
    return notes;
  }

  const everyCellHasNote = targets.every((index) => (notes[index] ?? []).includes(digit));
  const next = cloneNotes(notes);
  for (const index of targets) {
    if (everyCellHasNote) {
      next[index] = next[index].filter((note) => note !== digit);
    } else if (!next[index].includes(digit)) {
      next[index] = [...next[index], digit].sort((left, right) => left - right);
    }
  }
  return next;
}

/**
 * Smart-toggles a paint color across cells: if every cell already wears the
 * color it is cleared, otherwise all cells are painted with it. A null color
 * clears the cells.
 */
export function toggleColorOnCells(colors: CellColors, indexes: number[], color: number | null): CellColors {
  const targets = indexes.filter((index) => index >= 0 && index <= 80);
  if (targets.length === 0) {
    return colors;
  }

  const next = [...colors];
  if (color === null) {
    for (const index of targets) {
      next[index] = null;
    }
    return next;
  }

  const everyCellPainted = targets.every((index) => colors[index] === color);
  for (const index of targets) {
    next[index] = everyCellPainted ? null : color;
  }
  return next;
}

/** Removes eliminated digits from a notes grid without backfilling candidates. */
export function pruneEliminationsFromNotes(notes: NotesGrid, eliminations: CandidateElimination[]): NotesGrid {
  const next = cloneNotes(notes);
  for (const elimination of eliminations) {
    const index = cellToIndex(elimination.cell);
    if (index < 0 || index > 80) {
      continue;
    }
    next[index] = next[index].filter((note) => note !== elimination.digit);
  }
  return next;
}

/** Finds the next digit (wrapping) that has fewer than nine placements. */
export function nextIncompleteDigit(grid: SudokuGrid, from: number): number | null {
  const counts = new Array(10).fill(0);
  for (const value of grid) {
    if (value) {
      counts[value] += 1;
    }
  }

  for (let offset = 1; offset <= 9; offset += 1) {
    const digit = ((from - 1 + offset) % 9) + 1;
    if (counts[digit] < 9) {
      return digit;
    }
  }
  return null;
}

export function validateSudokuGrid(grid: SudokuGrid): ValidationResponse {
  const conflicts = collectValidationConflicts(grid);
  return {
    valid: conflicts.length === 0,
    conflicts,
    candidates: conflicts.length === 0 ? collectCandidates(grid) : {}
  };
}

export function solveSudoku(grid: SudokuGrid): SudokuGrid | null {
  if (!validateSudokuGrid(grid).valid) {
    return null;
  }

  const cells = grid.map((value) => value ?? 0);
  return solveCells(cells) ? cells.map((value) => (value === 0 ? null : value)) : null;
}

export function checkPuzzle(givens: SudokuGrid, grid: SudokuGrid): CheckResult {
  const solution = solveSudoku(givens);
  if (!solution) {
    return { status: "unsolvable", incorrectIndexes: [] };
  }

  const incorrectIndexes: number[] = [];
  for (let index = 0; index < 81; index += 1) {
    const value = grid[index];
    if (value !== null && value !== solution[index]) {
      incorrectIndexes.push(index);
    }
  }

  if (incorrectIndexes.length > 0) {
    return { status: "incorrect", incorrectIndexes };
  }

  const complete = grid.every((value) => value !== null);
  return { status: complete ? "solved" : "incomplete", incorrectIndexes: [] };
}

export function quickFillNotes(grid: SudokuGrid): NotesGrid {
  const validation = validateSudokuGrid(grid);
  if (!validation.valid) {
    return createEmptyNotes();
  }

  return grid.map((value, index) => (value === null ? [...(validation.candidates[String(index)] ?? [])] : []));
}

export function removeAllNotes(_notes?: NotesGrid): NotesGrid {
  return createEmptyNotes();
}

export function applyHintEliminationsToNotes(
  grid: SudokuGrid,
  notes: NotesGrid,
  eliminations: CandidateElimination[]
): NotesGrid {
  const next = notesContainAnyCandidate(notes) ? cloneNotes(notes) : quickFillNotes(grid);

  for (const elimination of eliminations) {
    const index = cellToIndex(elimination.cell);
    if (index < 0 || index > 80 || grid[index] !== null || !DIGITS.includes(elimination.digit as (typeof DIGITS)[number])) {
      continue;
    }
    next[index] = next[index].filter((note) => note !== elimination.digit);
  }

  return next;
}

export function notesToCandidatePayload(grid: SudokuGrid, notes: NotesGrid): CandidatePayload | null {
  if (!notesContainAnyCandidate(notes)) {
    return null;
  }

  const validation = validateSudokuGrid(grid);
  if (!validation.valid) {
    return null;
  }

  const payload: CandidatePayload = {};
  for (const [index, value] of grid.entries()) {
    if (value !== null) {
      continue;
    }

    const legalCandidates = validation.candidates[String(index)] ?? [];
    const legalCandidateSet = new Set(legalCandidates);
    const explicitNotes = uniqueSortedDigits(notes[index] ?? []).filter((digit) => legalCandidateSet.has(digit));
    payload[String(index)] = explicitNotes.length > 0 ? explicitNotes : legalCandidates;
  }

  return payload;
}

export function toggleCellNote(notes: NotesGrid, grid: SudokuGrid, index: number, digit: number): NotesGrid {
  if (index < 0 || index > 80 || !DIGITS.includes(digit as (typeof DIGITS)[number]) || grid[index] !== null) {
    return notes;
  }

  const next = cloneNotes(notes);
  if (next[index].includes(digit)) {
    next[index] = next[index].filter((note) => note !== digit);
  } else {
    next[index] = [...next[index], digit].sort((left, right) => left - right);
  }
  return next;
}

export function collectMatchingDigitHighlights(
  grid: SudokuGrid,
  notes: NotesGrid,
  digit: number | null
): MatchingDigitHighlights {
  if (digit === null || !DIGITS.includes(digit as (typeof DIGITS)[number])) {
    return { valueIndexes: [], noteIndexes: [] };
  }

  const valueIndexes: number[] = [];
  const noteIndexes: number[] = [];
  for (let index = 0; index < 81; index += 1) {
    if (grid[index] === digit) {
      valueIndexes.push(index);
    }
    if ((notes[index] ?? []).includes(digit)) {
      noteIndexes.push(index);
    }
  }

  return { valueIndexes, noteIndexes };
}

export function applyOcrCells(
  grid: SudokuGrid,
  cells: OcrCell[]
): { grid: SudokuGrid; lowConfidence: number[] } {
  const next = [...grid];
  const lowConfidence: number[] = [];

  for (const cell of cells) {
    if (cell.row < 1 || cell.row > 9 || cell.col < 1 || cell.col > 9) {
      continue;
    }
    const index = (cell.row - 1) * 9 + (cell.col - 1);
    next[index] = cell.value;
    if (cell.confidence < 0.5) {
      lowConfidence.push(index);
    }
  }

  return { grid: next, lowConfidence };
}

export function peerIndexes(index: number): number[] {
  if (index < 0 || index > 80) {
    return [];
  }
  return relatedIndexes(index).filter((peer) => peer !== index);
}

export function gridsEqual(left: SudokuGrid, right: SudokuGrid): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function notesEqual(left: NotesGrid, right: NotesGrid): boolean {
  return left.length === right.length && left.every((values, index) => numberListsEqual(values, right[index] ?? []));
}

export function marksEqual(left: BoardMarks, right: BoardMarks): boolean {
  return (
    notesEqual(left.corner, right.corner) &&
    notesEqual(left.center, right.center) &&
    notesEqual(left.auto, right.auto) &&
    left.colors.length === right.colors.length &&
    left.colors.every((color, index) => color === right.colors[index])
  );
}

export function numberListsEqual(left: number[], right: number[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function indexToCell(index: number): { row: number; col: number } {
  return { row: Math.floor(index / 9) + 1, col: (index % 9) + 1 };
}

export function cellToIndex(cell: { row: number; col: number }): number {
  return (cell.row - 1) * 9 + (cell.col - 1);
}

export function countFilledCells(grid: SudokuGrid): number {
  return grid.filter((value) => value !== null).length;
}

export function resolveKeyboardInput(key: string): CellValue | "ignored" {
  if (/^[1-9]$/.test(key)) {
    return Number(key);
  }
  if (key === " " || key === "0" || key === "Backspace" || key === "Delete") {
    return null;
  }
  return "ignored";
}

export type NavDirection = "up" | "down" | "left" | "right";

export function resolveNavigationKey(key: string): NavDirection | null {
  switch (key) {
    case "ArrowUp":
    case "w":
    case "W":
      return "up";
    case "ArrowDown":
    case "s":
    case "S":
      return "down";
    case "ArrowLeft":
    case "a":
    case "A":
      return "left";
    case "ArrowRight":
    case "d":
    case "D":
      return "right";
    default:
      return null;
  }
}

export function moveSelection(index: number, direction: NavDirection): number {
  if (index < 0 || index > 80) {
    return index;
  }

  const row = Math.floor(index / 9);
  const col = index % 9;
  switch (direction) {
    case "up":
      return Math.max(0, row - 1) * 9 + col;
    case "down":
      return Math.min(8, row + 1) * 9 + col;
    case "left":
      return row * 9 + Math.max(0, col - 1);
    case "right":
      return row * 9 + Math.min(8, col + 1);
  }
}

export function findNextInputIndex(grid: SudokuGrid, currentIndex: number): number {
  for (let offset = 1; offset <= 81; offset += 1) {
    const index = (currentIndex + offset) % 81;
    if (grid[index] === null) {
      return index;
    }
  }
  return currentIndex;
}

export function findNextCellWithValue(grid: SudokuGrid, value: number, fromIndex: number): number | null {
  if (!DIGITS.includes(value as (typeof DIGITS)[number])) {
    return null;
  }

  for (let offset = 1; offset <= 81; offset += 1) {
    const index = (fromIndex + offset) % 81;
    if (grid[index] === value) {
      return index;
    }
  }
  return null;
}

function collectValidationConflicts(grid: SudokuGrid): ValidationConflict[] {
  const conflicts: ValidationConflict[] = [];

  for (const [unit, unitNumber, indexes] of allUnits()) {
    const seen = new Map<number, number[]>();
    for (const index of indexes) {
      const digit = grid[index];
      if (digit !== null) {
        seen.set(digit, [...(seen.get(digit) ?? []), index]);
      }
    }

    for (const [digit, locations] of seen.entries()) {
      if (locations.length > 1) {
        conflicts.push({
          unit,
          unitNumber: unitNumber + 1,
          digit,
          cells: locations.map(indexToCell)
        });
      }
    }
  }

  return conflicts;
}

function solveCells(cells: number[]): boolean {
  const index = cells.indexOf(0);
  if (index === -1) {
    return true;
  }

  for (const digit of DIGITS) {
    if (canPlaceDigit(cells, index, digit)) {
      cells[index] = digit;
      if (solveCells(cells)) {
        return true;
      }
      cells[index] = 0;
    }
  }

  return false;
}

function canPlaceDigit(cells: number[], index: number, digit: number): boolean {
  for (const peer of relatedIndexes(index)) {
    if (peer !== index && cells[peer] === digit) {
      return false;
    }
  }
  return true;
}

function collectCandidates(grid: SudokuGrid): Record<string, number[]> {
  const candidates: Record<string, number[]> = {};
  for (const [index, value] of grid.entries()) {
    if (value !== null) {
      continue;
    }
    const used = usedDigits(grid, index);
    candidates[String(index)] = DIGITS.filter((digit) => !used.has(digit));
  }
  return candidates;
}

function usedDigits(grid: SudokuGrid, index: number): Set<number> {
  return new Set(relatedIndexes(index).map((peer) => grid[peer]).filter((value): value is number => value !== null));
}

function cloneNotes(notes: NotesGrid): NotesGrid {
  return Array.from({ length: 81 }, (_, index) => [...(notes[index] ?? [])]);
}

function cloneBoardSnapshot(snapshot: BoardSnapshot): BoardSnapshot {
  return createBoardSnapshot(snapshot.grid, snapshot.marks, snapshot.selectedIndex, snapshot.lowConfidence);
}

function notesContainAnyCandidate(notes: NotesGrid): boolean {
  return notes.some((cellNotes) => cellNotes.length > 0);
}

function uniqueSortedDigits(values: number[]): number[] {
  return Array.from(new Set(values.filter((value) => DIGITS.includes(value as (typeof DIGITS)[number])))).sort((left, right) => left - right);
}

function relatedIndexes(index: number): number[] {
  return Array.from(new Set([...unitIndexes("row", rowOf(index)), ...unitIndexes("col", colOf(index)), ...unitIndexes("box", boxOf(index))]));
}

function allUnits(): Array<["row" | "col" | "box", number, number[]]> {
  return [
    ...DIGITS.map((_, unitNumber): ["row", number, number[]] => ["row", unitNumber, unitIndexes("row", unitNumber)]),
    ...DIGITS.map((_, unitNumber): ["col", number, number[]] => ["col", unitNumber, unitIndexes("col", unitNumber)]),
    ...DIGITS.map((_, unitNumber): ["box", number, number[]] => ["box", unitNumber, unitIndexes("box", unitNumber)])
  ];
}

function unitIndexes(unit: "row" | "col" | "box", number: number): number[] {
  if (unit === "row") {
    return DIGITS.map((_, col) => number * 9 + col);
  }
  if (unit === "col") {
    return DIGITS.map((_, row) => row * 9 + number);
  }

  const startRow = Math.floor(number / 3) * 3;
  const startCol = (number % 3) * 3;
  return [0, 1, 2].flatMap((rowOffset) => [0, 1, 2].map((colOffset) => (startRow + rowOffset) * 9 + startCol + colOffset));
}

function rowOf(index: number): number {
  return Math.floor(index / 9);
}

function colOf(index: number): number {
  return index % 9;
}

function boxOf(index: number): number {
  return Math.floor(rowOf(index) / 3) * 3 + Math.floor(colOf(index) / 3);
}
