# Pseudoku

Sudoku parser, hinter, generator

A Sudoku workspace that runs entirely in your browser. Serve it as static files:
there are no accounts, databases, app servers, or external runtime services.

Repository: [nguyenvuminhh/sudoku-parser-hinter-generator-pseudoku](https://github.com/nguyenvuminhh/sudoku-parser-hinter-generator-pseudoku).

Live app: [pseudoku.duckdns.org](https://pseudoku.duckdns.org).

## Core features

- Pick from 78,213 SE-rated puzzles across eight difficulty levels.
- Import a Sudoku image, paste an 81-character puzzle, or enter clues on the board.
- Get logical hints with explanations, highlighted evidence, and candidate eliminations.
- Advanced contradiction and forcing chains supplement the l2sg WebAssembly solver.
- Check the board and detect completed puzzles locally.
- Corner/center notes, color paint, multi-selection, quick fill, auto notes, undo/redo.
- Local timer and finish statistics, including hints and checks used.
- Save the current board and settings in browser storage and restore them on reload.
- Copy a share URL containing the puzzle itself; no sharing service is involved.

## Run locally

Use Node.js 22 or newer and npm:

```sh
cd frontend
npm ci
npm run dev
```

Open `http://localhost:3000`. From the repository root, `make fe` or `make dev`
starts the same development server. No credentials or environment file is needed.

## Build and host

```sh
make build
make serve
```

Open `http://127.0.0.1:3100`. The complete production app is in `frontend/out`;
copy that directory to any static host. The local Node server only serves files
for preview; the deployed app requires no server-side application code.

For hosting below a path such as GitHub Pages project hosting, set
`NEXT_PUBLIC_BASE_PATH=/sudoku-parser-hinter-generator-pseudoku` when building. Leave it blank for root hosting.
Vercel builds from the repository root using `vercel.json` and serves
`frontend/out`. Pushes to `main` publish to `https://pseudoku.duckdns.org`;
pull requests receive preview deployments through the Vercel GitHub integration.
Unit tests and type checking must pass before a deployment builds. Leave
`NEXT_PUBLIC_BASE_PATH` unset on Vercel because the app is hosted at the domain root.
The GitHub Pages workflow remains available as a manually triggered alternative.

All fonts, solver code, OCR libraries, model weights, and puzzle files are served
from your own static host. Image import is lazy-loaded and runs in a Web Worker;
images stay on the device. Initial asset downloads need a connection; the app
does not currently install an offline service worker.

## Puzzle selection

The build converts the checked-in corpus in `data/puzzles/serate-buckets` into
small static chunks. The browser selects a puzzle locally and downloads only its
chunk, preserving the existing SE ratings and difficulty buckets. The Generate
control deals a puzzle from this collection rather than invoking a remote generator.

## Image parsing

The browser uses OpenCV.js to find the grid, correct its perspective, and split
it into 81 cells. Each cell is trimmed to remove borders, converted to grayscale,
and thresholded into black and white. The majority tone becomes the background.
Nearby ink components merge within 7% of the original cell width. Only a single
cluster whose longest dimension reaches 50% of the cell width is classified.
The original strokes are centered in a 28×28 image for the bundled MNIST model,
run locally with ONNX Runtime Web. Small pencil notes are skipped.

Recognition is an editable assistant: review the imported board before solving.
The model and runtime assets are bundled; there is no model download/setup step
outside normal `npm ci` and `npm run build`.

## Logical hints

The browser first uses l2sg and its pattern techniques. When those stall, a local
chain solver derives implications from the current candidates. Each advanced
hint includes a proof certificate that is replayed independently before it is
shown, followed by the deductions in the hint panel. Hints never reveal stored
solution digits. See [the WASM documentation](wasm/README.md).

The upgraded engine solves both fixed Advanced 8+ samples iteratively:

- [First 10 puzzles](docs/benchmarks/advanced-8-plus.md), SE 8.2–9.0.
- [Additional 20 puzzles](docs/benchmarks/advanced-8-plus-additional-20.md), SE 8.3–8.9.

All 30 complete in Chromium and WebKit, with each placement and elimination
checked against its known solution. This establishes coverage of these samples,
not every possible puzzle.

## Checks

From the repository root:

```sh
make test
make build
```

Browser checks (install the test browsers once):

```sh
cd frontend
npx playwright install chromium webkit
npm run test:browser
```

The browser suite covers static puzzle loading, logical hints, image upload,
completion statistics, local recovery, and play without accounts or external
network services. If the local screenshots exist in `data/img/cropped`, it also
checks their 810 cells against `tests/fixtures/ocr-screenshots.json`.

To rerun the additional 20-puzzle benchmark:

```sh
cd frontend
HINT_BENCHMARK_FIXTURE=../tests/fixtures/advanced-8-plus-additional-20.json npx playwright test advanced-benchmark
```

Browser assets and static puzzle chunks are generated automatically before dev
and production builds. They are ignored by Git; the sources and model are tracked.
After editing the OCR or chain-solver TypeScript while developing, rerun
`npm run prepare:browser` or restart the development server to rebuild worker code.

## Third-party notices

See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for dependency, model,
solver, and puzzle-corpus attribution. The project itself is MIT licensed.
