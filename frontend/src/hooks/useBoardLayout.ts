"use client";

import { useLayoutEffect, useRef } from "react";

/** Fit the desktop board and its controls into the column's actual height. */
export function useBoardLayout(isSolving: boolean) {
  const columnRef = useRef<HTMLElement>(null);
  const stackRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const column = columnRef.current;
    const stack = stackRef.current;
    if (!column || !stack || typeof ResizeObserver === "undefined") return;
    let frame = 0;

    const fit = () => {
      if (!window.matchMedia("(min-width: 981px)").matches) {
        stack.style.removeProperty("--board-size");
        return;
      }
      const children = Array.from(stack.children) as HTMLElement[];
      const controlsHeight = children.filter(child => !child.classList.contains("board-wrap"))
        .reduce((height, child) => height + child.getBoundingClientRect().height, 0);
      const gaps = (parseFloat(getComputedStyle(stack).rowGap) || 0) * Math.max(0, children.length - 1);
      const size = Math.max(0, Math.min(560, column.clientWidth, column.clientHeight - controlsHeight - gaps));
      stack.style.setProperty("--board-size", `${Math.floor(size)}px`);
    };

    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(fit);
    });
    observer.observe(column);
    // A rating, font load, or toolbar change can alter the space reserved for
    // controls even when the viewport itself has not resized.
    for (const child of Array.from(stack.children)) {
      if (!child.classList.contains("board-wrap")) observer.observe(child);
    }
    fit();
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      stack.style.removeProperty("--board-size");
    };
  }, [isSolving]);

  return { columnRef, stackRef };
}
