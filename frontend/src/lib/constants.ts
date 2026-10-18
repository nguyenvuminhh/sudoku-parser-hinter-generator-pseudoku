export const APP_NAME = "Pseudoku";
export const APP_TAGLINE = "Sudoku parser, hinter, generator";
export const APP_DESCRIPTION = APP_TAGLINE;

export const SAMPLE_PUZZLE =
  "000694832" +
  "004357196" +
  "090002745" +
  "070035004" +
  "040008600" +
  "031046000" +
  "400000078" +
  "000000420" +
  "900400560";

export type TutorPhase = "loading" | "solving";
export type GeneratedLevel =
  | "easy"
  | "medium"
  | "hard"
  | "expert"
  | "master"
  | "extreme"
  | "advanced_7_8"
  | "advanced_8_plus";
export type EntryMode = "value" | "corner" | "center" | "color";
/** The two pencil-mark layers (a subset of EntryMode). */
export type NoteEntryMode = Extract<EntryMode, "corner" | "center">;
export type PuzzleRating = {
  label: string;
};

export function isNoteEntryMode(mode: EntryMode): mode is NoteEntryMode {
  return mode === "corner" || mode === "center";
}

/** Status-bar copy describing what an entry mode does. */
export function entryModeMessage(mode: EntryMode): string {
  if (mode === "corner") {
    return "Corner notes: digits mark the corners of selected empty cells.";
  }
  if (mode === "center") {
    return "Center notes: digits collect in the middle of selected empty cells.";
  }
  if (mode === "color") {
    return "Color mode: digits paint the selected cells. Press again to clear.";
  }
  return "Normal mode: digits fill the selected cells.";
}

/** Accessible names for the 9 cell paint colors, indexed 1-9. */
export const PAINT_COLOR_NAMES = [
  "",
  "red",
  "orange",
  "yellow",
  "green",
  "teal",
  "blue",
  "purple",
  "pink",
  "gray"
] as const;

export const GENERATED_LEVELS: Array<{ id: GeneratedLevel; label: string }> = [
  { id: "easy", label: "Easy" },
  { id: "medium", label: "Medium" },
  { id: "hard", label: "Hard" },
  { id: "expert", label: "Expert" },
  { id: "master", label: "Master" },
  { id: "extreme", label: "Extreme" },
  { id: "advanced_7_8", label: "Advanced 7-8" },
  { id: "advanced_8_plus", label: "Advanced 8+" }
];
