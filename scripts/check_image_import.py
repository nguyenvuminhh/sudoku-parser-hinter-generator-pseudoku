"""Save reusable board crops and visual OCR reports for local screenshot fixtures."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from backend.app.ocr import extract_sudoku_cells, load_digit_classifier, recognize_sudoku_image


def crop_board(image: object) -> tuple[object, list[int]]:
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    threshold = cv2.adaptiveThreshold(
        cv2.GaussianBlur(gray, (7, 7), 0), 255,
        cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY_INV, 11, 2,
    )
    contours, _ = cv2.findContours(threshold, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    for contour in sorted(contours, key=cv2.contourArea, reverse=True)[:12]:
        approx = cv2.approxPolyDP(contour, 0.02 * cv2.arcLength(contour, True), True)
        if len(approx) != 4 or cv2.contourArea(approx) <= gray.size * 0.15:
            continue
        x, y, w, h = cv2.boundingRect(approx)
        # Preserve the outer border, including antialiasing, at original resolution.
        x0, y0 = max(0, x - 2), max(0, y - 2)
        x1, y1 = min(image.shape[1], x + w + 2), min(image.shape[0], y + h + 2)
        return image[y0:y1, x0:x1], [x0, y0, x1, y1]
    raise ValueError("No board outline found")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("images", nargs="+", type=Path)
    parser.add_argument("--output", type=Path, default=ROOT / "data/img/cropped")
    parser.add_argument("--expected", type=Path, help="JSON mapping source filenames to 81-character grids")
    args = parser.parse_args()
    expected = json.loads(args.expected.read_text()) if args.expected else {}
    args.output.mkdir(parents=True, exist_ok=True)
    report = {"classifier": type(load_digit_classifier()).__name__, "images": []}
    tiles = []
    for path in args.images:
        source = cv2.imread(str(path))
        if source is None:
            raise ValueError(f"Cannot read {path}")
        cropped, bounds = crop_board(source)
        destination = args.output / f"{path.stem}.cropped.png"
        if not cv2.imwrite(str(destination), cropped):
            raise ValueError(f"Cannot write {destination}")
        payload = destination.read_bytes()
        extracted = extract_sudoku_cells(payload)
        result = recognize_sudoku_image(payload, destination.name)
        accepted = [f"r{c.row}c{c.col}" for c in extracted if c.has_ink]
        rows = ["".join(str(c.value or ".") for c in result.cells[r:r + 9]) for r in range(0, 81, 9)]
        entry = {
            "source": str(path), "crop": str(destination), "crop_bounds_xyxy": bounds,
            "accepted_cells": accepted, "rows": rows, **result.to_dict(),
        }
        if path.name in expected:
            truth = expected[path.name]
            if len(truth) != 81 or any(value not in ".123456789" for value in truth):
                raise ValueError(f"Expected grid for {path.name} must contain 81 dots/digits")
            entry["mismatches"] = [
                {"row": cell.row, "col": cell.col, "expected": int(value) if value != "." else None,
                 "actual": cell.value}
                for cell, value in zip(result.cells, truth)
                if str(cell.value or ".") != value
            ]
            entry["presence_mismatches"] = [
                {"row": cell.row, "col": cell.col, "expected_has_digit": value != ".",
                 "actual_has_digit": cell.has_ink}
                for cell, value in zip(extracted, truth)
                if cell.has_ink != (value != ".")
            ]
        report["images"].append(entry)
        board = cv2.resize(cropped, (630, 630))
        for cell in extracted:
            if cell.has_ink:
                x, y = (cell.col - 1) * 70, (cell.row - 1) * 70
                cv2.rectangle(board, (x + 2, y + 2), (x + 68, y + 68), (0, 170, 0), 2)
                prediction = result.cells[(cell.row - 1) * 9 + cell.col - 1]
                cv2.putText(board, str(prediction.value or "?"), (x + 50, y + 18),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 0, 220), 2)
        tile = np.full((665, 630, 3), 255, np.uint8)
        tile[35:] = board
        cv2.putText(tile, f"{path.stem}: {len(accepted)} accepted", (10, 25),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.65, (0, 0, 0), 1)
        tiles.append(tile)
        cv2.imwrite(str(args.output / f"{path.stem}.review.png"), tile)
        print(f"{path.name}: {len(accepted)} accepted; {'/'.join(rows)}")
    for start in range(0, len(tiles), 4):
        group = tiles[start:start + 4]
        while len(group) < 4:
            group.append(np.full_like(tiles[0], 255))
        montage = np.vstack((np.hstack(group[:2]), np.hstack(group[2:])))
        cv2.imwrite(str(args.output / f"review-{start // 4 + 1}.png"), montage)
    compared = [entry for entry in report["images"] if "mismatches" in entry]
    if compared:
        report["summary"] = {
            "compared_images": len(compared), "compared_cells": len(compared) * 81,
            "correct_images": sum(not entry["mismatches"] for entry in compared),
            "incorrect_cells": sum(len(entry["mismatches"]) for entry in compared),
            "incorrect_presence_decisions": sum(len(entry["presence_mismatches"]) for entry in compared),
        }
        print(json.dumps(report["summary"]))
    (args.output / "report.json").write_text(json.dumps(report, indent=2) + "\n")


if __name__ == "__main__":
    main()
