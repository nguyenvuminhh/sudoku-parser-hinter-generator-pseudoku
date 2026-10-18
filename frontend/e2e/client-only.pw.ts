import { test, expect, type Page } from "@playwright/test";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

async function recognize(page: Page, bytes: Buffer) {
  return page.evaluate(async (base64) => {
    const file = new File([Uint8Array.from(atob(base64), value => value.charCodeAt(0))], "puzzle.png", { type: "image/png" });
    const worker = new Worker(new URL("ocr/ocr-worker.js", location.href));
    try {
      return await new Promise<{ cells?: Array<{ row: number; col: number; value: number | null }>; error?: string }>((resolve, reject) => {
        worker.onmessage = event => resolve(event.data);
        worker.onerror = event => reject(new Error(event.message));
        worker.postMessage({ type: "recognize", id: 1, file });
      });
    } finally { worker.terminate(); }
  }, bytes.toString("base64"));
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
