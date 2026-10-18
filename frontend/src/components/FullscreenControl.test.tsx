// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FullscreenControl } from "./FullscreenControl";

function property(target: object, key: string, value: unknown) {
  Object.defineProperty(target, key, { configurable: true, value });
}

describe("fullscreen and Home Screen controls", () => {
  let request: ReturnType<typeof vi.fn>;
  let exit: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    property(document, "fullscreenEnabled", true);
    property(document, "fullscreenElement", null);
    request = vi.fn(async () => {
      property(document, "fullscreenElement", document.documentElement);
      document.dispatchEvent(new Event("fullscreenchange"));
    });
    exit = vi.fn(async () => {
      property(document, "fullscreenElement", null);
      document.dispatchEvent(new Event("fullscreenchange"));
    });
    property(document.documentElement, "requestFullscreen", request);
    property(document, "exitFullscreen", exit);
    property(HTMLDialogElement.prototype, "showModal", function (this: HTMLDialogElement) {
      this.setAttribute("open", "");
    });
    property(HTMLDialogElement.prototype, "close", function (this: HTMLDialogElement) {
      this.removeAttribute("open");
      this.dispatchEvent(new Event("close"));
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    for (const key of ["fullscreenEnabled", "fullscreenElement", "exitFullscreen", "webkitFullscreenElement", "webkitExitFullscreen"]) {
      Reflect.deleteProperty(document, key);
    }
    Reflect.deleteProperty(document.documentElement, "requestFullscreen");
    Reflect.deleteProperty(document.documentElement, "webkitRequestFullscreen");
    Reflect.deleteProperty(navigator, "standalone");
    Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal");
    Reflect.deleteProperty(HTMLDialogElement.prototype, "close");
  });

  it("enters and exits fullscreen from a user click", async () => {
    const user = userEvent.setup();
    render(<FullscreenControl />);
    await user.click(screen.getByRole("button", { name: "Enter full screen" }));
    expect(request).toHaveBeenCalledWith({ navigationUI: "hide" });
    await user.click(screen.getByRole("button", { name: "Exit full screen" }));
    expect(exit).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "Enter full screen" })).toBeDefined();
  });

  it("updates the control when the browser exits fullscreen independently", async () => {
    const user = userEvent.setup();
    render(<FullscreenControl />);
    await user.click(screen.getByRole("button", { name: "Enter full screen" }));
    property(document, "fullscreenElement", null);
    fireEvent(document, new Event("fullscreenchange"));
    expect(screen.getByRole("button", { name: "Enter full screen" })).toBeDefined();
  });

  it("opens iPhone and Android instructions when fullscreen is unavailable", async () => {
    property(document, "fullscreenEnabled", false);
    const user = userEvent.setup();
    render(<FullscreenControl />);
    await user.click(screen.getByRole("button", { name: "Full screen options" }));
    const guide = screen.getByRole("dialog", { name: "Full screen & Home Screen" });
    expect(within(guide).getByRole("heading", { name: "iPhone / iPad" })).toBeDefined();
    expect(within(guide).getByText(/Open as Web App/)).toBeDefined();
    expect(within(guide).getByRole("heading", { name: "Android" })).toBeDefined();
    expect(within(guide).queryByRole("button", { name: "Enter full screen" })).toBeNull();
    await user.click(within(guide).getByRole("button", { name: "Close screen instructions" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(request).not.toHaveBeenCalled();
  });

  it("offers instructions after a rejected fullscreen request", async () => {
    request.mockRejectedValue(new Error("Permission denied"));
    const user = userEvent.setup();
    render(<FullscreenControl />);
    await user.click(screen.getByRole("button", { name: "Enter full screen" }));
    expect(screen.getByRole("alert").textContent).toMatch(/couldn’t enter full screen/);
    expect(screen.getByRole("dialog", { name: "Full screen & Home Screen" })).toBeDefined();
    request.mockImplementation(async () => {
      property(document, "fullscreenElement", document.documentElement);
      document.dispatchEvent(new Event("fullscreenchange"));
    });
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Enter full screen" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("button", { name: "Exit full screen" })).toBeDefined();
  });

  it("supports Safari browsers that expose the prefixed fullscreen methods", async () => {
    property(document.documentElement, "requestFullscreen", undefined);
    property(document, "exitFullscreen", undefined);
    const enterSafari = vi.fn(async () => {
      property(document, "webkitFullscreenElement", document.documentElement);
      document.dispatchEvent(new Event("webkitfullscreenchange"));
    });
    const exitSafari = vi.fn(async () => {
      property(document, "webkitFullscreenElement", null);
      document.dispatchEvent(new Event("webkitfullscreenchange"));
    });
    property(document.documentElement, "webkitRequestFullscreen", enterSafari);
    property(document, "webkitExitFullscreen", exitSafari);
    const user = userEvent.setup();
    render(<FullscreenControl />);
    await user.click(screen.getByRole("button", { name: "Enter full screen" }));
    expect(enterSafari).toHaveBeenCalledOnce();
    await user.click(screen.getByRole("button", { name: "Exit full screen" }));
    expect(exitSafari).toHaveBeenCalledOnce();
  });

  it("recognizes an iPhone Home Screen launch", async () => {
    property(navigator, "standalone", true);
    const user = userEvent.setup();
    render(<FullscreenControl />);
    await user.click(screen.getByRole("button", { name: "Full screen instructions" }));
    expect(screen.getByText(/already using the Home Screen app/)).toBeDefined();
  });

  it("keeps instruction keyboard events away from the Sudoku shortcuts", async () => {
    const user = userEvent.setup();
    render(<FullscreenControl />);
    await user.click(screen.getByRole("button", { name: "Full screen instructions" }));
    const shortcut = vi.fn();
    window.addEventListener("keydown", shortcut);
    try {
      fireEvent.keyDown(screen.getByRole("dialog"), { key: "5" });
      fireEvent.keyDown(screen.getByRole("dialog"), { key: "Tab" });
      expect(shortcut).not.toHaveBeenCalled();
    } finally { window.removeEventListener("keydown", shortcut); }
  });
});
