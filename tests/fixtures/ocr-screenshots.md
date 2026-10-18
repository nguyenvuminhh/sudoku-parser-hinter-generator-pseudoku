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
28×28 MNIST classification. It reproduces all 810 expected cells in Chromium
and WebKit. Earlier diagnostic images in the local `intermediates` folders
document previous preprocessing experiments, including the rejected 10% merge
radius; they are not current browser output.

`ocr-browser.png` is a small synthetic Sudoku grid with large digits at R1C1=7,
R5C5=6, R9C9=2, and pencil notes at R2C2. It is tracked so the complete browser
OCR pipeline can be tested without private/local screenshots or other tooling.
