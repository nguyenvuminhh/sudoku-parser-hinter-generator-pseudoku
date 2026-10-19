// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ImageCropDialog } from "./ImageCropDialog";
import { detectBoardLocally } from "../lib/ocr-client";

vi.mock("../lib/ocr-client", () => ({ detectBoardLocally: vi.fn() }));
const file = new File(["image"], "board.png", { type: "image/png" });
beforeEach(() => {
  vi.mocked(detectBoardLocally).mockReset();
  vi.mocked(detectBoardLocally).mockResolvedValue({ x: .1, y: .2, width: .7, height: .6 });
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:preview");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  Object.defineProperties(HTMLDialogElement.prototype, {
    showModal: { configurable: true, value: function (this: HTMLDialogElement) { this.open = true; } },
    close: { configurable: true, value: function (this: HTMLDialogElement) { this.open = false; } },
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it("proposes an editable crop and imports the original only when No crop is chosen", async () => {
  const onImport = vi.fn();
  render(<ImageCropDialog file={file} onImport={onImport} onCancel={vi.fn()} />);
  expect(onImport).not.toHaveBeenCalled();
  await screen.findByText(/Board found/);
  expect(screen.getByLabelText("Crop left (%)")).toHaveValue(10);
  fireEvent.change(screen.getByLabelText("Crop left (%)"), { target: { value: "15" } });
  expect(screen.getByLabelText("Crop left (%)")).toHaveValue(15);
  await userEvent.click(screen.getByRole("button", { name: /No crop/ }));
  expect(onImport).toHaveBeenCalledExactlyOnceWith(file);
});

it("allows manual selection when detection fails, and cancel leaves the board alone", async () => {
  vi.mocked(detectBoardLocally).mockRejectedValue(new Error("No outline"));
  const onImport = vi.fn(), onCancel = vi.fn();
  render(<ImageCropDialog file={file} onImport={onImport} onCancel={onCancel} />);
  await screen.findByText(/Couldn’t suggest a crop/);
  expect(screen.getByLabelText("Crop right (%)")).toHaveValue(100);
  await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(onCancel).toHaveBeenCalledOnce();
  expect(onImport).not.toHaveBeenCalled();
});

it("does not overwrite manual adjustments when detection finishes late", async () => {
  let resolve!: (bounds: { x: number; y: number; width: number; height: number }) => void;
  vi.mocked(detectBoardLocally).mockReturnValue(new Promise(done => { resolve = done; }));
  render(<ImageCropDialog file={file} onImport={vi.fn()} onCancel={vi.fn()} />);
  fireEvent.change(screen.getByLabelText("Crop left (%)"), { target: { value: "12" } });
  resolve({ x: .2, y: .2, width: .6, height: .6 });
  await waitFor(() => expect(screen.queryByText(/Finding the board/)).toBeNull());
  expect(screen.getByLabelText("Crop left (%)")).toHaveValue(12);
});
