"use client";

import { Lightbulb, ListChecks, PartyPopper, RotateCcw, Timer, X } from "lucide-react";

import { formatElapsedSeconds } from "../lib/time";

export type FinishStats = {
  elapsedSeconds: number;
  hintsUsed: number;
  checksUsed: number;
  givens: number;
  filledByYou: number;
  techniques: string[];
};

export function FinishDialog({
  stats,
  onNewPuzzle,
  onClose
}: {
  stats: FinishStats;
  onNewPuzzle: () => void;
  onClose: () => void;
}) {
  return (
    <div className="finish-backdrop" role="dialog" aria-modal="true" aria-label="Puzzle solved">
      <div className="finish-card">
        <div className="finish-header">
          <PartyPopper size={26} />
          <h2>Puzzle solved!</h2>
          <p>Every cell checks out. Here is how the solve went.</p>
        </div>
        <dl className="finish-stats">
          <div>
            <dt>
              <Timer size={15} />
              Time
            </dt>
            <dd>{formatElapsedSeconds(stats.elapsedSeconds)}</dd>
          </div>
          <div>
            <dt>
              <Lightbulb size={15} />
              Hints used
            </dt>
            <dd>{stats.hintsUsed}</dd>
          </div>
          <div>
            <dt>
              <ListChecks size={15} />
              Checks used
            </dt>
            <dd>{stats.checksUsed}</dd>
          </div>
          <div>
            <dt>Givens</dt>
            <dd>{stats.givens}</dd>
          </div>
          <div>
            <dt>Cells you filled</dt>
            <dd>{stats.filledByYou}</dd>
          </div>
        </dl>
        {stats.techniques.length > 0 ? (
          <div className="finish-techniques">
            <h3>Techniques from your hints</h3>
            <ul>
              {stats.techniques.map((technique) => (
                <li key={technique}>{technique}</li>
              ))}
            </ul>
          </div>
        ) : null}
        <div className="finish-actions">
          <button type="button" className="primary" onClick={onNewPuzzle}>
            <RotateCcw size={17} />
            New puzzle
          </button>
          <button type="button" onClick={onClose}>
            <X size={17} />
            Keep the board
          </button>
        </div>
      </div>
    </div>
  );
}
