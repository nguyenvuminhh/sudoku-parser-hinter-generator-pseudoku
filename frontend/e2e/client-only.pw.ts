import { test, expect, type Page } from "@playwright/test";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

const decorativePuzzle = [
  "..53.....", "8......2.", ".7..1.5..", "4....53..", ".1..7...6",
  "..32...8.", ".6.5....9", "..4....3.", ".....97..",
].join("");

async function recognize(page: Page, bytes: Buffer, alreadyCropped = false) {
  return page.evaluate(async ({ base64, alreadyCropped }) => {
    const file = new File([Uint8Array.from(atob(base64), value => value.charCodeAt(0))], "puzzle.png", { type: "image/png" });
    const worker = new Worker(new URL("ocr/ocr-worker.js", location.href));
    try {
      return await new Promise<{ cells?: Array<{ row: number; col: number; value: number | null }>; error?: string }>((resolve, reject) => {
        worker.onmessage = event => resolve(event.data);
        worker.onerror = event => reject(new Error(event.message));
        worker.postMessage({ type: "recognize", id: 1, file, alreadyCropped });
      });
    } finally { worker.terminate(); }
  }, { base64: bytes.toString("base64"), alreadyCropped });
}

test.beforeEach(async ({ page }) => {
  await page.route("**/api/**", route => route.abort());
  await page.goto("./");
});

test("plays locally with no account controls or external network requests", async ({ page, context }) => {
  const origin = new URL(page.url()).origin;
  const externalRequests: string[] = [];
  const writeRequests: string[] = [];
  context.on("request", request => {
    if (new URL(request.url()).origin !== origin) externalRequests.push(request.url());
    if (!["GET", "HEAD"].includes(request.method())) writeRequests.push(request.url());
  });
  await context.route("**/*", route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  await page.reload();
  await expect(page).toHaveTitle("Pseudoku");
  await expect(page.locator("header.top")).toContainText("Pseudoku");
  await expect(page.getByRole("button", { name: /sign in|account|profile/i })).toHaveCount(0);
  await page.getByRole("tab", { name: "Import", exact: true }).click();
  await page.locator('input[type="file"]').setInputFiles(path.resolve("../tests/fixtures/ocr-browser.png"));
  await page.getByRole("button", { name: /No crop/ }).click();
  await expect(page.getByText(/Image read on your device/)).toBeVisible();
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.getByRole("button", { name: "Generate puzzle", exact: true }).click();
  await page.getByRole("button", { name: /start solving/i }).click();
  await expect(page.getByRole("button", { name: /leaderboard/i })).toHaveCount(0);
  await page.getByRole("button", { name: /get a hint/i }).click();
  await expect(page.getByRole("button", { name: "Apply this step", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Apply this step", exact: true }).click();
  await page.reload();
  await expect(page.getByText(/restored your previous session/i)).toBeVisible();
  expect(externalRequests).toEqual([]);
  expect(writeRequests).toEqual([]);
});

test("loads a rated puzzle and a logical hint with static hosting only", async ({ page }) => {
  const result = await page.evaluate(async () => {
    const prefix = location.pathname.replace(/\/$/, "");
    const manifest = await (await fetch(`${prefix}/puzzles/manifest.json`)).json();
    const names = Object.keys(manifest.levels);
    const puzzles = await Promise.all(names.map(async name => {
      const chunk = await (await fetch(`${prefix}/puzzles/${name}/0.json`)).json();
      return { name, puzzle: chunk[0][0], solution: chunk[0][1] };
    }));
    const worker = new Worker(`${prefix}/wasm/hint-worker.js`);
    const hint = await new Promise((resolve, reject) => {
      worker.onerror = event => reject(new Error(event.message));
      worker.onmessage = event => {
        if (event.data.type === "ready") worker.postMessage({ type: "hint", id: 1, puzzle: puzzles[0].puzzle, candidates: "" });
        if (event.data.type === "result") resolve(event.data);
      };
    });
    worker.terminate();
    return { puzzles, hint };
  });
  expect(result.puzzles).toHaveLength(8);
  expect(result.puzzles.every(puzzle => puzzle.puzzle.length === 81 && puzzle.solution.length === 81)).toBe(true);
  expect(result.hint).toMatchObject({ type: "result", id: 1 });
  expect(result.hint).not.toHaveProperty("error");
});

test("generates all difficulty levels through the workspace controls", async ({ page }) => {
  for (const label of ["Easy", "Medium", "Hard", "Expert", "Master", "Extreme", "Advanced 7-8", "Advanced 8+"]) {
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.getByRole("button", { name: label, exact: true }).click();
    await page.getByRole("button", { name: "Generate puzzle", exact: true }).click();
    await expect(page.getByText(`Generated ${label} puzzle`, { exact: false })).toBeVisible();
  }
});

test("imports an image through the workspace without any API requests", async ({ page, context }) => {
  const apiRequests: string[] = [];
  context.on("request", request => { if (new URL(request.url()).pathname.includes("/api/")) apiRequests.push(request.url()); });
  await page.getByRole("tab", { name: "Import", exact: true }).click();
  await page.locator('input[type="file"]').setInputFiles(path.resolve("../tests/fixtures/ocr-browser.png"));
  await expect(page.getByRole("dialog", { name: "Crop Sudoku image" })).toBeVisible();
  await expect(page.getByText(/Board found/)).toBeVisible();
  await page.getByRole("button", { name: "Use crop" }).click();
  await expect(page.getByText(/Image read on your device/)).toBeVisible();
  await expect(page.getByRole("gridcell").nth(0)).toContainText("7");
  await expect(page.getByRole("gridcell").nth(40)).toContainText("6");
  await expect(page.getByRole("gridcell").nth(80)).toContainText("2");
  expect(apiRequests).toEqual([]);
});

test("recognizes digits and ignores notes in a synthetic grid in the browser", async ({ page }) => {
  const result = await recognize(page, readFileSync(path.resolve("../tests/fixtures/ocr-browser.png")));
  expect(result.error).toBeUndefined();
  expect(result.cells).toHaveLength(81);
  const digits = result.cells!.filter(cell => cell.value !== null);
  expect(digits).toEqual([
    { row: 1, col: 1, value: 7, confidence: expect.any(Number) },
    { row: 5, col: 5, value: 6, confidence: expect.any(Number) },
    { row: 9, col: 9, value: 2, confidence: expect.any(Number) },
  ]);
});

test("unreadable images report a correction-friendly error", async ({ page }) => {
  const result = await recognize(page, Buffer.from("not an image"));
  expect(result.cells).toBeUndefined();
  expect(result.error).toBeTruthy();
});

test("highlighted screenshot ignores border fragments and pencil notes", async ({ page }) => {
  const result = await recognize(page, readFileSync(path.resolve("../tests/fixtures/ocr-highlighted-border.png")));
  expect(result.error).toBeUndefined();
  expect(result.cells!.map(cell => cell.value ?? ".").join("")).toBe([
    ".....82..", ".69......", ".78.3....", "89....4.3", "...9.....",
    "...3...7.", "...6...95", "1..7.....", "9..8..3..",
  ].join(""));
});

test("extracts all 23 smaller decorative digits without classifying empty cells", async ({ page }) => {
  const result = await recognize(page, readFileSync(path.resolve("../tests/fixtures/ocr-decorative-digits.png")), true);
  expect(result.error).toBeUndefined();
  // Digit eligibility is independent of model accuracy for this unusual font.
  expect(result.cells!.map(cell => cell.value === null ? "." : "#").join("")).toBe(decorativePuzzle.replace(/[1-9]/g, "#"));
});

for (const choice of ["Use crop", "No crop — already cropped"]) {
  test(`decorative grid remains correctable after ${choice}`, async ({ page }) => {
    await page.getByRole("tab", { name: "Import", exact: true }).click();
    await page.locator('input[type="file"]').setInputFiles(path.resolve("../tests/fixtures/ocr-decorative-digits.png"));
    await expect(page.getByText(/Board found/)).toBeVisible();
    await page.getByRole("button", { name: choice, exact: true }).click();
    await expect(page.getByText(/23 clues detected/)).toBeVisible();
    // The bundled model confuses the curled 2 with 8, and sometimes 9 with 6.
    // Keep these as user corrections rather than baking font-specific guesses into OCR.
    for (const [index, value] of [[48, "2"], [62, "9"]] as const) {
      await page.getByRole("gridcell").nth(index).click();
      await page.keyboard.press(value);
    }
    expect((await page.getByRole("gridcell").allTextContents()).map(text => text.trim() || ".").join("")).toBe(decorativePuzzle);
    await expect(page.getByRole("button", { name: /Start solving/ })).toBeEnabled();
  });
}

test("screenshot with clipped outer borders asks for the complete grid", async ({ page }) => {
  const result = await recognize(page, readFileSync(path.resolve("../tests/fixtures/ocr-clipped-border.png")));
  expect(result.cells).toBeUndefined();
  expect(result.error).toContain("full outer border visible");
});

test("already-cropped screenshot can be imported without a closed border", async ({ page }) => {
  await page.getByRole("tab", { name: "Import", exact: true }).click();
  await page.locator('input[type="file"]').setInputFiles(path.resolve("../tests/fixtures/ocr-clipped-border.png"));
  await page.getByRole("button", { name: /No crop/ }).click();
  await expect(page.getByText(/22 clues detected/)).toBeVisible();
  await expect(page.getByRole("gridcell").nth(5)).toContainText("8");
  await expect(page.getByRole("gridcell").nth(6)).toContainText("2");
});

test("proposes the small Sudoku inside a larger rectangular panel", async ({ page }) => {
  const base64 = await page.evaluate(async imageData => {
    const canvas = document.createElement("canvas");
    canvas.width = 1200; canvas.height = 1400;
    const context = canvas.getContext("2d")!;
    context.fillStyle = "white"; context.fillRect(0, 0, 1200, 1400);
    context.strokeStyle = "black"; context.lineWidth = 5; context.strokeRect(20, 20, 1160, 1360);
    const image = new Image(); image.src = `data:image/png;base64,${imageData}`;
    await image.decode(); context.drawImage(image, 360, 420);
    return canvas.toDataURL("image/png").split(",")[1];
  }, readFileSync(path.resolve("../tests/fixtures/ocr-browser.png")).toString("base64"));
  await page.getByRole("tab", { name: "Import", exact: true }).click();
  await page.locator('input[type="file"]').setInputFiles({ name: "padded.png", mimeType: "image/png", buffer: Buffer.from(base64, "base64") });
  await expect(page.getByText(/Board found/)).toBeVisible();
  expect(Number(await page.getByLabel("Crop left (%)").inputValue())).toBeCloseTo(30, 0);
  expect(Number(await page.getByLabel("Crop top (%)").inputValue())).toBeCloseTo(30, 0);
  await page.getByRole("button", { name: "Use crop" }).click();
  await expect(page.getByRole("gridcell").nth(0)).toContainText("7");
  await expect(page.getByRole("gridcell").nth(40)).toContainText("6");
  await expect(page.getByRole("gridcell").nth(80)).toContainText("2");
});

test("cropper stays usable on a phone and isolates board keyboard shortcuts", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("tab", { name: "Import", exact: true }).click();
  await page.locator('input[type="file"]').setInputFiles(path.resolve("../tests/fixtures/ocr-highlighted-border.png"));
  const dialog = page.getByRole("dialog", { name: "Crop Sudoku image" });
  await expect(page.getByText(/Board found/)).toBeVisible();
  expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await expect(page.getByRole("button", { name: "Use crop" })).toBeInViewport();
  await page.getByRole("button", { name: /No crop/ }).focus();
  await page.keyboard.press("9");
  await expect(page.getByRole("gridcell").nth(0)).not.toContainText("9");
  await page.getByRole("button", { name: "Use crop" }).click();
  await expect(page.getByRole("gridcell").nth(39)).toContainText("9");
  await expect(page.getByText(/22 clues detected/)).toBeVisible();
});

test("a plain rectangular frame is not proposed as a Sudoku", async ({ page }) => {
  const base64 = await page.evaluate(() => {
    const canvas = document.createElement("canvas"); canvas.width = 600; canvas.height = 800;
    const context = canvas.getContext("2d")!;
    context.fillStyle = "white"; context.fillRect(0, 0, 600, 800);
    context.strokeStyle = "black"; context.lineWidth = 5; context.strokeRect(40, 80, 520, 640);
    return canvas.toDataURL("image/png").split(",")[1];
  });
  await page.getByRole("tab", { name: "Import", exact: true }).click();
  await page.locator('input[type="file"]').setInputFiles({ name: "frame.png", mimeType: "image/png", buffer: Buffer.from(base64, "base64") });
  await expect(page.getByText(/Couldn’t suggest a crop/)).toBeVisible();
  const corner = await page.locator(".crop-se").boundingBox();
  await page.mouse.move(corner!.x + corner!.width / 2, corner!.y + corner!.height / 2);
  await page.mouse.down();
  await page.mouse.move(corner!.x - 20, corner!.y - 20);
  await page.mouse.up();
  expect(Number(await page.getByLabel("Crop right (%)").inputValue())).toBeLessThan(100);
  const selection = await page.locator(".crop-selection").boundingBox();
  await page.mouse.move(selection!.x + selection!.width / 2, selection!.y + selection!.height / 2);
  await page.mouse.down();
  await page.mouse.move(selection!.x + selection!.width / 2 + 10, selection!.y + selection!.height / 2 + 10);
  await page.mouse.up();
  expect(Number(await page.getByLabel("Crop left (%)").inputValue())).toBeGreaterThan(0);
  await page.getByLabel("Crop left (%)").fill("10");
  await expect(page.getByLabel("Crop left (%)")).toHaveValue("10");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
});

for (const method of ["paste", "drop"] as const) {
  test(`image ${method} opens the cropper before importing`, async ({ page }) => {
    await page.getByRole("tab", { name: "Import", exact: true }).click();
    await page.evaluate(({ base64, method }) => {
      const data = new DataTransfer();
      data.items.add(new File([Uint8Array.from(atob(base64), value => value.charCodeAt(0))], "board.png", { type: "image/png" }));
      const event = new Event(method, { bubbles: true, cancelable: true });
      Object.defineProperty(event, method === "paste" ? "clipboardData" : "dataTransfer", { value: data });
      (method === "paste" ? window : document.querySelector(".loading-panel")!).dispatchEvent(event);
    }, { base64: readFileSync(path.resolve("../tests/fixtures/ocr-browser.png")).toString("base64"), method });
    await expect(page.getByRole("dialog", { name: "Crop Sudoku image" })).toBeVisible();
    await expect(page.getByRole("gridcell").nth(0)).not.toContainText("7");
    await page.getByRole("button", { name: /No crop/ }).click();
    await expect(page.getByRole("gridcell").nth(0)).toContainText("7");
  });
}

test("canceling a crop preserves the board and allows the same upload again", async ({ page }) => {
  await page.getByRole("tab", { name: "Import", exact: true }).click();
  const input = page.locator('input[type="file"]');
  await input.setInputFiles(path.resolve("../tests/fixtures/ocr-browser.png"));
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Crop Sudoku image" })).toHaveCount(0);
  await expect(page.getByRole("gridcell").nth(0)).not.toContainText("7");
  await input.setInputFiles(path.resolve("../tests/fixtures/ocr-browser.png"));
  await expect(page.getByRole("dialog", { name: "Crop Sudoku image" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Crop Sudoku image" })).toHaveCount(0);
});

const fixtureRoot = path.resolve("../data/img/cropped");
const screenshots = JSON.parse(readFileSync(path.resolve("../tests/fixtures/ocr-screenshots.json"), "utf8")) as Record<string, string>;
for (const [name, expected] of Object.entries(screenshots)) {
  test(`local screenshot ${name} matches all 81 cells`, async ({ page }) => {
    const crop = path.join(fixtureRoot, name.replace(".PNG", ".cropped.png"));
    test.skip(!existsSync(crop), "Local screenshots are not included in Git");
    const result = await recognize(page, readFileSync(crop));
    expect(result.error).toBeUndefined();
    expect(result.cells!.map(cell => cell.value ?? ".").join("")).toBe(expected);
  });
}
