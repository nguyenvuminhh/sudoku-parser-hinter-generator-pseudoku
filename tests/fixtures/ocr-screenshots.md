The expected grids in `ocr-screenshots.json` were manually transcribed from the
large cell digits in `data/img/IMG_7866.PNG` through `IMG_7875.PNG`. Dots denote
empty or notes-only cells. Images 7866–7874 show the same puzzle with different
selection highlights; 7875 shows a different puzzle.

With the optional model installed (`make model`), rerun the comparison from the
repository root:

```sh
.venv/bin/python scripts/check_image_import.py data/img/IMG_78{66,67,68,69,70,71,72,73,74,75}.PNG --expected tests/fixtures/ocr-screenshots.json
```

The script preserves the original screenshots and saves board-only crops,
annotated previews, and `report.json` under `data/img/cropped/`. Green boxes
mark cells accepted by the cluster filter; red labels show classifier output.
The report records its classifier, crop coordinates, predictions, and separate
presence and digit mismatches. These local images and model files are ignored
by Git; the script and expected grids are tracked project files.

Initial MNIST result: 5/10 exact boards, 805/810 correct cell values. There are
three false digit detections in notes-only cells (7870 r4c1, 7871 r7c1, 7872
r9c8) and two incorrect digits on dark blue selection backgrounds (7873 r7c7:
8 → 2; 7874 r6c7: 6 → 2). All 191 actual digit cells pass the presence filter.

After grayscale → 2× bilinear interpolation → Otsu thresholding with majority
tone mapped to black background: 8/10 exact boards, 808/810 correct cell values.
Both inverted digits and the fully highlighted notes cell are now correct.
The two remaining false detections are 7870 r4c1 and 7871 r7c1, where small
highlight boxes behind individual pencil notes join into a large ink cluster.
All 191 actual digit cells still pass the presence filter.

After removing the unintended 2× upscaling, grayscale → Otsu threshold →
majority-background normalization gives the same 8/10 boards and 808/810 cells.
Updated stage images are saved in `data/img/cropped/intermediates-threshold/`.

With component merge distance set to 7% of original cell width, the comparison
passes all 10 boards (810/810 cells), with no missed digits or notes-only cells
accepted. Earlier intermediate images above document the previous 10% run.
