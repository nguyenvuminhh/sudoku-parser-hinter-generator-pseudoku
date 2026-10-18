"use client";

import { useEffect, useRef } from "react";

import type { EntryMode } from "../lib/constants";
import { isEditableTarget } from "../lib/dom";
import { resolveKeyboardInput, resolveNavigationKey } from "../lib/sudoku-state";
import type { SudokuGame } from "./useSudokuGame";

const MODE_KEYS: Record<string, EntryMode> = {
  z: "value",
  x: "corner",
  c: "center",
  v: "color"
};

export function useKeyboardShortcuts(game: SudokuGame) {
  const gameRef = useRef(game);
  gameRef.current = game;

  useEffect(() => {
    function handleWindowKeyDown(event: globalThis.KeyboardEvent) {
      const current = gameRef.current;
      if (isEditableTarget(event.target) || document.querySelector("dialog[open]")) {
        return;
      }

      // Ctrl/Cmd+Z undoes the last board change.
      if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "z") {
        event.preventDefault();
        current.undo();
        return;
      }

      // Ctrl/Cmd+Y or Ctrl/Cmd+Shift+Z redoes the last undone change.
      if (
        (event.ctrlKey || event.metaKey) &&
        !event.altKey &&
        ((event.key.toLowerCase() === "y" && !event.shiftKey) || (event.key.toLowerCase() === "z" && event.shiftKey))
      ) {
        event.preventDefault();
        current.redo();
        return;
      }

      if (event.altKey || event.ctrlKey || event.metaKey) {
        return;
      }

      // Tab toggles between Normal and Note entry while solving.
      if (event.key === "Tab") {
        if (current.isSolving) {
          event.preventDefault();
          current.toggleNoteMode();
        }
        return;
      }

      // P pauses or resumes the solve clock.
      if (event.key.toLowerCase() === "p") {
        if (current.isSolving) {
          event.preventDefault();
          current.togglePause();
        }
        return;
      }

      // Z, X, C, V select the entry mode directly while solving.
      const mode = MODE_KEYS[event.key.toLowerCase()];
      if (mode && !event.shiftKey) {
        if (current.isSolving) {
          event.preventDefault();
          current.changeEntryMode(mode);
        }
        return;
      }

      // Arrow keys and WASD move the cell selection; Shift extends it.
      const direction = resolveNavigationKey(event.key);
      if (direction) {
        event.preventDefault();
        current.moveSelectionBy(direction, event.shiftKey);
        return;
      }

      // Enter applies the locked quick-fill digit to the selection.
      if (event.key === "Enter") {
        if (current.quickFillMode && current.quickFillDigit !== null) {
          event.preventDefault();
          current.placeQuickFillOnSelection();
        }
        return;
      }

      const value = resolveKeyboardInput(event.key);
      if (value === "ignored") {
        return;
      }

      event.preventDefault();
      current.pressDigit(value);
    }

    window.addEventListener("keydown", handleWindowKeyDown);
    return () => window.removeEventListener("keydown", handleWindowKeyDown);
  }, []);
}
