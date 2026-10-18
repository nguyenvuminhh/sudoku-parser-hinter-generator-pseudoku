import { test, expect } from "@playwright/test";

test.use({ viewport: { width: 390, height: 844 } });

test("enters and leaves real browser fullscreen and tracks external exits", async ({ page }) => {
  await page.goto("./");
  const supported = await page.evaluate(() => document.fullscreenEnabled && typeof document.documentElement.requestFullscreen === "function");
  test.skip(!supported, "This browser engine does not expose the standard Fullscreen API.");
  await page.getByRole("button", { name: "Enter full screen", exact: true }).click();
  await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement))).toBe(true);
  await page.getByRole("button", { name: "Full screen instructions", exact: true }).click();
  const guide = page.getByRole("dialog", { name: "Full screen & Home Screen" });
  await expect(guide.getByText(/already using the Home Screen app/)).toHaveCount(0);
  await guide.getByRole("button", { name: "Close screen instructions" }).click();
  await page.getByRole("button", { name: "Exit full screen", exact: true }).click();
  await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement))).toBe(false);
  await page.getByRole("button", { name: "Enter full screen", exact: true }).click();
  await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement))).toBe(true);
  await page.evaluate(() => document.exitFullscreen());
  await expect(page.getByRole("button", { name: "Enter full screen", exact: true })).toBeVisible();
});

test("unsupported browsers get Home Screen steps, keyboard isolation, and focus restoration", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(document, "fullscreenEnabled", { value: false, configurable: true });
    Object.defineProperty(document, "webkitFullscreenEnabled", { value: false, configurable: true });
  });
  await page.goto("./");
  await page.getByRole("tab", { name: "Import", exact: true }).click();
  await page.getByRole("button", { name: /sample/i }).click();
  await page.getByRole("button", { name: /start solving/i }).click();
  const before = await page.getByRole("gridcell").allTextContents();
  const button = page.getByRole("button", { name: "Full screen options", exact: true });
  await button.click();
  const guide = page.getByRole("dialog", { name: "Full screen & Home Screen" });
  await expect(guide.getByRole("heading", { name: "iPhone / iPad" })).toBeVisible();
  await expect(guide.getByText("Open as Web App", { exact: true })).toBeVisible();
  await expect(guide.getByRole("heading", { name: "Android" })).toBeVisible();
  await expect(guide.getByRole("button", { name: "Enter full screen" })).toHaveCount(0);
  await page.keyboard.press("5");
  await page.keyboard.press("Tab");
  // Browsers can move focus to their own chrome at the end of the modal's tab
  // order. Neither that nor keyboard events on the page should edit the board.
  await expect(page.locator('[role="gridcell"]:focus')).toHaveCount(0);
  await page.keyboard.press("6");
  expect(await page.getByRole("gridcell").allTextContents()).toEqual(before);
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Escape");
  await expect(guide).not.toBeVisible();
  await expect(button).toBeFocused();
});

test("provides install metadata and icons below the current hosting path", async ({ page, request }) => {
  await page.goto("./");
  const manifestUrl = await page.locator('link[rel="manifest"]').first().getAttribute("href");
  const basePath = new URL(page.url()).pathname;
  const response = await request.get(manifestUrl!);
  expect(response.ok()).toBe(true);
  expect(response.headers()["content-type"]).toContain("manifest+json");
  const manifest = await response.json();
  expect(manifest).toMatchObject({ name: "Pseudoku", display: "fullscreen", start_url: basePath, scope: basePath });
  for (const icon of manifest.icons) {
    expect(icon.src.startsWith(basePath)).toBe(true);
    const response = await request.get(icon.src);
    expect(response.ok()).toBe(true);
    expect(response.headers()["content-type"]).toContain("image/png");
  }
  await expect(page.locator('meta[name="apple-mobile-web-app-capable"]')).toHaveAttribute("content", "yes");
  const appleIcon = await page.locator('link[rel="apple-touch-icon"]').getAttribute("href");
  expect((await request.get(appleIcon!)).ok()).toBe(true);
});

test("keeps screen controls and instructions usable at phone sizes", async ({ page }) => {
  await page.goto("./");
  for (const [width, height] of [[320, 568], [390, 844], [844, 390]]) {
    await page.setViewportSize({ width, height });
    await expect(page.getByRole("button", { name: "Full screen instructions", exact: true })).toBeVisible();
    const dimensions = await page.evaluate(() => ({ content: document.documentElement.scrollWidth, viewport: innerWidth }));
    expect(dimensions.content).toBeLessThanOrEqual(dimensions.viewport);
    await page.getByRole("button", { name: "Full screen instructions", exact: true }).click();
    const guide = page.getByRole("dialog", { name: "Full screen & Home Screen" });
    const bounds = await guide.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.y).toBeGreaterThanOrEqual(0);
    expect(bounds!.height).toBeLessThanOrEqual(height);
    await guide.getByRole("button", { name: "Close screen instructions" }).click();
  }
});
