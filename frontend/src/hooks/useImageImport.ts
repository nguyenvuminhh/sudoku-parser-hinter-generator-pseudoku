"use client";

import { ChangeEvent, DragEvent, useEffect, useRef, useState } from "react";

import { firstImageFile } from "../lib/dom";
import type { SudokuGame } from "./useSudokuGame";

export function useImageImport(game: SudokuGame) {
  const [isDraggingImage, setIsDraggingImage] = useState(false);
  const [pendingImage, setPendingImage] = useState<File | null>(null);
  const pendingRef = useRef<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const gameRef = useRef(game);
  gameRef.current = game;

  function prepareImage(file: File) {
    if (pendingRef.current || gameRef.current.busyLabel || gameRef.current.phase !== "loading") return;
    pendingRef.current = file;
    setPendingImage(file);
  }

  function cancelCrop() {
    pendingRef.current = null;
    setPendingImage(null);
  }

  function importCrop(file: File) {
    cancelCrop();
    void gameRef.current.importImageFile(file, true);
  }

  useEffect(() => {
    function handleWindowPaste(event: globalThis.ClipboardEvent) {
      const current = gameRef.current;
      if (current.phase !== "loading" || current.busyLabel) {
        return;
      }

      const file = firstImageFile(event.clipboardData);
      if (file) {
        event.preventDefault();
        prepareImage(file);
      }
    }

    window.addEventListener("paste", handleWindowPaste);
    return () => window.removeEventListener("paste", handleWindowPaste);
  }, []);

  function openFilePicker() {
    fileInputRef.current?.click();
  }

  function handleUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) {
      prepareImage(file);
    }
    event.target.value = "";
  }

  function handleDragOver(event: DragEvent<HTMLElement>) {
    if (game.phase !== "loading" || game.busyLabel || !Array.from(event.dataTransfer.types).includes("Files")) {
      return;
    }
    event.preventDefault();
    setIsDraggingImage(true);
  }

  function handleDragLeave(event: DragEvent<HTMLElement>) {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) {
      return;
    }
    setIsDraggingImage(false);
  }

  function handleDrop(event: DragEvent<HTMLElement>) {
    if (game.phase !== "loading") {
      return;
    }
    event.preventDefault();
    setIsDraggingImage(false);
    const file = firstImageFile(event.dataTransfer);
    if (file) {
      prepareImage(file);
    } else {
      game.notify("Drop a PNG or JPG screenshot of a Sudoku grid.");
    }
  }

  return {
    pendingImage,
    cancelCrop,
    importCrop,
    isDraggingImage,
    fileInputRef,
    openFilePicker,
    handleUpload,
    handleDragOver,
    handleDragLeave,
    handleDrop
  };
}
