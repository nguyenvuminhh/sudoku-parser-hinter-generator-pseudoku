"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import {
  requestGeneratedPuzzle,
  recognizeImage,
  type GeneratedPuzzleResponse,
  type HintResponse
} from "../lib/puzzle-services";
import {
  SAMPLE_PUZZLE,
  entryModeMessage,
  isNoteEntryMode,
  type EntryMode,
  type GeneratedLevel,
  type NoteEntryMode,
  type PuzzleRating,
  type TutorPhase
} from "../lib/constants";
import {
  buildCandidateString,
  checkResultMessage,
  collectConflictIndexes,
  collectHintCells,
  collectHintPreview,
  effectiveNotesGrid,
  generatedPuzzleMessage,
  hintResultToResponse,
  withoutAppliedEliminations,
  type HintPreview
} from "../lib/hints";
import { parseSavedSession, serializeSession, SESSION_STORAGE_KEY } from "../lib/session";
import { decodePuzzleParam, encodePuzzleParam } from "../lib/share-codec";
import { formatElapsedSeconds } from "../lib/time";
import {
  applyHintEliminationsToNotes,
  applyOcrCells,
  cellToIndex,
  checkPuzzle,
  cloneMarks,
  collectMatchingDigitHighlights,
  countFilledCells,
  createBoardSnapshot,
  createEmptyGrid,
  createEmptyMarks,
  createEmptyNotes,
  createGivenMask,
  findNextCellWithValue,
  findNextInputIndex,
  gridToPayload,
  gridsEqual,
  indexToCell,
  marksEqual,
  moveSelection,
  nextIncompleteDigit,
  numberListsEqual,
  parsePuzzleText,
  peerIndexes,
  pruneEliminationsFromNotes,
  pushUndoSnapshot,
  quickFillNotes,
  restoreUndoSnapshot,
  setCellValue,
  setCellValueWithMarks,
  toggleCellNote,
  toggleColorOnCells,
  toggleNoteOnCells,
  validateSudokuGrid,
  type BoardMarks,
  type BoardSnapshot,
  type CheckResult,
  type GivenMask,
  type NavDirection,
  type SudokuGrid
} from "../lib/sudoku-state";
import { useBoardGestures } from "./useBoardGestures";
import { useHintEngine } from "./useHintEngine";
import { useSessionPersistence } from "./useSessionPersistence";
import { useSettings } from "./useSettings";

export type SudokuGame = ReturnType<typeof useSudokuGame>;

export function useSudokuGame() {
  const [grid, setGrid] = useState<SudokuGrid>(() => createEmptyGrid());
  const [marks, setMarks] = useState<BoardMarks>(() => createEmptyMarks());
  const [givenMask, setGivenMask] = useState<GivenMask>(() => createGivenMask(createEmptyGrid()));
  const [phase, setPhase] = useState<TutorPhase>("loading");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [selectedIndexes, setSelectedIndexes] = useState<number[]>([0]);
  const [currentHint, setCurrentHint] = useState<HintResponse | null>(null);
  const [history, setHistory] = useState<HintResponse[]>([]);
  const [undoStack, setUndoStack] = useState<BoardSnapshot[]>([]);
  const [redoStack, setRedoStack] = useState<BoardSnapshot[]>([]);
  const [checkResult, setCheckResult] = useState<CheckResult | null>(null);
  const [lowConfidence, setLowConfidence] = useState<number[]>([]);
  const [messages, setMessages] = useState<string[]>([
    "Enter a puzzle on the board or upload a clean Sudoku screenshot."
  ]);
  const [busyLabel, setBusyLabel] = useState<string | null>(null);
  const [entryMode, setEntryMode] = useState<EntryMode>("value");
  // Remembers the last note mode so the Normal/Note toggle can restore it.
  const [noteType, setNoteType] = useState<NoteEntryMode>("corner");
  // Auto-fill overlays computed candidates (corner-style) as a separate layer
  // the player can prune without touching their own notes. Off by default.
  const [autoFill, setAutoFill] = useState(false);
  const [quickFillMode, setQuickFillMode] = useState(false);
  const [quickFillDigit, setQuickFillDigit] = useState<number | null>(null);
  const [puzzleText, setPuzzleText] = useState("");
  const [generatedLevel, setGeneratedLevel] = useState<GeneratedLevel>("easy");
  const [puzzleRating, setPuzzleRating] = useState<PuzzleRating | null>(null);
  const [paused, setPaused] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [solvedAnnounced, setSolvedAnnounced] = useState(false);
  const [finishDismissed, setFinishDismissed] = useState(false);
  const [hintsUsed, setHintsUsed] = useState(0);
  const [checksUsed, setChecksUsed] = useState(0);
  const [techniqueNames, setTechniqueNames] = useState<string[]>([]);
  const { settings, setSetting } = useSettings();
  // l2sg WebAssembly hint engine (loads in a Web Worker on first mount).
  const { ready: hintReady, getHint } = useHintEngine();

  // Live mirrors of the board state. Two pointer/click handlers can run in the
  // same tick before React re-renders (notably on touch, where the click-delay
  // can fire both taps' clicks back-to-back); reading and writing these refs at
  // commit time lets the second edit build on the first instead of clobbering it
  // with a stale closure copy.
  const gridRef = useRef(grid);
  const marksRef = useRef(marks);
  const lowConfidenceRef = useRef(lowConfidence);
  const selectedIndexRef = useRef(selectedIndex);
  gridRef.current = grid;
  marksRef.current = marks;
  lowConfidenceRef.current = lowConfidence;
  selectedIndexRef.current = selectedIndex;

  // Pointer/touch selection and quick-fill gestures live in their own hook; it
  // reads the state below and calls the placement/note actions defined further
  // down (hoisted function declarations).
  const { beginCellSelection, endCellSelection, dragCellSelection, clickCell, rightClickCell } = useBoardGestures({
    paused,
    quickFillMode,
    quickFillDigit,
    entryMode,
    noteType,
    selectedIndex,
    selectedIndexes,
    setSelectedIndex,
    setSelectedIndexes,
    placeQuickFillAt,
    placeQuickFillOnSelection,
    addNoteToIndexes,
    toggleNoteOnIndexes,
    applyValueToCells
  });

  const filledCount = countFilledCells(grid);
  const digitCounts = useMemo(() => {
    const counts = new Array(10).fill(0);
    for (const value of grid) {
      if (value) {
        counts[value] += 1;
      }
    }
    return counts;
  }, [grid]);
  const selectedCell = indexToCell(selectedIndex);
  const isSolving = phase === "solving";
  const selectedIsGiven = isSolving && givenMask[selectedIndex];
  const selectionAllGiven = isSolving && selectedIndexes.every((index) => givenMask[index]);
  const selectionAllFilled = selectedIndexes.every((index) => grid[index] !== null);
  // While auto-fill is on the board shows the auto layer (corner-style) in place
  // of the player's manual notes; their corner/center notes are kept underneath.
  const displayMarks = useMemo<BoardMarks>(
    () =>
      autoFill ? { corner: marks.auto, center: createEmptyNotes(), auto: marks.auto, colors: marks.colors } : marks,
    [autoFill, marks]
  );
  const selectedNotes = autoFill
    ? (marks.auto[selectedIndex] ?? [])
    : entryMode === "corner"
      ? (marks.corner[selectedIndex] ?? [])
      : (marks.center[selectedIndex] ?? []);
  const hasAnyNotes = marks.corner.some((notes) => notes.length > 0) || marks.center.some((notes) => notes.length > 0);
  const activeHighlightDigit = quickFillDigit ?? (selectedIndex >= 0 ? grid[selectedIndex] : null);
  const validation = useMemo(() => validateSudokuGrid(grid), [grid]);
  const sharePuzzleGrid = useMemo(
    () => (isSolving ? grid.map((value, index) => (givenMask[index] ? value : null)) : [...grid]),
    [givenMask, grid, isSolving]
  );
  const shareValidation = useMemo(() => validateSudokuGrid(sharePuzzleGrid), [sharePuzzleGrid]);
  const canSharePuzzle = countFilledCells(sharePuzzleGrid) > 0 && shareValidation.valid;
  const statusMessages = validation.valid ? messages : ["Fix the highlighted conflicts before requesting a hint."];
  const conflictIndexes = useMemo(() => collectConflictIndexes(validation.conflicts), [validation]);
  const incorrectIndexes = useMemo(() => new Set(checkResult?.incorrectIndexes ?? []), [checkResult]);
  const matchingHighlights = useMemo(() => {
    const center = collectMatchingDigitHighlights(grid, displayMarks.center, activeHighlightDigit);
    const corner = collectMatchingDigitHighlights(grid, displayMarks.corner, activeHighlightDigit);
    return {
      valueIndexes: new Set(center.valueIndexes),
      noteIndexes: new Set([...center.noteIndexes, ...corner.noteIndexes])
    };
  }, [activeHighlightDigit, grid, displayMarks]);
  const primaryIndexes = useMemo(() => collectHintCells(currentHint, "primary"), [currentHint]);
  const relatedIndexes = useMemo(() => collectHintCells(currentHint, "related"), [currentHint]);
  const eliminationIndexes = useMemo(() => collectHintCells(currentHint, "elimination"), [currentHint]);
  const hintPreview: HintPreview | null = useMemo(() => collectHintPreview(currentHint, grid), [currentHint, grid]);
  const canApplyCurrentHint =
    !busyLabel &&
    (Boolean(hintPreview) || Boolean(currentHint?.action.type === "eliminate" && currentHint.action.eliminations.length > 0));
  const isSolved = isSolving && filledCount === 81 && validation.valid;
  const showFinishDialog = isSolved && !finishDismissed;
  const peerHighlightIndexes = useMemo(
    () => new Set(selectedIndex >= 0 ? peerIndexes(selectedIndex) : []),
    [selectedIndex]
  );
  const selectedIndexSet = useMemo(() => new Set(selectedIndexes), [selectedIndexes]);
  const givensCount = useMemo(() => givenMask.filter(Boolean).length, [givenMask]);
  const finishStats = {
    elapsedSeconds,
    hintsUsed,
    checksUsed,
    givens: givensCount,
    filledByYou: 81 - givensCount,
    techniques: techniqueNames
  };


  // Shared puzzle URLs take precedence over saved sessions; opening a link
  // should show that puzzle even if this browser already has a local game.
  useEffect(() => {
    let sharedParam: string | null = null;
    try {
      sharedParam = new URLSearchParams(window.location.search).get("p");
    } catch {
      sharedParam = null;
    }

    if (sharedParam) {
      try {
        const sharedGrid = decodePuzzleParam(sharedParam);
        const sharedValidation = validateSudokuGrid(sharedGrid);
        if (!sharedValidation.valid) {
          setMessages(["Shared puzzle has conflicts. The link was not loaded."]);
          return;
        }
        if (countFilledCells(sharedGrid) === 0) {
          setMessages(["Shared puzzle is empty. The link was not loaded."]);
          return;
        }

        loadPuzzle(sharedGrid, ["Loaded shared puzzle. Review the board, then start solving."]);
        setPuzzleText(gridToPayload(sharedGrid));
        setLowConfidence([]);
      } catch {
        setMessages(["Share link could not be loaded."]);
      }
      return;
    }

    let saved;
    try {
      saved = parseSavedSession(window.localStorage.getItem(SESSION_STORAGE_KEY));
    } catch {
      return;
    }
    if (!saved) {
      return;
    }

    setGrid(saved.grid);
    setMarks(saved.marks);
    setGivenMask(saved.givenMask);
    setPhase(saved.phase);
    setSelectedIndex(saved.selectedIndex);
    setSelectedIndexes([saved.selectedIndex]);
    setLowConfidence(saved.lowConfidence);
    setElapsedSeconds(saved.elapsedSeconds);
    setHintsUsed(saved.hintsUsed);
    setChecksUsed(saved.checksUsed);
    setTechniqueNames(saved.techniqueNames);
    if (saved.phase === "solving") {
      setQuickFillMode(true);
    }
    setMessages(["Restored your previous session. Reset the puzzle to start fresh."]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist the board so the game survives reloads.
  useEffect(() => {
    try {
      window.localStorage.setItem(
        SESSION_STORAGE_KEY,
        serializeSession({
          grid,
          marks,
          givenMask,
          phase,
          selectedIndex,
          lowConfidence,
          elapsedSeconds,
          hintsUsed,
          checksUsed,
          techniqueNames
        })
      );
    } catch {
      // Storage may be unavailable (private mode, quota); play without saving.
    }
  }, [grid, marks, givenMask, phase, selectedIndex, lowConfidence, elapsedSeconds, hintsUsed, checksUsed, techniqueNames]);

  // Tick the solve clock while actively solving.
  useEffect(() => {
    if (!isSolving || paused || isSolved) {
      return;
    }
    const id = window.setInterval(() => setElapsedSeconds((seconds) => seconds + 1), 1000);
    return () => window.clearInterval(id);
  }, [isSolving, paused, isSolved]);

  // Announce a completed board once, and re-arm if the user undoes back out.
  useEffect(() => {
    if (isSolved && !solvedAnnounced) {
      setSolvedAnnounced(true);
      setMessages([`Solved! You completed the puzzle in ${formatElapsedSeconds(elapsedSeconds)}.`]);
    } else if (!isSolved && solvedAnnounced) {
      setSolvedAnnounced(false);
      setFinishDismissed(false);
    }
  }, [isSolved, solvedAnnounced, elapsedSeconds]);

  function selectOnly(index: number) {
    selectedIndexRef.current = index;
    setSelectedIndex(index);
    setSelectedIndexes([index]);
  }

  // Drops the selection entirely (e.g. a click landing off the board). -1 marks
  // "no cell"; the derived peer/highlight sets handle it.
  function clearSelection() {
    setSelectedIndex(-1);
    setSelectedIndexes([]);
  }

  function recordUndoSnapshot() {
    // Snapshot from the live refs *now*: a setState updater runs lazily, by which
    // point updateGrid/commitMarks may have advanced the refs past this edit.
    const snapshot = createBoardSnapshot(gridRef.current, marksRef.current, selectedIndexRef.current, lowConfidenceRef.current);
    setUndoStack((items) => pushUndoSnapshot(items, snapshot));
    setRedoStack([]);
  }

  function restoreSnapshot(snapshot: BoardSnapshot) {
    gridRef.current = snapshot.grid;
    marksRef.current = snapshot.marks;
    lowConfidenceRef.current = snapshot.lowConfidence;
    setGrid(snapshot.grid);
    setMarks(snapshot.marks);
    selectOnly(snapshot.selectedIndex);
    setLowConfidence(snapshot.lowConfidence);
    setCurrentHint(null);
    setCheckResult(null);
  }

  function undo() {
    const restored = restoreUndoSnapshot(undoStack);
    if (!restored.snapshot) {
      return;
    }

    const redoSnapshot = createBoardSnapshot(gridRef.current, marksRef.current, selectedIndexRef.current, lowConfidenceRef.current);
    setRedoStack((items) => pushUndoSnapshot(items, redoSnapshot));
    restoreSnapshot(restored.snapshot);
    setUndoStack(restored.stack);
    setMessages(["Undid the last board change."]);
  }

  function redo() {
    const restored = restoreUndoSnapshot(redoStack);
    if (!restored.snapshot) {
      return;
    }

    const undoSnapshot = createBoardSnapshot(gridRef.current, marksRef.current, selectedIndexRef.current, lowConfidenceRef.current);
    setUndoStack((items) => pushUndoSnapshot(items, undoSnapshot));
    restoreSnapshot(restored.snapshot);
    setRedoStack(restored.stack);
    setMessages(["Redid the last undone change."]);
  }

  function togglePause() {
    if (!isSolving || isSolved) {
      return;
    }
    const next = !paused;
    setPaused(next);
    setMessages([next ? "Paused. The board is hidden until you resume." : "Resumed. The clock is running again."]);
  }

  function check() {
    if (!isSolving) {
      setMessages(["Start solving before checking the puzzle."]);
      return;
    }

    const result = checkGrid(grid);
    setCheckResult(result);
    setChecksUsed((count) => count + 1);
    setMessages([checkResultMessage(result)]);
  }

  function checkGrid(candidateGrid: SudokuGrid): CheckResult {
    const givens = candidateGrid.map((value, index) => (givenMask[index] ? value : null));
    return checkPuzzle(givens, candidateGrid);
  }

  function hasBoardStateChanged(nextGrid: SudokuGrid, nextMarks: BoardMarks, nextLowConfidence = lowConfidenceRef.current): boolean {
    return (
      !gridsEqual(gridRef.current, nextGrid) ||
      !marksEqual(marksRef.current, nextMarks) ||
      !numberListsEqual(lowConfidenceRef.current, nextLowConfidence)
    );
  }

  function updateGrid(nextGrid: SudokuGrid, nextMarks = marksRef.current, nextCheckResult: CheckResult | null = null) {
    gridRef.current = nextGrid;
    marksRef.current = nextMarks;
    setGrid(nextGrid);
    setMarks(nextMarks);
    setCurrentHint(null);
    setCheckResult(nextCheckResult);
  }

  /** Records an undo snapshot and applies a marks-only change. */
  function commitMarks(nextMarks: BoardMarks) {
    if (hasBoardStateChanged(gridRef.current, nextMarks)) {
      recordUndoSnapshot();
    }
    marksRef.current = nextMarks;
    setMarks(nextMarks);
    setCurrentHint(null);
  }

  function pressDigit(value: number | null) {
    if (paused) {
      return;
    }
    // In color mode the eraser always clears the selected cells' colors, even
    // under quick fill (which otherwise treats a null press as "unlock digit").
    if (entryMode === "color" && value === null) {
      applyColorToSelection(null);
      return;
    }
    if (quickFillMode) {
      if (value === null) {
        setQuickFillDigit(null);
        setMessages(["Quick fill digit cleared."]);
        return;
      }

      // Re-pressing the active digit applies it to the selection; the first
      // press only locks the digit.
      if (value === quickFillDigit) {
        placeQuickFillOnSelection();
        return;
      }

      setQuickFillDigit(value);
      if (selectedIndexes.length === 1) {
        const matchingCell = findNextCellWithValue(grid, value, selectedIndex);
        if (matchingCell !== null) {
          selectOnly(matchingCell);
        }
      }
      setMessages([
        entryMode === "value"
          ? `Quick fill locked to ${value}. Press ${value} or Enter on a cell to fill it.`
          : `Quick fill locked to ${value}. Press ${value} or Enter on cells to mark them.`
      ]);
      return;
    }

    if (entryMode === "corner" || entryMode === "center") {
      if (value === null) {
        clearSelectedNotes();
      } else {
        toggleNoteOnSelection(value);
      }
      return;
    }

    if (entryMode === "color") {
      applyColorToSelection(value);
      return;
    }

    applyValueToCells(selectedIndexes, value, selectedIndexes.length === 1);
  }

  function placeQuickFillAt(index: number) {
    if (quickFillDigit === null) {
      return;
    }

    if (entryMode === "corner" || entryMode === "center") {
      if (gridRef.current[index] !== null) {
        setMessages(["Notes can only be edited on empty cells."]);
        return;
      }
      const liveMarks = marksRef.current;
      const layer = autoFill ? "auto" : entryMode;
      commitMarks({ ...liveMarks, [layer]: toggleCellNote(liveMarks[layer], gridRef.current, index, quickFillDigit) });
      return;
    }

    if (entryMode === "color") {
      const liveMarks = marksRef.current;
      commitMarks({ ...liveMarks, colors: toggleColorOnCells(liveMarks.colors, [index], quickFillDigit) });
      return;
    }

    applyValueToCells([index], quickFillDigit, false);
  }

  function placeQuickFillOnSelection() {
    if (quickFillDigit === null) {
      return;
    }

    if (entryMode === "corner" || entryMode === "center") {
      toggleNoteOnSelection(quickFillDigit);
      return;
    }
    if (entryMode === "color") {
      applyColorToSelection(quickFillDigit);
      return;
    }

    const targets = selectedIndexes.filter((index) => gridRef.current[index] !== quickFillDigit);
    if (targets.length > 0) {
      applyValueToCells(targets, quickFillDigit, false);
      return;
    }
    // Nothing to fill: keep the old behavior of cycling to the next cell that
    // already holds the locked digit.
    if (selectedIndexes.length === 1) {
      const matchingCell = findNextCellWithValue(gridRef.current, quickFillDigit, selectedIndexRef.current);
      if (matchingCell !== null) {
        selectOnly(matchingCell);
      }
    }
  }

  function toggleNoteOnSelection(digit: number) {
    toggleNoteOnIndexes(selectedIndexes, digit, isNoteEntryMode(entryMode) ? entryMode : noteType);
  }

  function toggleNoteOnIndexes(indexes: number[], digit: number, layer: NoteEntryMode) {
    if (!isSolving) {
      setMessages(["Start solving before editing notes."]);
      return;
    }
    const liveGrid = gridRef.current;
    const liveMarks = marksRef.current;
    const otherLayer = layer === "corner" ? "center" : "corner";
    const emptyTargets = indexes.filter((index) => liveGrid[index] === null);
    if (emptyTargets.length === 0) {
      setMessages(["Notes can only be edited on empty cells."]);
      return;
    }

    // Auto-fill is its own layer: edits land there and leave the manual notes be.
    if (autoFill) {
      commitMarks({ ...liveMarks, auto: toggleNoteOnCells(liveMarks.auto, liveGrid, emptyTargets, digit) });
      return;
    }

    // A digit lives in either the corner or the center layer, never both: drop
    // it from the opposite layer on the cells we just touched.
    const targetSet = new Set(emptyTargets);
    const nextOther = liveMarks[otherLayer].map((cellNotes, index) =>
      targetSet.has(index) ? cellNotes.filter((note) => note !== digit) : cellNotes
    );
    commitMarks({
      ...liveMarks,
      [layer]: toggleNoteOnCells(liveMarks[layer], liveGrid, emptyTargets, digit),
      [otherLayer]: nextOther
    });
  }

  function addNoteToIndexes(indexes: number[], digit: number, layer: NoteEntryMode) {
    if (!isSolving) {
      setMessages(["Start solving before editing notes."]);
      return;
    }
    const liveGrid = gridRef.current;
    const liveMarks = marksRef.current;
    const emptyTargets = indexes.filter((index) => liveGrid[index] === null);
    if (emptyTargets.length === 0) {
      return;
    }

    const targetSet = new Set(emptyTargets);
    if (autoFill) {
      const nextAuto = liveMarks.auto.map((cellNotes, index) =>
        !targetSet.has(index) || cellNotes.includes(digit) ? cellNotes : [...cellNotes, digit].sort((a, b) => a - b)
      );
      commitMarks({ ...liveMarks, auto: nextAuto });
      return;
    }
    const otherLayer = layer === "corner" ? "center" : "corner";
    const nextLayer = liveMarks[layer].map((cellNotes, index) => {
      if (!targetSet.has(index) || cellNotes.includes(digit)) {
        return cellNotes;
      }
      return [...cellNotes, digit].sort((left, right) => left - right);
    });
    const nextOther = liveMarks[otherLayer].map((cellNotes, index) =>
      targetSet.has(index) ? cellNotes.filter((note) => note !== digit) : cellNotes
    );
    commitMarks({ ...liveMarks, [layer]: nextLayer, [otherLayer]: nextOther });
  }

  function applyColorToSelection(color: number | null) {
    if (!isSolving) {
      setMessages(["Start solving before highlighting cells."]);
      return;
    }

    const liveMarks = marksRef.current;
    commitMarks({ ...liveMarks, colors: toggleColorOnCells(liveMarks.colors, selectedIndexes, color) });
  }

  function clearSelectedNotes() {
    if (!isSolving) {
      return;
    }

    const liveMarks = marksRef.current;
    const layer = autoFill ? "auto" : entryMode === "corner" ? "corner" : "center";
    const nextLayer = liveMarks[layer].map((cellNotes, index) => (selectedIndexes.includes(index) ? [] : cellNotes));
    commitMarks({ ...liveMarks, [layer]: nextLayer });
  }

  function applyValueToCells(indexes: number[], value: number | null, shouldAdvance: boolean) {
    const editable = indexes.filter((index) => canEditCellValue(index));
    if (editable.length === 0) {
      setMessages(["Loaded cells are locked during solving."]);
      return;
    }

    let nextGrid = gridRef.current;
    let nextMarks = marksRef.current;
    for (const index of editable) {
      if (isSolving) {
        const result = setCellValueWithMarks(nextGrid, nextMarks, index, value);
        nextGrid = result.grid;
        nextMarks = result.marks;
      } else {
        nextGrid = setCellValue(nextGrid, index, value);
      }
    }

    const nextLowConfidence = lowConfidenceRef.current.filter((index) => !editable.includes(index));
    const changed = hasBoardStateChanged(nextGrid, nextMarks, nextLowConfidence);
    if (isSolving && changed) {
      recordUndoSnapshot();
    }
    const autoCheckResult = isSolving && settings.autoCheck ? checkGrid(nextGrid) : null;
    updateGrid(nextGrid, nextMarks, autoCheckResult);
    lowConfidenceRef.current = nextLowConfidence;
    setLowConfidence(nextLowConfidence);
    if (changed && autoCheckResult) {
      setMessages([checkResultMessage(autoCheckResult)]);
    }
    if (shouldAdvance && value !== null && editable.length === 1) {
      selectOnly(findNextInputIndex(nextGrid, editable[0]));
    }
    maybeAdvanceQuickFillDigit(nextGrid, value);
  }

  /** Moves quick fill to the next incomplete digit once the current one is done. */
  function maybeAdvanceQuickFillDigit(nextGrid: SudokuGrid, placedValue: number | null) {
    if (!settings.autoAdvanceDigit || !quickFillMode || placedValue === null || quickFillDigit !== placedValue) {
      return;
    }
    const count = nextGrid.filter((value) => value === placedValue).length;
    if (count < 9) {
      return;
    }

    const next = nextIncompleteDigit(nextGrid, placedValue);
    setQuickFillDigit(next);
    if (next !== null) {
      // Move the selection onto the new digit too, like locking it by hand does,
      // so the highlighted cell follows the active number.
      const matchingCell = findNextCellWithValue(nextGrid, next, selectedIndexRef.current);
      if (matchingCell !== null) {
        selectOnly(matchingCell);
      }
      setMessages([`All ${placedValue}s are placed. Quick fill moved to ${next}.`]);
    }
  }

  // The candidate layer the player is working in: the layer that holds notes,
  // preferring their last-used note mode when both or neither layer has any.
  function activeNotesLayer(boardMarks: BoardMarks): NoteEntryMode {
    const cornerHasNotes = boardMarks.corner.some((notes) => notes.length > 0);
    const centerHasNotes = boardMarks.center.some((notes) => notes.length > 0);
    return cornerHasNotes === centerHasNotes ? noteType : cornerHasNotes ? "corner" : "center";
  }

  function applyHint() {
    if (!currentHint) {
      return;
    }

    if (hintPreview) {
      const liveGrid = gridRef.current;
      const liveMarks = marksRef.current;
      const cell = indexToCell(hintPreview.index);
      const result = setCellValueWithMarks(liveGrid, liveMarks, hintPreview.index, hintPreview.digit);
      const nextLowConfidence = lowConfidenceRef.current.filter((index) => index !== hintPreview.index);
      if (hasBoardStateChanged(result.grid, result.marks, nextLowConfidence)) {
        recordUndoSnapshot();
      }
      updateGrid(result.grid, result.marks);
      selectOnly(hintPreview.index);
      lowConfidenceRef.current = nextLowConfidence;
      setLowConfidence(nextLowConfidence);
      setMessages([`Applied ${hintPreview.digit} at R${cell.row}C${cell.col}. Request another hint when you are ready.`]);
      maybeAdvanceQuickFillDigit(result.grid, hintPreview.digit);
      return;
    }

    if (currentHint.action.type === "eliminate" && currentHint.action.eliminations.length > 0) {
      const liveGrid = gridRef.current;
      const liveMarks = marksRef.current;

      // With auto-fill on, eliminations are crossed off the auto layer that the
      // player is actually looking at.
      if (autoFill) {
        const nextMarks = {
          ...liveMarks,
          auto: applyHintEliminationsToNotes(liveGrid, liveMarks.auto, currentHint.action.eliminations)
        };
        const firstCell = currentHint.action.eliminations[0].cell;
        if (hasBoardStateChanged(liveGrid, nextMarks)) {
          recordUndoSnapshot();
        }
        updateGrid(liveGrid, nextMarks);
        selectOnly(cellToIndex(firstCell));
        setMessages([
          `Applied ${currentHint.action.eliminations.length} candidate elimination${currentHint.action.eliminations.length === 1 ? "" : "s"}. Request another hint when you are ready.`
        ]);
        return;
      }

      const targetLayer = activeNotesLayer(liveMarks);
      const otherLayer: NoteEntryMode = targetLayer === "corner" ? "center" : "corner";
      const nextMarks = {
        ...liveMarks,
        [targetLayer]: applyHintEliminationsToNotes(liveGrid, liveMarks[targetLayer], currentHint.action.eliminations),
        [otherLayer]: pruneEliminationsFromNotes(liveMarks[otherLayer], currentHint.action.eliminations)
      };
      const firstCell = currentHint.action.eliminations[0].cell;
      if (hasBoardStateChanged(liveGrid, nextMarks)) {
        recordUndoSnapshot();
      }
      updateGrid(liveGrid, nextMarks);
      selectOnly(cellToIndex(firstCell));
      setMessages([
        `Applied ${currentHint.action.eliminations.length} candidate elimination${currentHint.action.eliminations.length === 1 ? "" : "s"}. Request another hint when you are ready.`
      ]);
    }
  }

  function recordHint(nextHint: HintResponse) {
    setCurrentHint(nextHint);
    setHistory((items) => [nextHint, ...items].slice(0, 8));
    setHintsUsed((count) => count + 1);
    setTechniqueNames((names) =>
      names.includes(nextHint.technique.name) ? names : [...names, nextHint.technique.name]
    );
    setMessages(["Hint found. Review the conclusion, then expand through the evidence."]);
  }

  async function hint() {
    if (!isSolving) {
      setMessages(["Start solving before requesting a hint."]);
      return;
    }
    if (!hintReady) {
      setMessages(["The hint engine is still loading. Try again in a moment."]);
      return;
    }

    // l2sg and the verified chain solver find the next logical step. The player's
    // pencil marks are passed through so the hint respects work already done and
    // advances past eliminations the player has applied.
    const liveGrid = gridRef.current;
    const liveMarks = marksRef.current;
    const notes = autoFill
      ? liveGrid.map((value, index) => (value === null ? (liveMarks.auto[index] ?? []) : []))
      : effectiveNotesGrid(liveGrid, liveMarks, noteType);
    setBusyLabel("Finding hint");
    try {
      const result = await getHint(gridToPayload(liveGrid), buildCandidateString(liveGrid, notes));
      if (!result) {
        setMessages(["The hint engine could not find a logical step with its supported techniques. Review the candidates or check the board."]);
        return;
      }

      const response = hintResultToResponse(result);
      // Drop eliminations the player already crossed off so the hint isn't
      // redundant; if every elimination is already applied, still show the step.
      recordHint(withoutAppliedEliminations(response, notes) ?? response);
    } catch (error) {
      setMessages([error instanceof Error ? error.message : "Hint generation failed."]);
    } finally {
      setBusyLabel(null);
    }
  }

  // Clears the per-attempt state shared by starting a solve and loading a puzzle:
  // notes, entry mode, undo/redo, timer, counters, and the active hint.
  function resetSolveProgress() {
    setMarks(createEmptyMarks());
    setEntryMode("value");
    setAutoFill(false);
    setQuickFillDigit(null);
    setCurrentHint(null);
    setUndoStack([]);
    setRedoStack([]);
    setCheckResult(null);
    setPaused(false);
    setElapsedSeconds(0);
    setSolvedAnnounced(false);
    setFinishDismissed(false);
    setHintsUsed(0);
    setChecksUsed(0);
    setTechniqueNames([]);
  }

  function startSolving() {
    if (filledCount === 0 || !validation.valid) {
      return;
    }

    resetSolveProgress();
    setPhase("solving");
    setGivenMask(createGivenMask(grid));
    setQuickFillMode(true);
    setMessages([
      "Solving phase started. Quick fill is on: pick a digit, then press it or Enter on a cell to place it. Loaded cells are locked."
    ]);
  }

  function toggleQuickFillMode() {
    if (!isSolving) {
      setMessages(["Start solving before using quick fill mode."]);
      return;
    }

    const nextQuickFillMode = !quickFillMode;
    setQuickFillMode(nextQuickFillMode);
    if (!nextQuickFillMode) {
      setQuickFillDigit(null);
    }
    setMessages([
      nextQuickFillMode
        ? "Quick fill enabled. Select a digit, then click editable cells to apply it."
        : "Quick fill mode disabled."
    ]);
  }

  function changeEntryMode(mode: EntryMode) {
    if (!isSolving) {
      if (mode !== "value") {
        setMessages(["Start solving before using marking modes."]);
      }
      return;
    }

    setEntryMode(mode);
    if (mode !== "value") {
      if (isNoteEntryMode(mode)) {
        setNoteType(mode);
      }
    }
    setMessages([entryModeMessage(mode)]);
  }

  // The primary mode button: flips between Normal (value) entry and Corner notes
  // (the default note layer). Center and Color are chosen from their own buttons.
  function toggleNoteMode() {
    changeEntryMode(entryMode === "corner" ? "value" : "corner");
  }

  // Independent on/off overlay of computed candidates. The first time it turns on
  // it fills the (empty) auto layer from the board; turning it off and on again
  // keeps whatever the player pruned, so their work is never lost.
  function toggleAutoFill() {
    if (!isSolving) {
      setMessages(["Start solving before using auto-fill."]);
      return;
    }

    const nextAutoFill = !autoFill;
    if (nextAutoFill) {
      const liveMarks = marksRef.current;
      if (liveMarks.auto.every((notes) => notes.length === 0)) {
        commitMarks({ ...liveMarks, auto: quickFillNotes(gridRef.current) });
      }
    }
    setAutoFill(nextAutoFill);
    setMessages([
      nextAutoFill
        ? "Auto-fill on: showing computed candidates. Cross any off and they stay; your own notes are kept underneath."
        : "Auto-fill off: your own notes are back."
    ]);
  }

  function loadPuzzleFromText() {
    try {
      const nextGrid = parsePuzzleText(puzzleText);
      const nextValidation = validateSudokuGrid(nextGrid);
      if (!nextValidation.valid) {
        setMessages(["Pasted puzzle has conflicts. Fix the 81-character string before loading it."]);
        return;
      }

      loadPuzzle(nextGrid, ["Loaded 81 characters. Review the board, then confirm to lock the givens."]);
      setLowConfidence([]);
    } catch (error) {
      setMessages([error instanceof Error ? error.message : "Puzzle text could not be loaded."]);
    }
  }

  async function generatePuzzle() {
    setBusyLabel("Generating puzzle");
    try {
      const generated = await requestGeneratedPuzzle(generatedLevel);
      const nextGrid = parsePuzzleText(generated.puzzle);
      loadPuzzle(
        nextGrid,
        [generatedPuzzleMessage(generated)],
        generatedPuzzleRating(generated)
      );
      setPuzzleText(generated.puzzle);
      setLowConfidence([]);
    } catch (error) {
      setMessages([error instanceof Error ? error.message : "Puzzle generation failed."]);
    } finally {
      setBusyLabel(null);
    }
  }

  function loadPuzzle(
    nextGrid: SudokuGrid,
    nextMessages: string[],
    nextPuzzleRating: PuzzleRating | null = null
  ) {
    resetSolveProgress();
    setGrid(nextGrid);
    setGivenMask(createGivenMask(createEmptyGrid()));
    setPhase("loading");
    setQuickFillMode(false);
    setPuzzleRating(nextPuzzleRating);
    setHistory([]);
    selectOnly(selectedIndex);
    setMessages(nextMessages);
  }

  function canEditCellValue(index: number): boolean {
    return phase === "loading" || !givenMask[index];
  }

  async function importImageFile(file: File, alreadyCropped = false) {
    setBusyLabel("Reading image");
    try {
      const result = await recognizeImage(file, alreadyCropped);
      const applied = applyOcrCells(createEmptyGrid(), result.cells);
      loadPuzzle(applied.grid, result.warnings);
      setLowConfidence(applied.lowConfidence);
    } catch (error) {
      setMessages([error instanceof Error ? error.message : "Image recognition failed."]);
    } finally {
      setBusyLabel(null);
    }
  }

  function loadSample() {
    loadPuzzle(parsePuzzleText(SAMPLE_PUZZLE), ["Loaded a sample puzzle. Review it, then start solving to lock the givens."]);
    setLowConfidence([]);
  }

  function reset() {
    loadPuzzle(createEmptyGrid(), ["Workspace cleared. Start with board entry or image upload."]);
    setLowConfidence([]);
  }

  async function copyShareLink() {
    const shareUrl = createShareUrl();
    if (!shareUrl) {
      setMessages(["Add a valid puzzle before sharing."]);
      return;
    }

    try {
      if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) {
        throw new Error("Clipboard unavailable");
      }
      await navigator.clipboard.writeText(shareUrl);
      setMessages(["Share link copied."]);
    } catch {
      setMessages([`Share link: ${shareUrl}`]);
    }
  }

  function createShareUrl(): string | null {
    if (typeof window === "undefined") {
      return null;
    }

    const puzzleGrid = phase === "solving" ? gridRef.current.map((value, index) => (givenMask[index] ? value : null)) : gridRef.current;
    if (countFilledCells(puzzleGrid) === 0 || !validateSudokuGrid(puzzleGrid).valid) {
      return null;
    }

    const url = new URL(window.location.href);
    url.searchParams.set("p", encodePuzzleParam(puzzleGrid));
    url.hash = "";
    return url.toString();
  }

  function moveSelectionBy(direction: NavDirection, extend = false) {
    // After the selection was cleared, an arrow key re-enters the board at the
    // top-left rather than staying nowhere.
    const next = selectedIndex < 0 ? 0 : moveSelection(selectedIndex, direction);
    setSelectedIndex(next);
    if (extend) {
      setSelectedIndexes((current) => (current.includes(next) ? current : [...current, next]));
    } else {
      setSelectedIndexes([next]);
    }
  }

  function dismissFinish() {
    setFinishDismissed(true);
  }

  function notify(message: string) {
    setMessages([message]);
  }

  return {
    // board state
    grid,
    marks,
    displayMarks,
    givenMask,
    phase,
    isSolving,
    selectedIndex,
    selectedIndexes,
    selectedIndexSet,
    selectedCell,
    selectedIsGiven,
    selectionAllGiven,
    selectionAllFilled,
    selectedNotes,
    filledCount,
    digitCounts,
    lowConfidence,
    // hint state
    currentHint,
    history,
    hintReady,
    hintPreview,
    canApplyCurrentHint,
    primaryIndexes,
    relatedIndexes,
    eliminationIndexes,
    // derived board highlights
    validation,
    conflictIndexes,
    incorrectIndexes,
    matchingHighlights,
    activeHighlightDigit,
    peerHighlightIndexes,
    // session state
    isSolved,
    showFinishDialog,
    finishStats,
    paused,
    elapsedSeconds,
    // ui state
    statusMessages,
    busyLabel,
    entryMode,
    noteType,
    hasAnyNotes,
    autoFill,
    quickFillMode,
    quickFillDigit,
    puzzleText,
    generatedLevel,
    undoStack,
    redoStack,
    settings,
    setSetting,
    canSharePuzzle,
    puzzleRating,
    // actions
    pressDigit,
    clickCell,
    rightClickCell,
    beginCellSelection,
    dragCellSelection,
    endCellSelection,
    clearSelection,
    placeQuickFillAt,
    placeQuickFillOnSelection,
    moveSelectionBy,
    undo,
    redo,
    togglePause,
    check,
    hint,
    applyHint,
    startSolving,
    toggleQuickFillMode,
    changeEntryMode,
    toggleNoteMode,
    toggleAutoFill,
    loadPuzzleFromText,
    generatePuzzle,
    loadSample,
    reset,
    importImageFile,
    copyShareLink,
    dismissFinish,
    notify,
    setPuzzleText,
    setGeneratedLevel
  };
}


function generatedPuzzleRating(generated: GeneratedPuzzleResponse): PuzzleRating | null {
  if (Number.isFinite(generated.se_rating) && generated.se_rating > 0) {
    return { label: `SE ${generated.se_rating.toFixed(1)}` };
  }
  if (generated.level.name) {
    return { label: generated.level.name };
  }
  return null;
}
