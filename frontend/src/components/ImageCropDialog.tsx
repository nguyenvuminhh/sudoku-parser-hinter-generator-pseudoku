"use client";

import { useEffect, useRef, useState, type PointerEvent } from "react";
import { Crop, X } from "lucide-react";
import { detectBoardLocally } from "../lib/ocr-client";
import type { Bounds } from "../lib/ocr-processing";

const FULL_IMAGE: Bounds = { x: 0, y: 0, width: 1, height: 1 };
const MIN_SIDE = .04;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
type Corner = "nw" | "ne" | "sw" | "se";
type Gesture = { x: number; y: number; crop: Bounds; mode: Corner | "move" | "draw" };

export function ImageCropDialog({ file, onImport, onCancel }: {
  file: File;
  onImport: (file: File) => void;
  onCancel: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const edited = useRef(false);
  const gesture = useRef<Gesture | null>(null);
  const active = useRef(true);
  const [url, setUrl] = useState<string | null>(null);
  const [crop, setCrop] = useState<Bounds>(FULL_IMAGE);
  const [status, setStatus] = useState("Finding the board on your device…");
  const [loaded, setLoaded] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    active.current = true;
    const preview = URL.createObjectURL(file);
    setUrl(preview);
    const dialog = dialogRef.current;
    dialog?.showModal();
    let canceled = false;
    void detectBoardLocally(file).then(bounds => {
      if (canceled) return;
      if (bounds && !edited.current) setCrop(bounds);
      setStatus(bounds ? "Board found. Adjust the crop if needed." : "Couldn’t suggest a crop. Select the board, or choose No crop.");
    }).catch(() => {
      if (!canceled) setStatus("Couldn’t suggest a crop. Select the board, or choose No crop.");
    });
    return () => {
      canceled = true;
      active.current = false;
      dialog?.close();
      URL.revokeObjectURL(preview);
    };
  }, [file]);

  function changeCrop(next: Bounds) {
    edited.current = true;
    setCrop(next);
  }

  function point(event: PointerEvent) {
    const rect = stageRef.current!.getBoundingClientRect();
    return { x: clamp((event.clientX - rect.left) / rect.width, 0, 1), y: clamp((event.clientY - rect.top) / rect.height, 0, 1) };
  }

  function start(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || exporting) return;
    event.preventDefault();
    const target = event.target as HTMLElement;
    const corner = target.closest<HTMLElement>("[data-corner]")?.dataset.corner as Corner | undefined;
    gesture.current = { ...point(event), crop, mode: corner ?? (target.closest(".crop-selection") ? "move" : "draw") };
    event.currentTarget.setPointerCapture(event.pointerId);
    edited.current = true;
  }

  function move(event: PointerEvent<HTMLDivElement>) {
    const drag = gesture.current;
    if (!drag) return;
    const current = point(event), original = drag.crop;
    if (drag.mode === "move") {
      changeCrop({ ...original, x: clamp(original.x + current.x - drag.x, 0, 1 - original.width), y: clamp(original.y + current.y - drag.y, 0, 1 - original.height) });
      return;
    }
    let left = original.x, top = original.y, right = left + original.width, bottom = top + original.height;
    if (drag.mode === "draw") {
      left = Math.min(drag.x, current.x); top = Math.min(drag.y, current.y);
      right = Math.max(drag.x, current.x); bottom = Math.max(drag.y, current.y);
      left = Math.min(left, 1 - MIN_SIDE); top = Math.min(top, 1 - MIN_SIDE);
      right = Math.max(right, left + MIN_SIDE); bottom = Math.max(bottom, top + MIN_SIDE);
    } else {
      if (drag.mode.includes("w")) left = clamp(current.x, 0, right - MIN_SIDE);
      if (drag.mode.includes("e")) right = clamp(current.x, left + MIN_SIDE, 1);
      if (drag.mode.includes("n")) top = clamp(current.y, 0, bottom - MIN_SIDE);
      if (drag.mode.includes("s")) bottom = clamp(current.y, top + MIN_SIDE, 1);
    }
    changeCrop({ x: left, y: top, width: right - left, height: bottom - top });
  }

  function setEdge(edge: "left" | "top" | "right" | "bottom", value: number) {
    if (!Number.isFinite(value)) return;
    let left = crop.x, top = crop.y, right = left + crop.width, bottom = top + crop.height;
    if (edge === "left") left = clamp(value, 0, right - MIN_SIDE);
    if (edge === "right") right = clamp(value, left + MIN_SIDE, 1);
    if (edge === "top") top = clamp(value, 0, bottom - MIN_SIDE);
    if (edge === "bottom") bottom = clamp(value, top + MIN_SIDE, 1);
    changeCrop({ x: left, y: top, width: right - left, height: bottom - top });
  }

  async function useCrop() {
    const image = imageRef.current;
    if (!image || !loaded || exporting) return;
    setExporting(true); setError(null);
    try {
      const canvas = document.createElement("canvas");
      const x = Math.floor(crop.x * image.naturalWidth), y = Math.floor(crop.y * image.naturalHeight);
      canvas.width = Math.max(1, Math.ceil((crop.x + crop.width) * image.naturalWidth) - x);
      canvas.height = Math.max(1, Math.ceil((crop.y + crop.height) * image.naturalHeight) - y);
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Could not crop this image. Try No crop.");
      context.fillStyle = "white";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, x, y, canvas.width, canvas.height, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error("Could not crop this image. Try No crop.")), "image/png"));
      if (active.current) onImport(new File([blob], "sudoku-crop.png", { type: "image/png" }));
    } catch (cause) {
      if (active.current) setError(cause instanceof Error ? cause.message : "Could not crop this image.");
    } finally { if (active.current) setExporting(false); }
  }

  return (
    <dialog ref={dialogRef} className="crop-dialog" aria-labelledby="crop-title" aria-describedby="crop-help" onCancel={event => { event.preventDefault(); onCancel(); }}>
      <div className="crop-heading">
        <h2 id="crop-title"><Crop size={22} /> Crop Sudoku image</h2>
        <button type="button" className="btn ghost crop-close" onClick={onCancel} aria-label="Close cropper"><X size={18} /></button>
      </div>
      <p id="crop-help">Keep all 81 cells inside the crop. Drag the corners to resize, or drag inside to move.</p>
      <p className="crop-status" role="status">{status}</p>
      <div className="crop-preview">
        <div ref={stageRef} className="crop-stage" onPointerDown={start} onPointerMove={move}
          onPointerUp={() => { gesture.current = null; }} onPointerCancel={() => { gesture.current = null; }} onLostPointerCapture={() => { gesture.current = null; }}>
          {url ? <img ref={imageRef} src={url} alt="Uploaded Sudoku to crop" draggable={false} onLoad={() => setLoaded(true)} onError={() => setError("Could not open this image. Try another PNG or JPG.")} /> : null}
          {loaded ? <div className="crop-selection" style={{ left: `${crop.x * 100}%`, top: `${crop.y * 100}%`, width: `${crop.width * 100}%`, height: `${crop.height * 100}%` }}>
            <div className="crop-guide" />
            {(["nw", "ne", "sw", "se"] as const).map(corner => <span key={corner} className={`crop-handle crop-${corner}`} data-corner={corner} />)}
          </div> : null}
        </div>
      </div>
      <div className="crop-edges" aria-label="Crop boundaries">
        {([['left', crop.x], ['top', crop.y], ['right', crop.x + crop.width], ['bottom', crop.y + crop.height]] as const).map(([edge, value]) => (
          <label key={edge}>{edge} (%)<input type="number" aria-label={`Crop ${edge} (%)`} min={0} max={100} step={.1} value={Math.round(value * 1000) / 10} disabled={exporting}
            onChange={event => { if (event.target.value !== "") setEdge(edge, Number(event.target.value) / 100); }} /></label>
        ))}
      </div>
      {error ? <p role="alert">{error}</p> : null}
      <div className="crop-actions">
        <button type="button" className="btn ghost" onClick={onCancel}>Cancel</button>
        <button type="button" className="btn ghost" disabled={exporting} onClick={() => onImport(file)}>No crop — already cropped</button>
        <button type="button" className="btn primary" disabled={!loaded || exporting} onClick={() => void useCrop()}>{exporting ? "Cropping…" : "Use crop"}</button>
      </div>
      <p className="crop-privacy">Your image stays on this device. Review the digits after import.</p>
    </dialog>
  );
}
