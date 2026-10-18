"use client";

import { Check } from "lucide-react";

import type { HintResponse } from "../lib/puzzle-services";

export function HintPanel({
  canApplyHint,
  hint,
  onApplyHint
}: {
  canApplyHint: boolean;
  hint: HintResponse | null;
  onApplyHint: () => void;
}) {
  if (!hint) {
    return null;
  }

  return (
    <div className="hint-detail">
      <div className="technique-row">
        <span>{hint.technique.name}</span>
        <small>Rank {hint.technique.rank}</small>
      </div>
      <h3>{hint.summary}</h3>
      <div className="explanation-stack">
        {hint.explanation.map((step, index) => (
          <p key={`${step}-${index}`}>
            <span>{index + 1}</span>
            {step}
          </p>
        ))}
      </div>
      {hint.action.eliminations.length > 0 ? (
        <div className="elimination-list">
          <strong>Eliminations</strong>
          <p>
            {hint.action.eliminations
              .slice(0, 6)
              .map((item) => `R${item.cell.row}C${item.cell.col} - ${item.digit}`)
              .join(", ")}
          </p>
        </div>
      ) : null}
      <button type="button" className="btn primary full" onClick={onApplyHint} disabled={!canApplyHint}>
        <Check size={16} />
        <span>Apply this step</span>
      </button>
    </div>
  );
}
