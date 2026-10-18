import { test, expect } from "@playwright/test";

test("keeps the solving board and every entry control inside short desktop viewports", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("./");
  await page.getByRole("tab", { name: "Import", exact: true }).click();
  await page.getByRole("button", { name: /sample/i }).click();
  await page.getByRole("button", { name: /start solving/i }).click();
  for (const [width, height] of [[1536, 800], [1280, 720], [1024, 600], [1280, 480]]) {
    await page.setViewportSize({ width, height });
    await expect(async () => {
      const bounds = await page.evaluate(() => {
        const board = document.querySelector('.sudoku-board')!.getBoundingClientRect();
        const controls = document.querySelector('.entry-bar')!.getBoundingClientRect();
        const keypad = document.querySelector('.keypad')!.getBoundingClientRect();
        const toolbar = document.querySelector('.entry-bar')!;
        return { viewport: innerHeight, boardTop: board.top, boardBottom: board.bottom,
          boardWidth: board.width, boardHeight: board.height, keypadWidth: keypad.width,
          controlsBottom: controls.bottom, keypadBottom: keypad.bottom,
          toolbarOverflows: toolbar.scrollWidth > toolbar.clientWidth };
      });
      expect(bounds.boardTop).toBeGreaterThanOrEqual(0);
      expect(bounds.boardBottom).toBeLessThanOrEqual(bounds.viewport);
      expect(Math.abs(bounds.boardWidth - bounds.boardHeight)).toBeLessThanOrEqual(1);
      expect(bounds.controlsBottom).toBeLessThanOrEqual(bounds.viewport);
      expect(bounds.keypadBottom).toBeLessThanOrEqual(bounds.viewport);
      expect(Math.abs(bounds.boardWidth - bounds.keypadWidth)).toBeLessThanOrEqual(1);
      expect(bounds.toolbarOverflows).toBe(false);
    }).toPass({ timeout: 5000 });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.getByRole("grid").evaluate(element => element.getBoundingClientRect().width)).toBeGreaterThan(340);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.evaluate(() => { document.documentElement.style.fontSize = "20px"; });
  await expect.poll(() => page.locator(".keypad").evaluate(element => element.getBoundingClientRect().bottom)).toBeLessThanOrEqual(720);
});
