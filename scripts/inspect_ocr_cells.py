"""Export every preprocessing stage for mismatched cells in an OCR report."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from backend.app.ocr import (
    COMPONENT_MERGE_DISTANCE_RATIO,
    WARPED_GRID_SIZE,
    _crop_cell_center,
    _extract_warped_grid,
    _normalize_digit_image,
    _prepare_cell_ink,
    _single_ink_cluster,
    load_digit_classifier,
)


def panel(title: str, pixels: object, subtitle: str) -> object:
    tile = np.full((310, 280, 3), 248, np.uint8)
    color = cv2.cvtColor(pixels, cv2.COLOR_GRAY2BGR) if pixels.ndim == 2 else pixels
    preview = cv2.resize(color, (240, 240), interpolation=cv2.INTER_NEAREST)
    tile[36:276, 20:260] = preview
    cv2.putText(tile, title, (10, 23), cv2.FONT_HERSHEY_SIMPLEX, 0.48, (30, 30, 30), 1)
    cv2.putText(tile, subtitle, (10, 298), cv2.FONT_HERSHEY_SIMPLEX, 0.42, (30, 30, 30), 1)
    return tile


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--report", type=Path, default=ROOT / "data/img/cropped/report.json")
    parser.add_argument("--output", type=Path, default=ROOT / "data/img/cropped/intermediates")
    args = parser.parse_args()
    report = json.loads(args.report.read_text())
    args.output.mkdir(parents=True, exist_ok=True)
    classifier = load_digit_classifier()
    summaries = []
    for entry in report["images"]:
        if not entry.get("mismatches"):
            continue
        payload = Path(entry["crop"]).read_bytes()
        raw = np.frombuffer(payload, np.uint8)
        gray = cv2.imdecode(raw, cv2.IMREAD_GRAYSCALE)
        color = cv2.imdecode(raw, cv2.IMREAD_COLOR)
        warped = _extract_warped_grid(gray)
        size = WARPED_GRID_SIZE // 9
        for mismatch in entry["mismatches"]:
            row, col = mismatch["row"], mismatch["col"]
            stem = f"{Path(entry['source']).stem}-r{row}c{col}"
            output = args.output / stem
            output.mkdir(exist_ok=True)
            h, w = color.shape[:2]
            source = color[(row - 1) * h // 9:row * h // 9, (col - 1) * w // 9:col * w // 9]
            cell = warped[(row - 1) * size:row * size, (col - 1) * size:col * size]
            cropped = _crop_cell_center(cell)
            threshold, otsu = cv2.threshold(cropped, 0, 255, cv2.THRESH_BINARY | cv2.THRESH_OTSU)
            binary = _prepare_cell_ink(cropped)
            count, labels = cv2.connectedComponents(binary, connectivity=8)
            component_image = np.zeros((*binary.shape, 3), np.uint8)
            palette = [(0, 190, 255), (255, 170, 50), (100, 220, 80), (200, 80, 220)]
            for label in range(1, count):
                component_image[labels == label] = palette[(label - 1) % len(palette)]
            radius = size * COMPONENT_MERGE_DISTANCE_RATIO
            cluster = _single_ink_cluster(binary, max_distance=radius)
            grouped = cv2.cvtColor(binary, cv2.COLOR_GRAY2BGR)
            box = cv2.boundingRect(cluster) if cluster is not None else None
            if box is not None:
                x, y, bw, bh = box
                cv2.rectangle(grouped, (x, y), (x + bw - 1, y + bh - 1), (0, 200, 0), 1)
            normalized, ratio = _normalize_digit_image(cropped, cell_width=size)
            prediction = classifier.predict(normalized) if ratio > 0 else None
            distances = []
            for label in range(1, count):
                distance = cv2.distanceTransform((labels != label).astype(np.uint8), cv2.DIST_L2, cv2.DIST_MASK_PRECISE)
                for other in range(label + 1, count):
                    distances.append({"components": [label, other], "distance_px": float(distance[labels == other].min())})
            stages = [
                ("01-source", "1. Source color (preview)", source, "Equal split of saved color crop"),
                ("02-grayscale", "2. Grayscale + grid warp", cell, "50 x 50 cell"),
                ("03-border-trim", "3. Trim grid border", cropped, "42 x 42; 4px removed per side"),
                ("04-otsu", "4. Otsu threshold", otsu, f"Threshold: {threshold:.0f}; 42 x 42"),
                ("05-normalized-polarity", "5. Majority = background", binary, "Black background / white ink"),
                ("06-components", "6. Connected components", component_image, f"{count - 1} components; colors = IDs"),
                ("07-merged", "7. Merge nearby components", grouped,
                 f"{1 if cluster is not None else '0 or >1'} cluster; radius {radius:g}px"),
                ("08-mnist", "8. Actual MNIST input", normalized,
                 f"28 x 28; prediction {prediction.value if prediction else 'blank'}"),
            ]
            tiles = []
            for filename, title, pixels, subtitle in stages:
                cv2.imwrite(str(output / f"{filename}.png"), pixels)
                tiles.append(panel(title, pixels, subtitle))
            # Remove only the obsolete files emitted by the previous stage layout.
            for obsolete in (
                "04-interpolated.png", "05-otsu.png", "06-normalized-polarity.png",
                "07-components.png", "08-merged.png", "09-mnist.png",
            ):
                (output / obsolete).unlink(missing_ok=True)
            canvas = np.full((995, 840, 3), 248, np.uint8)
            title = f"{stem} | expected blank (pencil notes)"
            cv2.putText(canvas, title, (12, 27), cv2.FONT_HERSHEY_SIMPLEX, 0.65, (20, 20, 20), 1)
            for index, tile in enumerate(tiles):
                y, x = 40 + (index // 3) * 310, (index % 3) * 280
                canvas[y:y + 310, x:x + 280] = tile
            cv2.imwrite(str(args.output / f"{stem}.stages.png"), canvas)
            summary = {
                "cell": stem, "expected": mismatch["expected"],
                "prediction": prediction.__dict__ if prediction else None,
                "otsu_threshold": threshold, "raw_component_count": count - 1,
                "merge_radius_px": radius, "component_distances": distances,
                "cluster_bounds_xywh": box, "minimum_cluster_extent_px": size * 0.5,
                "ink_ratio": ratio,
            }
            (output / "details.json").write_text(json.dumps(summary, indent=2) + "\n")
            summaries.append(summary)
    (args.output / "summary.json").write_text(json.dumps(summaries, indent=2) + "\n")
    print(json.dumps(summaries, indent=2))


if __name__ == "__main__":
    main()
