import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import fixture from "../../../tests/fixtures/hint-stalled-board.json";
import { findAdvancedHint, verifyChainProof } from "./advanced-hints";
import { parsePuzzleText, solveSudoku } from "./sudoku-state";

describe("advanced logical hint engine", () => {
  it("finds a proved logical step for the stalled screenshot and respects its candidates", () => {
    const result = findAdvancedHint(fixture.puzzle, fixture.candidates);
    expect(result).not.toBeNull();
    expect(result!.explanation!.length).toBeGreaterThan(2);
    expect(result!.proof).toBeDefined();
    expect(verifyChainProof(fixture.puzzle, fixture.candidates, result!)).toBe(true);
    const solution = solveSudoku(parsePuzzleText(fixture.puzzle))!;
    for (const elimination of result!.eliminations) expect(elimination.digit).not.toBe(solution[elimination.cell]);
    if (result!.placement) expect(result!.placement.digit).toBe(solution[result!.placement.cell]);
  });
  it("does not invent a logical step for an unconstrained grid", () => {
    expect(findAdvancedHint("0".repeat(81))).toBeNull();
  });
  it("returns no step for a completed valid board", () => {
    const solution = solveSudoku(parsePuzzleText(fixture.puzzle))!.join("");
    expect(findAdvancedHint(solution)).toBeNull();
  });
  it("rejects invalid boards and contradictory candidate masks", () => {
    expect(() => findAdvancedHint("11" + "0".repeat(79))).toThrow(/unsolvable/);
    expect(() => findAdvancedHint(fixture.puzzle, "x")).toThrow(/invalid_format/);
    const candidates = fixture.candidates.split("|");
    candidates[3] = "1"; // conflicts with the 1 already in column 4
    expect(() => findAdvancedHint(fixture.puzzle, candidates.join("|"))).toThrow(/invalid_candidates/);
  });
  it("rejects a modified conclusion even when the underlying branch trace is valid", () => {
    const result = findAdvancedHint(fixture.puzzle, fixture.candidates)!;
    expect(verifyChainProof(fixture.puzzle, fixture.candidates, {
      ...result, placement: { cell: 0, digit: 1 }, eliminations: []
    })).toBe(false);
  });
  it("reports inconsistent notes when every possible branch leads to contradiction", () => {
    const notes = fixture.candidates.split("|");
    notes[4] = "68"; // Removes the true digit, but every cell still has candidates.
    expect(() => findAdvancedHint(fixture.puzzle, notes.join("|"))).toThrow(/invalid_candidates/);
  });
  it("rejects a proof with an unjustified deduction", () => {
    const result = structuredClone(findAdvancedHint(fixture.puzzle, fixture.candidates)!);
    result.proof!.branches[0].steps[1].value = 1;
    expect(verifyChainProof(fixture.puzzle, fixture.candidates, result)).toBe(false);
  });
  it("replays sound deductions against known solutions across all eight rated buckets", () => {
    let checked = 0;
    for (const bucket of ["easy", "medium", "hard", "expert", "master", "extreme", "advanced_7_8", "advanced_8_plus"]) {
      const url = new URL(`../../../data/puzzles/serate-buckets/${bucket}/part-000000.ndjson.gz`, import.meta.url);
      const records = gunzipSync(readFileSync(url)).toString().trim().split("\n");
      for (let sample = 0; sample < 8; sample++) {
        const record = JSON.parse(records[Math.floor(sample * records.length / 8)]);
        const hint = findAdvancedHint(record.puzzle);
        if (!hint) continue;
        expect(verifyChainProof(record.puzzle, "", hint)).toBe(true);
        for (const elimination of hint.eliminations) expect(String(elimination.digit)).not.toBe(record.solution[elimination.cell]);
        if (hint.placement) expect(String(hint.placement.digit)).toBe(record.solution[hint.placement.cell]);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(40);
  }, 30_000);
});
