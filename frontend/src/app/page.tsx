"use client";

import { Check, CircleAlert, Gauge, Pause, PartyPopper, Play, Timer } from "lucide-react";

import { FinishDialog } from "../components/FinishDialog";
import { ImageCropDialog } from "../components/ImageCropDialog";
import { Keypad } from "../components/Keypad";
import { LoadingControls } from "../components/LoadingControls";
import { SolvingControls } from "../components/SolvingControls";
import { SolvingPanel } from "../components/SolvingPanel";
import { SudokuBoard } from "../components/SudokuBoard";
import { TopBar } from "../components/TopBar";
import { useClickOutsideBoard } from "../hooks/useClickOutsideBoard";
import { useBoardLayout } from "../hooks/useBoardLayout";
import { useImageImport } from "../hooks/useImageImport";
import { useKeyboardShortcuts } from "../hooks/useKeyboardShortcuts";
import { useSudokuGame } from "../hooks/useSudokuGame";
import { useTheme } from "../hooks/useTheme";
import { formatElapsedSeconds } from "../lib/time";

export default function PseudokuPage() {
  const game = useSudokuGame();
  const boardLayout = useBoardLayout(game.isSolving);
  const { theme, toggleTheme } = useTheme();
  const imageImport = useImageImport(game);
  useKeyboardShortcuts(game);
  useClickOutsideBoard(game);

  const conflicts = game.conflictIndexes.size;
  const latestStatus = game.statusMessages[game.statusMessages.length - 1];

  return (
    <main className="app-shell">
      <TopBar theme={theme} onToggleTheme={toggleTheme} />

      <div className="stage">
        <section className="board-col" aria-label="Sudoku board" ref={boardLayout.columnRef}>
          <div className="board-stack" ref={boardLayout.stackRef}>
            {game.isSolving ? (
              <div className="board-status">
                <span
                  className={conflicts > 0 ? "bs-warn" : "bs-ok"}
                  aria-live="polite"
                  aria-label={conflicts > 0 ? `${conflicts} conflicts` : "No conflicts"}
                >
                  {conflicts > 0 ? <CircleAlert size={14} /> : <Check size={14} />}
                  {conflicts > 0 ? `${conflicts} ${conflicts === 1 ? "conflict" : "conflicts"}` : "No conflicts"}
                </span>
                <span className="bs-right">
                  {game.puzzleRating ? (
                    <span className="bs-rating" aria-label={`Puzzle rating ${game.puzzleRating.label}`}>
                      <Gauge size={14} />
                      {game.puzzleRating.label}
                    </span>
                  ) : null}
                  <span className="bs-timer" role="timer" aria-label={`Elapsed time ${formatElapsedSeconds(game.elapsedSeconds)}`}>
                    <Timer size={14} />
                    {formatElapsedSeconds(game.elapsedSeconds)}
                  </span>
                  <button
                    type="button"
                    className="bs-pause"
                    onClick={game.togglePause}
                    disabled={game.isSolved}
                    aria-label={game.paused ? "Resume the solve clock" : "Pause the solve clock"}
                  >
                    {game.paused ? <Play size={15} /> : <Pause size={15} />}
                  </button>
                </span>
              </div>
            ) : null}

            <div className="board-wrap">
              <SudokuBoard
                grid={game.grid}
                marks={game.displayMarks}
                givenMask={game.givenMask}
                isSolving={game.isSolving}
                ghost={!game.isSolving && game.filledCount === 0}
                selectedIndex={game.selectedIndex}
                selectedIndexSet={game.selectedIndexSet}
                activeHighlightDigit={game.activeHighlightDigit}
                lowConfidence={game.lowConfidence}
                hintPreview={game.hintPreview}
                highlights={{
                  conflictIndexes: game.conflictIndexes,
                  incorrectIndexes: game.incorrectIndexes,
                  primaryIndexes: game.primaryIndexes,
                  relatedIndexes: game.relatedIndexes,
                  eliminationIndexes: game.eliminationIndexes,
                  matchingValueIndexes: game.matchingHighlights.valueIndexes,
                  peerIndexes: game.peerHighlightIndexes
                }}
                paused={game.paused}
                onCellPointerDown={game.beginCellSelection}
                onCellPointerEnter={game.dragCellSelection}
                onCellPointerUp={game.endCellSelection}
                onCellClick={game.clickCell}
                onCellContextMenu={game.rightClickCell}
              />
              {game.paused ? (
                <div className="board-overlay" role="status">
                  <p>Paused</p>
                  <button type="button" onClick={game.togglePause}>
                    <Play size={17} />
                    Resume
                  </button>
                </div>
              ) : null}
              {game.isSolved && !game.showFinishDialog ? (
                <div className="solve-banner" role="status">
                  <PartyPopper size={18} />
                  Solved in {formatElapsedSeconds(game.elapsedSeconds)}
                </div>
              ) : null}
            </div>

            {game.isSolving ? (
              <>
                <SolvingControls
                  busyLabel={game.busyLabel}
                  canUndo={game.undoStack.length > 0}
                  canRedo={game.redoStack.length > 0}
                  entryMode={game.entryMode}
                  autoFill={game.autoFill}
                  quickFillMode={game.quickFillMode}
                  isValid={game.validation.valid}
                  canShare={game.canSharePuzzle}
                  onUndo={game.undo}
                  onRedo={game.redo}
                  onEntryModeChange={game.changeEntryMode}
                  onToggleNoteMode={game.toggleNoteMode}
                  onToggleQuickFill={game.toggleQuickFillMode}
                  onToggleAutoFill={game.toggleAutoFill}
                  onCheck={game.check}
                  onShare={() => void game.copyShareLink()}
                  onNewPuzzle={game.reset}
                />
                <Keypad
                  digitCounts={game.digitCounts}
                  selectedNotes={game.selectedNotes}
                  quickFillDigit={game.quickFillDigit}
                  quickFillMode={game.quickFillMode}
                  entryMode={game.entryMode}
                  isSolving={game.isSolving}
                  selectionAllGiven={game.selectionAllGiven}
                  selectionAllFilled={game.selectionAllFilled}
                  showRemainingCounts={game.settings.showRemainingCounts}
                  onDigit={game.pressDigit}
                />
              </>
            ) : null}
          </div>
        </section>

        <aside className="panel-col" aria-label="Hint explanation">
          {game.phase === "loading" ? (
            <LoadingControls
              puzzleText={game.puzzleText}
              puzzleTextLength={game.puzzleText.replace(/[^0-9.]/g, "").length}
              filledCount={game.filledCount}
              puzzleRating={game.puzzleRating}
              generatedLevel={game.generatedLevel}
              busyLabel={game.busyLabel}
              canConfirm={game.filledCount > 0 && game.validation.valid}
              statusMessage={latestStatus}
              isDraggingImage={imageImport.isDraggingImage}
              onPuzzleTextChange={game.setPuzzleText}
              onGeneratedLevelChange={game.setGeneratedLevel}
              onGeneratePuzzle={() => void game.generatePuzzle()}
              onLoadPuzzleText={game.loadPuzzleFromText}
              onLoadSample={game.loadSample}
              onUploadClick={imageImport.openFilePicker}
              onConfirm={game.startSolving}
              onShare={() => void game.copyShareLink()}
              onEdit={game.reset}
              onDragOver={imageImport.handleDragOver}
              onDragLeave={imageImport.handleDragLeave}
              onDrop={imageImport.handleDrop}
            />
          ) : (
            <SolvingPanel
              statusMessages={game.statusMessages}
              busyLabel={game.busyLabel}
              currentHint={game.currentHint}
              canApplyCurrentHint={game.canApplyCurrentHint}
              filledCount={game.filledCount}
              autoFill={game.autoFill}
              quickFillMode={game.quickFillMode}
              isValid={game.validation.valid}
              canShare={game.canSharePuzzle}
              hintReady={game.hintReady}
              history={game.history}
              settings={game.settings}
              onToggleQuickFill={game.toggleQuickFillMode}
              onToggleAutoFill={game.toggleAutoFill}
              onCheck={game.check}
              onShare={() => void game.copyShareLink()}
              onQuit={game.reset}
              onApplyHint={game.applyHint}
              onHint={() => void game.hint()}
              onSettingChange={game.setSetting}
            />
          )}
        </aside>
      </div>

      <input
        ref={imageImport.fileInputRef}
        className="hidden-input"
        type="file"
        accept="image/*"
        onChange={(event) => void imageImport.handleUpload(event)}
      />

      {imageImport.pendingImage ? (
        <ImageCropDialog file={imageImport.pendingImage} onImport={imageImport.importCrop} onCancel={imageImport.cancelCrop} />
      ) : null}

      {game.showFinishDialog ? (
        <FinishDialog
          stats={game.finishStats}
          onNewPuzzle={game.reset}
          onClose={game.dismissFinish}
        />
      ) : null}
    </main>
  );
}
