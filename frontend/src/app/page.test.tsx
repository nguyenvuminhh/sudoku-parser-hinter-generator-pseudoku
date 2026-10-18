// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SETTINGS_STORAGE_KEY } from "../hooks/useSettings";
import { SAMPLE_PUZZLE } from "../lib/constants";
import { decodePuzzleParam, encodePuzzleParam } from "../lib/share-codec";
import { gridToPayload, parsePuzzleText } from "../lib/sudoku-state";

import PseudokuPage from "./page";

vi.mock("../lib/puzzle-services", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/puzzle-services")>();
  return {
    ...actual,
    requestGeneratedPuzzle: vi.fn(),
    recognizeImage: vi.fn()
  };
});

// The l2sg hint engine runs in a Web Worker (unavailable in jsdom), so stub the
// hook with a ready engine that returns a fixed placement for the sample.
vi.mock("../hooks/useHintEngine", () => ({
  useHintEngine: () => ({
    ready: true,
    loading: false,
    getHint: async () => ({
      technique: "Naked Single",
      description: "Naked Single: place 3 in R5C9.",
      difficulty: 1,
      causalCells: [44],
      eliminationCells: [],
      eliminations: [],
      placement: { cell: 44, digit: 3 }
    })
  })
}));

const api = await import("../lib/puzzle-services");
const requestGeneratedPuzzleMock = vi.mocked(api.requestGeneratedPuzzle);
const SOLVABLE_PUZZLE =
  "530070000600195000098000060800060003400803001700020006060000280000419005000080079";
const NEAR_COMPLETE_SOLUTION =
  "534678912672195348198342567859761423426853791713924856961537284287419635345286179";

function cell(row: number, col: number): HTMLElement {
  return screen.getByRole("gridcell", { name: new RegExp(`^Row ${row}, column ${col}(,|$)`) });
}

// The redesign loads a puzzle from the Import tab, then confirms from the
// review step. Sample → review → Start solving.
async function loadSampleAndConfirm(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("tab", { name: /import/i }));
  await user.click(screen.getByRole("button", { name: /sample/i }));
  await user.click(screen.getByRole("button", { name: /start solving/i }));
}

// Mobile advanced actions live behind the entry toolbar's ⋯ More popover.
async function openMore(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: /more tools/i }));
  return screen.getByRole("group", { name: /mobile puzzle actions/i });
}

async function toggleQuickFill(user: ReturnType<typeof userEvent.setup>) {
  const menu = await openMore(user);
  await user.click(within(menu).getByRole("button", { name: /^quick fill$/i }));
}

function rightClick(target: HTMLElement): boolean {
  fireEvent.pointerDown(target, { button: 2 });
  const wasNotCanceled = fireEvent.contextMenu(target, { button: 2 });
  fireEvent.pointerUp(target, { button: 2 });
  return wasNotCanceled;
}

function rightDrag(targets: HTMLElement[]): boolean {
  const [firstTarget, ...enteredTargets] = targets;
  fireEvent.pointerDown(firstTarget, { button: 2, buttons: 2 });
  for (const target of enteredTargets) {
    fireEvent.pointerEnter(target, { button: 2, buttons: 2 });
  }
  const wasNotCanceled = fireEvent.contextMenu(targets[targets.length - 1], { button: 2, buttons: 2 });
  fireEvent.pointerUp(targets[targets.length - 1], { button: 2, buttons: 0 });
  return wasNotCanceled;
}

describe("PseudokuPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    window.history.pushState({}, "", "/");
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
  });

  afterEach(() => {
    cleanup();
  });

  it("starts in the loading phase with entry guidance", () => {
    render(<PseudokuPage />);

    expect(within(screen.getByRole("banner", { name: "Pseudoku" })).getByText("Pseudoku")).toBeDefined();
    expect(within(screen.getByRole("banner", { name: "Pseudoku" })).getByText("Sudoku parser, hinter, generator")).toBeDefined();
    expect(screen.getByRole("grid", { name: /sudoku grid/i })).toBeDefined();
    expect(screen.getByRole("heading", { name: /start a puzzle/i })).toBeDefined();
    expect(screen.getByText(/enter a puzzle on the board or upload/i)).toBeDefined();
  });

  it("opens puzzle setup without accounts or sign-in controls", () => {
    render(<PseudokuPage />);

    expect(screen.queryByRole("button", { name: /sign in|account|profile/i })).toBeNull();
    expect(screen.getByRole("heading", { name: /start a puzzle/i })).toBeDefined();
  });

  it("keeps the solving rail focused on local puzzle tools", async () => {
    const user = userEvent.setup();
    render(<PseudokuPage />);

    await loadSampleAndConfirm(user);
    expect(screen.queryByRole("button", { name: /leaderboard|account|sign in/i })).toBeNull();
    expect(screen.getByRole("button", { name: /get a hint/i })).toBeDefined();
    expect(screen.getByRole("button", { name: /^settings$/i })).toBeDefined();
  });

  it("types digits into the board and advances to the next empty cell", async () => {
    const user = userEvent.setup();
    render(<PseudokuPage />);

    await user.keyboard("5");

    expect(within(cell(1, 1)).getByText("5")).toBeDefined();
    // Selection advanced to the next empty cell (R1C2 on an empty board).
    expect(cell(1, 2).className).toContain("selected");
  });

  it("loads the sample puzzle and locks givens after confirming", async () => {
    const user = userEvent.setup();
    render(<PseudokuPage />);

    await loadSampleAndConfirm(user);

    expect(screen.getByText(/solving phase started/i)).toBeDefined();
    // R1C4 holds the sample given 6 and is announced as a loaded clue.
    expect(cell(1, 4).getAttribute("aria-label")).toContain("loaded clue");
    // Quick fill stays on by default after confirming.
    const menu = await openMore(user);
    expect(within(menu).getByRole("button", { name: /^quick fill$/i }).getAttribute("aria-pressed")).toBe("true");
  });

  it("adds corner notes in corner mode", async () => {
    const user = userEvent.setup();
    render(<PseudokuPage />);

    await loadSampleAndConfirm(user);
    // Turn quick fill off so digit presses become notes, then pick the mode.
    await toggleQuickFill(user);
    await user.click(screen.getByRole("button", { name: /^corner$/i }));
    await user.click(cell(1, 1));
    await user.click(screen.getByRole("button", { name: "5" }));

    expect(cell(1, 1).getAttribute("aria-label")).toContain("corner notes 5");
  });

  it("adds center notes in center mode", async () => {
    const user = userEvent.setup();
    render(<PseudokuPage />);

    await loadSampleAndConfirm(user);
    await toggleQuickFill(user);
    await user.click(screen.getByRole("button", { name: /^center$/i }));
    await user.click(cell(1, 1));
    await user.click(screen.getByRole("button", { name: "5" }));
    await user.click(screen.getByRole("button", { name: "7" }));

    expect(cell(1, 1).getAttribute("aria-label")).toContain("notes 5 7");
  });

  it("paints and clears cell colors in color mode", async () => {
    const user = userEvent.setup();
    render(<PseudokuPage />);

    await loadSampleAndConfirm(user);
    await toggleQuickFill(user);
    await user.click(screen.getByRole("button", { name: /^color$/i }));
    await user.click(cell(1, 1));
    await user.click(screen.getByRole("button", { name: /paint green/i }));

    expect(cell(1, 1).getAttribute("aria-label")).toContain("green highlight");

    // Painting the same color again clears it.
    await user.click(screen.getByRole("button", { name: /paint green/i }));
    expect(cell(1, 1).getAttribute("aria-label")).not.toContain("green highlight");
  });

  it("erases a cell color with the eraser in color mode under quick fill", async () => {
    const user = userEvent.setup();
    render(<PseudokuPage />);

    await loadSampleAndConfirm(user); // quick fill stays on by default
    await user.click(screen.getByRole("button", { name: /^color$/i }));
    await user.click(screen.getByRole("button", { name: /paint green/i })); // lock the color
    await user.click(cell(1, 1)); // paint it via quick fill
    expect(cell(1, 1).getAttribute("aria-label")).toContain("green highlight");

    await user.click(screen.getByRole("button", { name: /erase cell/i }));
    expect(cell(1, 1).getAttribute("aria-label")).not.toContain("green highlight");
  });

  it("applies a digit to every cell of an alt-click multi-selection", async () => {
    const user = userEvent.setup();
    render(<PseudokuPage />);

    await loadSampleAndConfirm(user);
    await toggleQuickFill(user);

    await user.click(cell(1, 1));
    await user.keyboard("[AltLeft>]");
    await user.click(cell(2, 1));
    await user.keyboard("[/AltLeft]");
    await user.keyboard("5");

    expect(within(cell(1, 1)).getByText("5")).toBeDefined();
    expect(within(cell(2, 1)).getByText("5")).toBeDefined();
  });

  it("marks every cell of a kept multi-selection on a single click", async () => {
    const user = userEvent.setup();
    render(<PseudokuPage />);

    await loadSampleAndConfirm(user);
    // Corner-note mode; quick fill stays on by default after confirming.
    await user.click(screen.getByRole("button", { name: /^corner$/i }));

    // Build the group with Alt-click, lock the digit, then a plain click inside
    // the group marks all of it at once.
    await user.click(cell(1, 1));
    await user.keyboard("[AltLeft>]");
    await user.click(cell(1, 2));
    await user.keyboard("[/AltLeft]");
    await user.click(screen.getByRole("button", { name: "5" }));
    await user.click(cell(1, 1));

    expect(cell(1, 1).getAttribute("aria-label")).toContain("corner notes 5");
    expect(cell(1, 2).getAttribute("aria-label")).toContain("corner notes 5");
  });

  it("clears the cell selection when clicking outside the board", async () => {
    const user = userEvent.setup();
    render(<PseudokuPage />);

    await user.click(cell(2, 3));
    expect(cell(2, 3).className).toContain("selected");

    await user.click(document.body);
    expect(cell(2, 3).className).not.toContain("selected");
  });

  it("shows remaining digit counts and hides them via settings", async () => {
    const user = userEvent.setup();
    render(<PseudokuPage />);

    await loadSampleAndConfirm(user);
    expect(document.querySelector(".keypad .remaining-count")).not.toBeNull();

    await user.click(screen.getByRole("button", { name: /^settings$/i }));
    await user.click(screen.getByRole("switch", { name: /show remaining digit counts/i }));

    expect(document.querySelector(".keypad .remaining-count")).toBeNull();
  });

  it("auto-checks entered values when the setting is enabled", async () => {
    const user = userEvent.setup();
    render(<PseudokuPage />);

    await user.click(screen.getByRole("tab", { name: /import/i }));
    await user.click(screen.getByLabelText(/81-character puzzle/i));
    await user.paste(SOLVABLE_PUZZLE);
    await user.click(screen.getByRole("button", { name: /load puzzle/i }));
    await user.click(screen.getByRole("button", { name: /start solving/i }));

    await user.click(screen.getByRole("button", { name: /^settings$/i }));
    const autoCheck = screen.getByRole("switch", { name: /auto-check entered values/i });
    expect(autoCheck.getAttribute("aria-checked")).toBe("false");

    await user.click(autoCheck);
    expect(autoCheck.getAttribute("aria-checked")).toBe("true");
    expect(JSON.parse(window.localStorage.getItem(SETTINGS_STORAGE_KEY) ?? "{}")).toMatchObject({ autoCheck: true });

    await user.click(screen.getByRole("button", { name: "1" }));
    await user.click(cell(1, 3));

    expect(cell(1, 3).className).toContain("check-wrong");
    expect(screen.getByText(/found 1 wrong number/i)).toBeDefined();
  });

  it("places the quick fill digit by clicking cells", async () => {
    const user = userEvent.setup();
    render(<PseudokuPage />);

    await loadSampleAndConfirm(user);
    await user.click(screen.getByRole("button", { name: "5" }));
    await user.click(cell(1, 1));

    expect(within(cell(1, 1)).getByText("5")).toBeDefined();
  });

  it("uses right-click for the opposite quick-fill note and fill action", async () => {
    const user = userEvent.setup();
    render(<PseudokuPage />);

    await loadSampleAndConfirm(user);
    await user.click(screen.getByRole("button", { name: "5" }));

    expect(rightClick(cell(1, 1))).toBe(false);
    expect(cell(1, 1).getAttribute("aria-label")).toContain("corner notes 5");

    await user.keyboard("{Tab}");
    await user.click(cell(1, 2));
    expect(cell(1, 2).getAttribute("aria-label")).toContain("corner notes 5");

    expect(rightClick(cell(2, 1))).toBe(false);
    expect(within(cell(2, 1)).getByText("5")).toBeDefined();
  });

  it("right-click drags notes only when right-click is the note action", async () => {
    const user = userEvent.setup();
    render(<PseudokuPage />);

    await loadSampleAndConfirm(user);
    await user.click(screen.getByRole("button", { name: "5" }));

    expect(rightDrag([cell(1, 1), cell(1, 2), cell(2, 1)])).toBe(false);
    expect(cell(1, 1).getAttribute("aria-label")).toContain("corner notes 5");
    expect(cell(1, 2).getAttribute("aria-label")).toContain("corner notes 5");
    expect(cell(2, 1).getAttribute("aria-label")).toContain("corner notes 5");

    await user.keyboard("{Tab}");

    expect(rightDrag([cell(1, 3), cell(2, 2)])).toBe(false);
    expect(within(cell(1, 3)).queryByText("5")).toBeNull();
    expect(within(cell(2, 2)).queryByText("5")).toBeNull();
  });

  it("reports progress when checking a valid board", async () => {
    const user = userEvent.setup();
    render(<PseudokuPage />);

    await loadSampleAndConfirm(user);
    const menu = await openMore(user);
    await user.click(within(menu).getByRole("button", { name: /check the puzzle/i }));

    expect(screen.getByText(/no mistakes so far/i)).toBeDefined();
  });

  it("resolves a hint from the engine and applies the suggested placement", async () => {
    const user = userEvent.setup();
    render(<PseudokuPage />);

    await loadSampleAndConfirm(user);
    await user.click(screen.getByRole("button", { name: /get a hint/i }));

    // The stubbed l2sg engine returns a Naked Single placing 3 at R5C9.
    expect((await screen.findAllByText("Naked Single")).length).toBeGreaterThan(0);

    await user.click(screen.getByRole("button", { name: /apply/i }));

    expect(within(cell(5, 9)).getByText("3")).toBeDefined();
    expect(screen.getByText(/applied 3 at r5c9/i)).toBeDefined();
  });

  it("undoes the last board change with the undo button", async () => {
    const user = userEvent.setup();
    render(<PseudokuPage />);

    await loadSampleAndConfirm(user);
    await user.click(screen.getByRole("button", { name: "5" }));
    await user.click(cell(1, 1));
    expect(within(cell(1, 1)).getByText("5")).toBeDefined();

    await user.click(screen.getByRole("button", { name: /undo last board change/i }));

    expect(within(cell(1, 1)).queryByText("5")).toBeNull();
    expect(screen.getByText(/undid the last board change/i)).toBeDefined();
  });

  it("loads a generated puzzle into the board", async () => {
    const user = userEvent.setup();
    const puzzle = `${"123456789".repeat(1)}${"0".repeat(72)}`;
    requestGeneratedPuzzleMock.mockResolvedValue({
      puzzle,
      solution: "0".repeat(81),
      level: { id: "easy", name: "Easy", description: "", techniques: [] },
      requested_level: { id: "easy", name: "Easy", description: "", techniques: [] },
      se_rating: 1.2,
      techniques: [],
      technique_profile: {},
      attribution: { name: "Ukodus", url: "", license: "", copyright: "" }
    });
    render(<PseudokuPage />);

    await user.click(screen.getByRole("button", { name: /generate puzzle/i }));

    expect(await screen.findByText(/generated easy puzzle/i)).toBeDefined();
    expect(screen.getByText("Rating")).toBeDefined();
    expect(screen.getByText("SE 1.2")).toBeDefined();
    expect(within(cell(1, 1)).getByText("1")).toBeDefined();
    expect(within(cell(1, 9)).getByText("9")).toBeDefined();

    await user.click(screen.getByRole("button", { name: /start solving/i }));

    expect(screen.getByLabelText(/puzzle rating SE 1.2/i)).toBeDefined();
  });

  it("offers the full SE bucket level set when generating puzzles", async () => {
    const user = userEvent.setup();
    const puzzle = `${"123456789".repeat(1)}${"0".repeat(72)}`;
    requestGeneratedPuzzleMock.mockResolvedValue({
      puzzle,
      solution: "0".repeat(81),
      level: { id: "advanced_8_plus", name: "Advanced 8+", description: "", techniques: [] },
      requested_level: { id: "advanced_8_plus", name: "Advanced 8+", description: "", techniques: [] },
      se_rating: 8.6,
      techniques: ["Dynamic Forcing Chain"],
      technique_profile: { "Dynamic Forcing Chain": 1 },
      attribution: { name: "Pseudoku SE bucket corpus", url: "", license: "", copyright: "" }
    });
    render(<PseudokuPage />);

    expect(screen.getByRole("button", { name: "Extreme" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Advanced 7-8" })).toBeDefined();
    await user.click(screen.getByRole("button", { name: "Advanced 8+" }));
    await user.click(screen.getByRole("button", { name: /generate puzzle/i }));

    expect(requestGeneratedPuzzleMock).toHaveBeenCalledWith("advanced_8_plus");
    expect(await screen.findByText(/generated advanced 8\+ puzzle/i)).toBeDefined();
  });

  it("loads a shared puzzle URL into the review step", async () => {
    const code = encodePuzzleParam(parsePuzzleText(SAMPLE_PUZZLE));
    window.history.pushState({}, "", `/?p=${code}`);

    render(<PseudokuPage />);

    expect(await screen.findByText(/loaded shared puzzle/i)).toBeDefined();
    expect(screen.getByRole("button", { name: /start solving/i })).toBeDefined();
    expect(within(cell(1, 4)).getByText("6")).toBeDefined();
  });

  it("copies a compact share link for the puzzle givens", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn(async (_text: string) => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<PseudokuPage />);

    await loadSampleAndConfirm(user);
    const menu = await openMore(user);
    await user.click(within(menu).getByRole("button", { name: /copy share link/i }));

    expect(writeText).toHaveBeenCalledTimes(1);
    const copiedUrl = new URL(writeText.mock.calls[0][0]);
    const code = copiedUrl.searchParams.get("p") ?? "";
    expect(code[0]).toBe("m");
    expect(code.length).toBeLessThan(40);
    expect(gridToPayload(decodePuzzleParam(code))).toBe(SAMPLE_PUZZLE);
    expect(screen.getByText(/share link copied/i)).toBeDefined();
  });

  it("tints the selected cell's row, column, and box peers", async () => {
    const user = userEvent.setup();
    render(<PseudokuPage />);

    await user.click(cell(1, 1));

    expect(cell(1, 9).className).toContain("peer-cell");
    expect(cell(9, 1).className).toContain("peer-cell");
    expect(cell(3, 3).className).toContain("peer-cell");
    expect(cell(5, 5).className).not.toContain("peer-cell");
  });

  it("redoes an undone change", async () => {
    const user = userEvent.setup();
    render(<PseudokuPage />);

    await loadSampleAndConfirm(user);
    await user.click(screen.getByRole("button", { name: "5" }));
    await user.click(cell(1, 1));
    await user.click(screen.getByRole("button", { name: /undo last board change/i }));
    expect(within(cell(1, 1)).queryByText("5")).toBeNull();

    await user.click(screen.getByRole("button", { name: /redo last undone change/i }));

    expect(within(cell(1, 1)).getByText("5")).toBeDefined();
    expect(screen.getByText(/redid the last undone change/i)).toBeDefined();
  });

  it("pauses the clock, hides input, and resumes", async () => {
    const user = userEvent.setup();
    render(<PseudokuPage />);

    await loadSampleAndConfirm(user);
    await user.click(screen.getByRole("button", { name: /pause the solve clock/i }));

    expect(screen.getByText("Paused")).toBeDefined();
    // Cell clicks are ignored while paused.
    await user.click(screen.getByRole("button", { name: "5" }));
    await user.click(cell(1, 1));
    expect(within(cell(1, 1)).queryByText("5")).toBeNull();

    await user.click(screen.getByRole("button", { name: /^resume$/i }));
    expect(screen.queryByText("Paused")).toBeNull();
  });

  it("auto-advances the quick fill digit and shows finish stats on solve", async () => {
    const user = userEvent.setup();
    // Blank R9C1 (a 3) and R9C9 (a 9) so two placements finish the board.
    const puzzle = `${NEAR_COMPLETE_SOLUTION.slice(0, 72)}0${NEAR_COMPLETE_SOLUTION.slice(73, 80)}0`;
    render(<PseudokuPage />);

    await user.click(screen.getByRole("tab", { name: /import/i }));
    await user.click(screen.getByLabelText(/81-character puzzle/i));
    await user.paste(puzzle);
    await user.click(screen.getByRole("button", { name: /load puzzle/i }));
    await user.click(screen.getByRole("button", { name: /start solving/i }));

    // Completing the 9s moves quick fill to the only incomplete digit, 3.
    await user.click(screen.getByRole("button", { name: "9" }));
    await user.click(cell(9, 9));
    expect(screen.getByText(/all 9s are placed\. quick fill moved to 3/i)).toBeDefined();
    expect(screen.getByRole("button", { name: "3" }).className).toContain("quick-fill-active");

    // Finishing the board opens the stats dialog.
    await user.click(cell(9, 1));
    const dialog = screen.getByRole("dialog", { name: /puzzle solved/i });
    expect(within(dialog).getByText(/time/i)).toBeDefined();
    expect(within(dialog).getByText(/hints used/i)).toBeDefined();
    expect(within(dialog).getByText(/cells you filled/i)).toBeDefined();

    // Closing the dialog keeps the board and shows the solve banner.
    await user.click(within(dialog).getByRole("button", { name: /keep the board/i }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByText(/solved in/i)).toBeDefined();
    expect(screen.getByText(/solved! you completed the puzzle/i)).toBeDefined();
  });

  it("finishes locally with statistics and no cloud prompts", async () => {
    const user = userEvent.setup();
    const solution =
      "534678912672195348198342567859761423426853791713924856961537284287419635345286179";
    const puzzle = `${solution.slice(0, 72)}0${solution.slice(73, 80)}0`;
    render(<PseudokuPage />);

    await user.click(screen.getByRole("tab", { name: /import/i }));
    await user.click(screen.getByLabelText(/81-character puzzle/i));
    await user.paste(puzzle);
    await user.click(screen.getByRole("button", { name: /load puzzle/i }));
    await user.click(screen.getByRole("button", { name: /start solving/i }));
    await user.click(screen.getByRole("button", { name: "9" }));
    await user.click(cell(9, 9));
    await user.click(cell(9, 1));

    const dialog = screen.getByRole("dialog", { name: /puzzle solved/i });
    expect(within(dialog).getByText(/hints used/i)).toBeDefined();
    expect(within(dialog).queryByText(/sign in|leaderboard|saving|cloud/i)).toBeNull();
    expect(within(dialog).queryByRole("button", { name: /retry|leaderboard/i })).toBeNull();
  });

  it("restores the saved session after a reload", async () => {
    const user = userEvent.setup();
    const first = render(<PseudokuPage />);

    await loadSampleAndConfirm(user);
    await user.click(screen.getByRole("button", { name: "5" }));
    await user.click(cell(1, 1));
    expect(within(cell(1, 1)).getByText("5")).toBeDefined();

    first.unmount();
    render(<PseudokuPage />);

    expect(await screen.findByText(/restored your previous session/i)).toBeDefined();
    expect(within(cell(1, 1)).getByText("5")).toBeDefined();
    // Givens stay locked after the restore.
    expect(cell(1, 4).getAttribute("aria-label")).toContain("loaded clue");
  });

  it("keeps the entry toolbar by the board and the strategy rail alongside it", async () => {
    const user = userEvent.setup();
    render(<PseudokuPage />);

    await loadSampleAndConfirm(user);

    const rail = screen.getByRole("complementary", { name: /hint explanation/i });
    // The contextual rail holds the strategy note and the hint call-to-action.
    expect(within(rail).getByText(/strategy note/i)).toBeDefined();
    expect(within(rail).getByRole("button", { name: /get a hint/i })).toBeDefined();
    // The entry toolbar lives in the board column, not the rail.
    expect(within(rail).queryByLabelText(/solving controls/i)).toBeNull();
    expect(screen.getByLabelText(/solving controls/i)).toBeDefined();
  });

  it("keeps advanced actions in the desktop rail and mobile more menu", async () => {
    const user = userEvent.setup();
    render(<PseudokuPage />);

    await loadSampleAndConfirm(user);

    const rail = screen.getByRole("complementary", { name: /hint explanation/i });
    const desktopActions = within(rail).getByRole("group", { name: /desktop puzzle actions/i });
    expect(within(desktopActions).getByRole("button", { name: /^quick fill$/i })).toBeDefined();
    expect(within(desktopActions).getByRole("button", { name: /^auto fill$/i })).toBeDefined();
    expect(within(desktopActions).getByRole("button", { name: /check the puzzle/i })).toBeDefined();
    expect(within(desktopActions).getByRole("button", { name: /copy share link/i })).toBeDefined();
    expect(within(desktopActions).getByRole("button", { name: /quit to puzzle setup/i }).className).toContain("danger");

    const menu = await openMore(user);
    expect(within(menu).getByRole("button", { name: /^quick fill$/i })).toBeDefined();
    expect(within(menu).getByRole("button", { name: /copy share link/i })).toBeDefined();
    expect(within(menu).getByRole("button", { name: /quit to puzzle setup/i }).className).toContain("danger");
    expect(within(menu).queryByRole("button", { name: /new puzzle/i })).toBeNull();
  });
});
