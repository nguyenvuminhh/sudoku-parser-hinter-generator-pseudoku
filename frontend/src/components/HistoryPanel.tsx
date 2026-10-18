"use client";

import type { HintResponse } from "../lib/puzzle-services";

export function HistoryPanel({ history }: { history: HintResponse[] }) {
  if (history.length === 0) {
    return <p className="disc-empty">Hints you request will appear here for review.</p>;
  }

  return (
    <ol className="history-list">
      {history.map((hint, index) => (
        <li key={`${hint.technique.id}-${index}`}>
          <span>{hint.technique.name}</span>
          <p>{hint.summary}</p>
        </li>
      ))}
    </ol>
  );
}
