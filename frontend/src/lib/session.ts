import type { TutorPhase } from "./constants";
import { createEmptyColors, createEmptyNotes, type BoardMarks, type GivenMask, type NotesGrid, type SudokuGrid } from "./sudoku-state";

export const SESSION_STORAGE_KEY = "sudoku-session-v1";

export type SavedSession = {
  version: 2;
  grid: SudokuGrid;
  marks: BoardMarks;
  givenMask: GivenMask;
  phase: TutorPhase;
  selectedIndex: number;
  lowConfidence: number[];
  elapsedSeconds: number;
  hintsUsed: number;
  checksUsed: number;
  techniqueNames: string[];
};

export function serializeSession(session: Omit<SavedSession, "version">): string {
  return JSON.stringify({ version: 2, ...session });
}

/**
 * Parses a stored session, returning null for malformed or empty boards so a
 * corrupt localStorage entry can never break the app on load. Version 1
 * sessions are migrated (their single notes layer becomes center marks).
 */
export function parseSavedSession(raw: string | null): SavedSession | null {
  if (!raw) {
    return null;
  }

  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }

  if (typeof data !== "object" || data === null) {
    return null;
  }
  const session = data as Record<string, unknown>;

  if (session.version !== 1 && session.version !== 2) {
    return null;
  }
  if (!isGrid(session.grid) || !isMask(session.givenMask)) {
    return null;
  }
  if (session.phase !== "loading" && session.phase !== "solving") {
    return null;
  }
  if (!isCellIndex(session.selectedIndex)) {
    return null;
  }
  if (!Array.isArray(session.lowConfidence) || !session.lowConfidence.every(isCellIndex)) {
    return null;
  }
  if (typeof session.elapsedSeconds !== "number" || !Number.isFinite(session.elapsedSeconds) || session.elapsedSeconds < 0) {
    return null;
  }

  const grid = session.grid as SudokuGrid;
  if (grid.every((value) => value === null)) {
    return null;
  }

  let marks: BoardMarks;
  if (session.version === 1) {
    if (!isNotes(session.notes)) {
      return null;
    }
    marks = { corner: createEmptyNotes(), center: session.notes, auto: createEmptyNotes(), colors: createEmptyColors() };
  } else {
    if (!isMarks(session.marks)) {
      return null;
    }
    // `auto` was added later; default it for sessions saved before then.
    marks = { ...session.marks, auto: isNotes(session.marks.auto) ? session.marks.auto : createEmptyNotes() };
  }

  return {
    version: 2,
    grid,
    marks,
    givenMask: session.givenMask as GivenMask,
    phase: session.phase,
    selectedIndex: session.selectedIndex,
    lowConfidence: session.lowConfidence as number[],
    elapsedSeconds: Math.floor(session.elapsedSeconds),
    hintsUsed: asCount(session.hintsUsed),
    checksUsed: asCount(session.checksUsed),
    techniqueNames: isStringList(session.techniqueNames) ? session.techniqueNames : []
  };
}

function isGrid(value: unknown): value is SudokuGrid {
  return (
    Array.isArray(value) &&
    value.length === 81 &&
    value.every((cell) => cell === null || (Number.isInteger(cell) && cell >= 1 && cell <= 9))
  );
}

function isNotes(value: unknown): value is NotesGrid {
  return (
    Array.isArray(value) &&
    value.length === 81 &&
    value.every(
      (cellNotes) =>
        Array.isArray(cellNotes) && cellNotes.every((note) => Number.isInteger(note) && note >= 1 && note <= 9)
    )
  );
}

function isColors(value: unknown): value is BoardMarks["colors"] {
  return (
    Array.isArray(value) &&
    value.length === 81 &&
    value.every((color) => color === null || (Number.isInteger(color) && color >= 1 && color <= 9))
  );
}

function isMarks(value: unknown): value is BoardMarks {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const marks = value as Record<string, unknown>;
  return isNotes(marks.corner) && isNotes(marks.center) && isColors(marks.colors);
}

function isMask(value: unknown): value is GivenMask {
  return Array.isArray(value) && value.length === 81 && value.every((flag) => typeof flag === "boolean");
}

function isCellIndex(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 80;
}

function isStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function asCount(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : 0;
}
