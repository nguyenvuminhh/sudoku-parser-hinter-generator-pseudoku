import { test, expect } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { HintResult } from "../src/lib/hintEngine";

const fixturePath = process.env.HINT_BENCHMARK_FIXTURE || "../tests/fixtures/advanced-8-plus-benchmark.json";
const fixture = JSON.parse(readFileSync(path.resolve(fixturePath), "utf8")) as {
  puzzles: Array<{ id: string; puzzle: string; solution: string; se_rating: number }>;
};

for (const baseline of [true, false]) test(baseline ? `benchmarks the original solver on ${fixture.puzzles.length} fixed Advanced 8+ puzzles` : `iteratively solves ${fixture.puzzles.length} frozen Advanced 8+ puzzles with sound logical hints`, async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  await page.goto("./");
  const reports = await page.evaluate(async ({ puzzles, baseline }) => {
    const baseUrl = new URL("wasm/", location.href).href;
    const legacySource = `
      const baseUrl = ${JSON.stringify(baseUrl)};
      self.importScripts(baseUrl + "l2sg.js");
      const modulePromise = self.createL2sgModule({ locateFile: path => baseUrl + path });
      modulePromise.then(() => self.postMessage({ type: "ready" }));
      self.onmessage = async ({ data }) => {
        try {
          const mod = await modulePromise;
          const hint = JSON.parse(mod.getHint(data.puzzle, data.candidates));
          self.postMessage({ type: "result", id: data.id, ...(hint?.error ? { error: hint.error } : { hint }) });
        } catch (error) { self.postMessage({ type: "result", id: data.id, error: String(error) }); }
      };`;
    const legacyUrl = baseline ? URL.createObjectURL(new Blob([legacySource], { type: "application/javascript" })) : null;
    const worker = new Worker(legacyUrl || new URL("wasm/hint-worker.js", location.href));
    let id = 0;
    const pending = new Map<number, (data: { hint?: HintResult | null; error?: string }) => void>();
    await new Promise<void>((resolve, reject) => {
      worker.onerror = event => reject(new Error(event.message));
      worker.onmessage = event => {
        if (event.data.type === "ready") resolve();
        if (event.data.type === "result") { pending.get(event.data.id)?.(event.data); pending.delete(event.data.id); }
      };
    });
    const reports = [];
    const peers = (a: number, b: number) => Math.floor(a / 9) === Math.floor(b / 9) || a % 9 === b % 9 ||
      (Math.floor(a / 27) === Math.floor(b / 27) && Math.floor(a % 9 / 3) === Math.floor(b % 9 / 3));
    try {
      for (const puzzle of puzzles) {
        const grid = puzzle.puzzle.split("");
        const notes = grid.map((value, cell) => new Set(value === "0" ? Array.from({ length: 9 }, (_, i) => String(i + 1))
          .filter(digit => !grid.some((given, other) => given === digit && peers(cell, other))) : []));
        const sequence: Array<{ technique: string; placement: HintResult["placement"]; eliminations: HintResult["eliminations"]; explanation?: string[] }> = [];
        const started = performance.now();
        let status = "stalled", error: string | undefined;
        for (let step = 0; step < 500; step++) {
          if (!grid.includes("0")) { status = grid.join("") === puzzle.solution ? "solved" : "incorrect"; break; }
          const request = id++;
          const data = await new Promise<{ hint?: HintResult | null; error?: string }>(resolve => {
            pending.set(request, resolve);
            worker.postMessage({ type: "hint", id: request, puzzle: grid.join(""), candidates: notes.map((digits, index) => grid[index] === "0" ? [...digits].join("") : "").join("|") });
          });
          if (data.error) { status = "error"; error = data.error; break; }
          if (!data.hint) break;
          const hint = data.hint;
          if (hint.technique === "Backtracking" || hint.technique === "Brute Force") { status = "nonlogical"; break; }
          sequence.push({ technique: hint.technique, placement: hint.placement, eliminations: hint.eliminations, explanation: hint.explanation });
          let progress = 0;
          if (hint.placement) {
            const { cell, digit } = hint.placement;
            if (grid[cell] !== "0" || String(digit) !== puzzle.solution[cell]) { status = "unsound"; error = `Wrong placement ${cell}=${digit}`; break; }
            grid[cell] = String(digit); notes[cell].clear(); progress++;
            for (let other = 0; other < 81; other++) if (peers(cell, other)) notes[other].delete(String(digit));
          }
          for (const elimination of hint.eliminations) {
            if (String(elimination.digit) === puzzle.solution[elimination.cell]) { status = "unsound"; error = `Eliminated solution ${elimination.cell}=${elimination.digit}`; break; }
            progress += Number(notes[elimination.cell].delete(String(elimination.digit)));
          }
          if (status === "unsound") break;
          if (!progress) { status = "repeated"; break; }
        }
        reports.push({ id: puzzle.id, rating: puzzle.se_rating, status, error, steps: sequence.length,
          elapsedMs: Math.round(performance.now() - started), grid: grid.join(""),
          candidates: notes.map((digits, index) => grid[index] === "0" ? [...digits].join("") : "").join("|"), sequence });
      }
    } finally { worker.terminate(); if (legacyUrl) URL.revokeObjectURL(legacyUrl); }
    return reports;
  }, { puzzles: fixture.puzzles, baseline });
  const reportPath = testInfo.outputPath("advanced-8-plus-results.json");
  writeFileSync(reportPath, JSON.stringify({ engine: baseline ? "l2sg + original pattern fallbacks" : "l2sg + patterns + verified forcing chains", browser: testInfo.project.name, puzzles: reports }, null, 2) + "\n");
  await testInfo.attach("advanced-8-plus-results", { path: reportPath, contentType: "application/json" });
  console.log(reports.map(puzzle => `${puzzle.id} SE ${puzzle.rating}: ${puzzle.status}, ${puzzle.steps} steps, ${puzzle.elapsedMs}ms`).join("\n"));
  expect(reports.filter(puzzle => baseline ? !["solved", "stalled"].includes(puzzle.status) : puzzle.status !== "solved").map(puzzle => ({ id: puzzle.id, status: puzzle.status, error: puzzle.error }))).toEqual([]);
});
