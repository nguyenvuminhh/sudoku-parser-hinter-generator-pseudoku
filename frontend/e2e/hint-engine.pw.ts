import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { HintResult } from "../src/lib/hintEngine";
import { verifyChainProof } from "../src/lib/advanced-hints";

const fixture = JSON.parse(readFileSync(path.resolve("../tests/fixtures/hint-stalled-board.json"), "utf8")) as { puzzle: string; candidates: string };

test("the browser worker finds a verified chain for the user's stalled screenshot", async ({ page }) => {
  await page.goto("./");
  const response = await page.evaluate(async (fixture) => {
    const worker = new Worker(new URL("wasm/hint-worker.js", location.href));
    try {
      return await new Promise<{ hint?: HintResult | null; error?: string }>((resolve, reject) => {
        worker.onerror = event => reject(new Error(event.message));
        worker.onmessage = event => {
          if (event.data.type === "ready") worker.postMessage({ type: "hint", id: 1, ...fixture });
          if (event.data.type === "result") resolve(event.data);
        };
      });
    } finally { worker.terminate(); }
  }, fixture);
  expect(response.error).toBeUndefined();
  expect(response.hint).not.toBeNull();
  expect(response.hint!.technique).toBe("Contradiction Chain");
  expect(response.hint!.eliminations).toContainEqual({ cell: 25, digit: 3 });
  expect(verifyChainProof(fixture.puzzle, fixture.candidates, response.hint!)).toBe(true);
});

test("advances the screenshot through repeated logical hints without revealing solution digits", async ({ page }) => {
  await page.goto("./");
  const report = await page.evaluate(async (fixture) => {
    const worker = new Worker(new URL("wasm/hint-worker.js", location.href));
    let id = 0;
    const pending = new Map<number, (data: { hint?: HintResult | null; error?: string }) => void>();
    await new Promise<void>((resolve, reject) => {
      worker.onerror = event => reject(new Error(event.message));
      worker.onmessage = event => {
        if (event.data.type === "ready") resolve();
        if (event.data.type === "result") { pending.get(event.data.id)?.(event.data); pending.delete(event.data.id); }
      };
    });
    const grid = fixture.puzzle.split("");
    const notes = fixture.candidates.split("|").map(digits => new Set(digits.split("")));
    const hints: HintResult[] = [];
    try {
      for (let step = 0; step < 300 && grid.includes("0"); step++) {
        const request = id++;
        const data = await new Promise<{ hint?: HintResult | null; error?: string }>(resolve => {
          pending.set(request, resolve);
          worker.postMessage({ type: "hint", id: request, puzzle: grid.join(""), candidates: notes.map((digits, index) => grid[index] === "0" ? [...digits].join("") : "").join("|") });
        });
        if (data.error) return { error: data.error, grid: grid.join(""), hints };
        if (!data.hint) return { grid: grid.join(""), hints };
        const hint = data.hint;
        hints.push(hint);
        let progress = 0;
        if (hint.placement) {
          const { cell, digit } = hint.placement;
          if (grid[cell] !== "0") return { error: "Filled-cell placement", grid: grid.join(""), hints };
          grid[cell] = String(digit); notes[cell].clear(); progress++;
          for (let other = 0; other < 81; other++) {
            if (Math.floor(cell / 9) === Math.floor(other / 9) || cell % 9 === other % 9 ||
              (Math.floor(cell / 27) === Math.floor(other / 27) && Math.floor(cell % 9 / 3) === Math.floor(other % 9 / 3))) notes[other].delete(String(digit));
          }
        }
        for (const elimination of hint.eliminations) progress += Number(notes[elimination.cell].delete(String(elimination.digit)));
        if (!progress) return { error: "Repeated hint without progress", grid: grid.join(""), hints };
      }
      return { grid: grid.join(""), hints };
    } finally { worker.terminate(); }
  }, fixture);
  expect(report.error).toBeUndefined();
  expect(report.hints.length).toBeGreaterThan(1);
  expect(report.grid).not.toContain("0");
  expect(report.hints.every(hint => hint.technique !== "Backtracking")).toBe(true);
});
