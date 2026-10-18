"use client";

import { CircleHelp, Maximize, Minimize, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useFullscreen } from "../hooks/useFullscreen";

export function FullscreenControl() {
  const fullscreen = useFullscreen();
  const dialog = useRef<HTMLDialogElement>(null);
  const guideTrigger = useRef<HTMLButtonElement | null>(null);
  const [guideOpen, setGuideOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (guideOpen && !dialog.current?.open) dialog.current?.showModal();
    if (!guideOpen && dialog.current?.open) dialog.current.close();
  }, [guideOpen]);

  async function toggleFullscreen() {
    if (!fullscreen.supported) {
      setGuideOpen(true);
      return;
    }
    setGuideOpen(false);
    // Close synchronously so fullscreen is requested in the original tap gesture.
    dialog.current?.close();
    setError(null);
    try {
      await fullscreen.toggle();
    } catch {
      setError("Your browser couldn’t enter full screen. Try again, or use the Home Screen instructions below.");
      setGuideOpen(true);
    }
  }

  const label = fullscreen.active ? "Exit full screen" : fullscreen.supported ? "Enter full screen" : "Full screen options";

  return (
    <div className="screen-actions" onKeyDown={event => event.stopPropagation()}>
      <button type="button" className="theme-pill fullscreen-toggle" aria-label={label}
        title={label} onClick={event => { guideTrigger.current = event.currentTarget; void toggleFullscreen(); }}>
        {fullscreen.active ? <Minimize size={16} /> : <Maximize size={16} />}
        <span>{fullscreen.active ? "Exit full screen" : "Full screen"}</span>
      </button>
      <button type="button" className="theme-pill screen-help" aria-label="Full screen instructions"
        title="Full screen instructions" onClick={event => { guideTrigger.current = event.currentTarget; setGuideOpen(true); }}>
        <CircleHelp size={16} />
      </button>

      <dialog ref={dialog} className="screen-guide" aria-labelledby="screen-guide-title"
        aria-describedby="screen-guide-intro" onClose={() => {
          if (!dialog.current?.open) {
            setGuideOpen(false);
            guideTrigger.current?.focus({ preventScroll: true });
          }
        }}
        onClick={event => { if (event.target === event.currentTarget) setGuideOpen(false); }}>
        <div className="screen-guide-heading">
          <h2 id="screen-guide-title">Full screen &amp; Home Screen</h2>
          <button type="button" className="screen-guide-close" aria-label="Close screen instructions"
            onClick={() => setGuideOpen(false)}><X size={20} /></button>
        </div>
        <p id="screen-guide-intro">Give your Sudoku board more room by hiding the browser controls.</p>
        {error ? <p role="alert" className="screen-guide-error">{error}</p> : null}
        {fullscreen.standalone ? <p role="status">You’re already using the Home Screen app. Your phone may still show its status bar.</p> : null}
        {fullscreen.supported ? (
          <section aria-labelledby="screen-guide-now">
            <h3 id="screen-guide-now">Full screen now</h3>
            <p>Use the button below. To leave, tap Exit full screen, use your phone’s Back gesture, or press Esc on a keyboard.</p>
            <button type="button" className="screen-guide-primary" onClick={() => void toggleFullscreen()}>
              {fullscreen.active ? "Exit full screen" : "Enter full screen"}
            </button>
          </section>
        ) : <p>This browser doesn’t offer a full screen button. Use the Home Screen option below.</p>}
        <section aria-labelledby="screen-guide-ios">
          <h3 id="screen-guide-ios">iPhone / iPad</h3>
          <ol>
            <li>Open Pseudoku in <strong>Safari</strong> and open the <strong>Share</strong> menu.</li>
            <li>Choose <strong>Add to Home Screen</strong>.</li>
            <li>Turn on <strong>Open as Web App</strong> if shown, then tap <strong>Add</strong>.</li>
            <li>Launch Pseudoku using its new Home Screen icon.</li>
          </ol>
          <p>Safari’s address bar will be hidden. The system status bar may remain.</p>
        </section>
        <section aria-labelledby="screen-guide-android">
          <h3 id="screen-guide-android">Android</h3>
          <ol>
            <li>Open Pseudoku in <strong>Chrome</strong> and tap the <strong>⋮</strong> menu.</li>
            <li>Choose <strong>Add to Home screen</strong> or <strong>Install app</strong>, then confirm. Wording varies by browser.</li>
            <li>Launch Pseudoku using its new Home Screen icon.</li>
          </ol>
          <p>If installation isn’t offered, use the Full screen button when available.</p>
        </section>
      </dialog>
    </div>
  );
}
