import { describe, expect, it } from "vitest";

import type { GeneratedPuzzleResponse, HintResponse } from "./puzzle-services";
import type { HintResult } from "./hintEngine";
import {
  buildCandidateString,
  checkResultMessage,
  collectConflictIndexes,
  collectHintCells,
  collectHintPreview,
  generatedPuzzleMessage,
  hintResultToResponse,
  withoutAppliedEliminations
} from "./hints";
import { createEmptyGrid, createEmptyNotes, type ValidationConflict } from "./sudoku-state";

function makeHint(overrides: Partial<HintResponse> = {}): HintResponse {
  return {
    technique: { id: "naked_single", name: "Naked Single", rank: 1 },
    action: { type: "place", cell: { row: 1, col: 1 }, digit: 5, eliminations: [] },
    summary: "R1C1 must be 5.",
    explanation: ["Only 5 fits."],
    highlights: {
      primary_cells: [{ row: 1, col: 1 }],
      related_cells: [{ row: 1, col: 2 }],
      eliminations: [{ cell: { row: 2, col: 1 }, digit: 5 }]
    },
    ...overrides
  };
}

describe("collectConflictIndexes", () => {
  it("flattens conflict cells into a set of board indexes", () => {
    const conflicts: ValidationConflict[] = [
      { unit: "row", unitNumber: 1, digit: 4, cells: [{ row: 1, col: 1 }, { row: 1, col: 9 }] }
    ];
    expect(Array.from(collectConflictIndexes(conflicts)).sort((a, b) => a - b)).toEqual([0, 8]);
  });

  it("returns an empty set without conflicts", () => {
    expect(collectConflictIndexes([]).size).toBe(0);
  });
});

describe("collectHintCells", () => {
  it("maps primary, related, and elimination cells to indexes", () => {
    const hint = makeHint();
    expect(collectHintCells(hint, "primary").has(0)).toBe(true);
    expect(collectHintCells(hint, "related").has(1)).toBe(true);
    expect(collectHintCells(hint, "elimination").has(9)).toBe(true);
  });

  it("returns empty sets for a missing hint", () => {
    expect(collectHintCells(null, "primary").size).toBe(0);
  });
});

describe("collectHintPreview", () => {
  it("returns the placement target for a place hint on an empty cell", () => {
    expect(collectHintPreview(makeHint(), createEmptyGrid())).toEqual({ index: 0, digit: 5 });
  });

  it("returns null when the target cell is already filled", () => {
    const grid = createEmptyGrid();
    grid[0] = 5;
    expect(collectHintPreview(makeHint(), grid)).toBeNull();
  });

  it("returns null for eliminate hints", () => {
    const hint = makeHint({ action: { type: "eliminate", eliminations: [{ cell: { row: 1, col: 1 }, digit: 5 }] } });
    expect(collectHintPreview(hint, createEmptyGrid())).toBeNull();
  });
});

describe("checkResultMessage", () => {
  it("describes each check status", () => {
    expect(checkResultMessage({ status: "solved", incorrectIndexes: [] })).toContain("Solved");
    expect(checkResultMessage({ status: "incorrect", incorrectIndexes: [3] })).toContain("1 wrong number");
    expect(checkResultMessage({ status: "incorrect", incorrectIndexes: [3, 4] })).toContain("2 wrong numbers");
    expect(checkResultMessage({ status: "unsolvable", incorrectIndexes: [] })).toContain("no valid solution");
    expect(checkResultMessage({ status: "incomplete", incorrectIndexes: [] })).toContain("No mistakes so far");
  });
});

describe("hintResultToResponse", () => {
  it("preserves each step of an advanced chain explanation", () => {
    const result: HintResult = {
      technique: "Contradiction Chain", description: "Remove 3 from R3C8.", difficulty: 21,
      explanation: ["Assume R3C8 = 3.", "This forces R8C6 = 3.", "Row 7 has no place for 3."],
      causalCells: [25, 68], eliminationCells: [25], eliminations: [{ cell: 25, digit: 3 }], placement: null
    };
    expect(hintResultToResponse(result).explanation).toEqual(result.explanation);
  });
  it("maps a placement to a place action highlighting the target cell", () => {
    const result: HintResult = {
      technique: "Hidden Single",
      description: "Hidden Single: place 5 in R1C1.",
      difficulty: 2,
      causalCells: [0],
      eliminationCells: [],
      eliminations: [],
      placement: { cell: 0, digit: 5 }
    };
    const response = hintResultToResponse(result);

    expect(response.technique).toEqual({ id: "hidden_single", name: "Hidden Single", rank: 2 });
    expect(response.action.type).toBe("place");
    expect(response.action.cell).toEqual({ row: 1, col: 1 });
    expect(response.action.digit).toBe(5);
    expect(response.explanation).toEqual(["Hidden Single: place 5 in R1C1."]);
    expect(response.highlights.primary_cells).toEqual([{ row: 1, col: 1 }]);
  });

  it("maps an elimination, surfacing pattern cells as primary and eliminations as red", () => {
    const result: HintResult = {
      technique: "X-Wings",
      description: "X-Wings: remove 4 from 2 cells.",
      difficulty: 10,
      causalCells: [9, 11],
      eliminationCells: [18, 20],
      eliminations: [
        { cell: 18, digit: 4 },
        { cell: 20, digit: 4 }
      ],
      placement: null
    };
    const response = hintResultToResponse(result);

    expect(response.technique).toEqual({ id: "x_wings", name: "X-Wings", rank: 10 });
    expect(response.action.type).toBe("eliminate");
    expect(response.action.eliminations).toEqual([
      { cell: { row: 3, col: 1 }, digit: 4 },
      { cell: { row: 3, col: 3 }, digit: 4 }
    ]);
    expect(response.highlights.primary_cells).toEqual([
      { row: 2, col: 1 },
      { row: 2, col: 3 }
    ]);
    expect(response.highlights.eliminations).toEqual(response.action.eliminations);
  });
});

describe("buildCandidateString", () => {
  it("returns an empty string when the player has no notes", () => {
    expect(buildCandidateString(createEmptyGrid(), createEmptyNotes())).toBe("");
  });

  it("encodes 81 '|'-separated cells, intersecting notes with the legal set", () => {
    const notes = createEmptyNotes();
    notes[0] = [1, 2]; // R1C1 narrowed to {1,2}
    const segments = buildCandidateString(createEmptyGrid(), notes).split("|");

    expect(segments).toHaveLength(81);
    expect(segments[0]).toBe("12");
    // A cell with no explicit notes falls back to the full legal candidate set.
    expect(segments[1]).toBe("123456789");
  });
});

describe("withoutAppliedEliminations", () => {
  it("passes placement hints through unchanged", () => {
    const hint = makeHint();
    expect(withoutAppliedEliminations(hint, createEmptyNotes())).toBe(hint);
  });

  it("drops eliminations already removed from the player's notes", () => {
    const notes = createEmptyNotes();
    notes[18] = [5]; // R3C1 still has 5 but no longer 3
    const hint = makeHint({
      action: {
        type: "eliminate",
        cell: null,
        digit: null,
        eliminations: [
          { cell: { row: 3, col: 1 }, digit: 3 },
          { cell: { row: 3, col: 1 }, digit: 5 }
        ]
      }
    });
    const trimmed = withoutAppliedEliminations(hint, notes);
    expect(trimmed?.action.eliminations).toEqual([{ cell: { row: 3, col: 1 }, digit: 5 }]);
  });

  it("returns null when every elimination is already applied", () => {
    const notes = createEmptyNotes();
    notes[18] = [7]; // neither 3 nor 5 remain
    const hint = makeHint({
      action: {
        type: "eliminate",
        cell: null,
        digit: null,
        eliminations: [
          { cell: { row: 3, col: 1 }, digit: 3 },
          { cell: { row: 3, col: 1 }, digit: 5 }
        ]
      }
    });
    expect(withoutAppliedEliminations(hint, notes)).toBeNull();
  });
});

describe("generatedPuzzleMessage", () => {
  it("summarizes the generated puzzle metadata", () => {
    const generated = {
      puzzle: "0".repeat(81),
      solution: "1".repeat(81),
      level: { id: "hard", name: "Hard", description: "", techniques: [] },
      requested_level: { id: "medium", name: "Medium", description: "", techniques: [] },
      se_rating: 2.5,
      techniques: [],
      technique_profile: {},
      attribution: { name: "Ukodus", url: "", license: "", copyright: "" }
    } satisfies GeneratedPuzzleResponse;

    const message = generatedPuzzleMessage(generated);
    expect(message).toContain("Generated Medium puzzle");
    expect(message).toContain("Rated Hard");
    expect(message).toContain("SE 2.5");
    expect(message).toContain("Ukodus");
  });
});
