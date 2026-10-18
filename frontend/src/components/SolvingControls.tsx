"use client";

import {
  AlignCenter,
  MoreHorizontal,
  Palette,
  Pencil,
  PenLine,
  Redo2,
  Undo2
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type { EntryMode } from "../lib/constants";
import { PuzzleActions } from "./PuzzleActions";

export function SolvingControls({
  busyLabel,
  canUndo,
  canRedo,
  entryMode,
  autoFill,
  quickFillMode,
  isValid,
  canShare,
  onUndo,
  onRedo,
  onEntryModeChange,
  onToggleNoteMode,
  onToggleQuickFill,
  onToggleAutoFill,
  onCheck,
  onShare,
  onNewPuzzle
}: {
  busyLabel: string | null;
  canUndo: boolean;
  canRedo: boolean;
  entryMode: EntryMode;
  autoFill: boolean;
  quickFillMode: boolean;
  isValid: boolean;
  canShare: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onEntryModeChange: (mode: EntryMode) => void;
  onToggleNoteMode: () => void;
  onToggleQuickFill: () => void;
  onToggleAutoFill: () => void;
  onCheck: () => void;
  onShare: () => void;
  onNewPuzzle: () => void;
}) {
  const busy = Boolean(busyLabel);
  const [moreOpen, setMoreOpen] = useState(false);
  const barRef = useRef<HTMLDivElement>(null);

  // Close the ⋯ More popover on any pointerdown outside the toolbar. The
  // listener only flips state, so the outside click still reaches its target
  // (e.g. a board cell) on the same gesture.
  useEffect(() => {
    if (!moreOpen) {
      return;
    }
    function handlePointerDown(event: PointerEvent) {
      if (barRef.current && !barRef.current.contains(event.target as Node)) {
        setMoreOpen(false);
      }
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [moreOpen]);

  // Center and Color are explicit, secondary choices; Normal⇄Corner is the
  // primary toggle handled separately below.
  const secondaryModes: Array<{ mode: EntryMode; label: string; icon: React.ReactNode }> = [
    { mode: "center", label: "Center", icon: <AlignCenter size={16} /> },
    { mode: "color", label: "Color", icon: <Palette size={16} /> }
  ];

  return (
    <div className="entry-bar" ref={barRef} aria-label="Solving controls">
      <div className="eb-group">
        <button
          type="button"
          className="eb-btn"
          aria-label="Undo last board change"
          disabled={!canUndo || busy}
          onClick={onUndo}
        >
          <Undo2 size={16} />
        </button>
        <button
          type="button"
          className="eb-btn"
          aria-label="Redo last undone change"
          disabled={!canRedo || busy}
          onClick={onRedo}
        >
          <Redo2 size={16} />
        </button>
      </div>

      <div className="eb-div" aria-hidden="true" />

      <div className="eb-group modes">
        <button
          type="button"
          className={entryMode === "corner" ? "eb-btn mode on" : "eb-btn mode"}
          aria-pressed={entryMode === "corner"}
          aria-label={entryMode === "corner" ? "Switch to normal entry" : "Switch to corner notes"}
          onClick={onToggleNoteMode}
        >
          {entryMode === "corner" ? <PenLine size={16} /> : <Pencil size={16} />}
          <span>{entryMode === "corner" ? "Corner" : "Normal"}</span>
        </button>
        {secondaryModes.map((entry) => (
          <button
            key={entry.mode}
            type="button"
            className={entryMode === entry.mode ? "eb-btn mode on" : "eb-btn mode"}
            aria-pressed={entryMode === entry.mode}
            onClick={() => onEntryModeChange(entry.mode)}
          >
            {entry.icon}
            <span>{entry.label}</span>
          </button>
        ))}
      </div>

      <div className="eb-div mobile-more-divider" aria-hidden="true" />

      <button
        type="button"
        className={moreOpen ? "eb-btn more mobile-more-trigger on" : "eb-btn more mobile-more-trigger"}
        aria-label="More tools"
        aria-expanded={moreOpen}
        onClick={() => setMoreOpen((open) => !open)}
      >
        <MoreHorizontal size={16} />
      </button>

      {moreOpen ? (
        <PuzzleActions
          variant="mobile"
          busyLabel={busyLabel}
          autoFill={autoFill}
          quickFillMode={quickFillMode}
          isValid={isValid}
          canShare={canShare}
          onToggleQuickFill={onToggleQuickFill}
          onToggleAutoFill={onToggleAutoFill}
          onCheck={onCheck}
          onShare={onShare}
          onQuit={onNewPuzzle}
        />
      ) : null}
    </div>
  );
}
