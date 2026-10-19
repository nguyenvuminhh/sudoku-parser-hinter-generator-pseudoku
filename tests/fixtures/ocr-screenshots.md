The grids in `ocr-screenshots.json` were manually transcribed from the large
cell digits in local screenshots `IMG_7866.PNG` through `IMG_7875.PNG`. Dots
mean blank or notes-only cells. Images 7866–7874 show the same puzzle with
different highlights; 7875 shows a different puzzle.

Reusable board-only crops are kept locally in `data/img/cropped/`, preserving
the original screenshots. Neither the originals nor crops are included in Git.
The browser integration suite automatically uses these crops when present:

```sh
cd frontend
npm run build
npx playwright test client-only
```

The processing pipeline is grayscale → Otsu threshold → majority-background
normalization → connected component merging at 7% of original cell width →
cluster eligibility → 28×28 MNIST classification. Eligible clusters have a
longest side at least 40% of the original cell width, with both sides strictly
below 90% of the inset crop width. It reproduces all 810 expected cells in Chromium
and WebKit. Earlier diagnostic images in the local `intermediates` folders
document previous preprocessing experiments, including the rejected 10% merge
radius; they are not current browser output.

`ocr-browser.png` is a small synthetic Sudoku grid with large digits at R1C1=7,
R5C5=6, R9C9=2, and pencil notes at R2C2. It is tracked so the complete browser
OCR pipeline can be tested without private/local screenshots or other tooling.

`ocr-highlighted-border.png` is the supplied 1206×1211 screenshot with the full
outer border. Its 22 large digits must be recognized without the seven false
ones previously produced in blank cells. `ocr-clipped-border.png` is the
separate 813×799 crop of the same board, with top, right, and bottom borders
clipped; it must request an image with the full outer border visible.

`ocr-decorative-digits.png` is the supplied 2048×2048 colored grid with 23
printed digits. At normalized cell resolution their heights are only 22–23
pixels out of 50, so a 50% minimum rejected every digit. The 40% cutoff admits
all 23 while leaving blank cells empty. The bundled MNIST model still confuses
the curled 2 at R6C4 with 8, and can confuse R7C9=9 with 6 when cropping is
skipped. Browser tests verify extraction and the editable correction workflow;
these model errors are not treated as correct classifications.
