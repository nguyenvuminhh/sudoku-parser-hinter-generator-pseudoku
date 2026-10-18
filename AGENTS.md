# AGENTS.md

## Project

Pseudoku is a client-only Sudoku workspace.

- App: static-exported Next.js in `frontend`.
- Production: `npm run build` in `frontend`, then host `frontend/out` as static files.
- All puzzle selection, validation, solving, hints, and image parsing run locally.
- Do not introduce accounts, databases, application backends, external APIs, or cloud saves.

## Commands

From the repo root:

```sh
make fe
make test
make build
make serve
```

From `frontend/`:

```sh
npm test -- --run
npm run typecheck
npm run build
npx playwright install chromium webkit
npm run test:browser
```

## Editing Guidance

- Keep Sudoku state, validation, and solution checks in `frontend/src/lib/sudoku-state.ts`.
- Keep the tutor workspace in `frontend/src/app/page.tsx`; compose hooks from
  `frontend/src/hooks` and presentational components from `frontend/src/components`.
- Keep hint/check helpers in `frontend/src/lib/hints.ts` and shared constants
  in `frontend/src/lib/constants.ts`.
- Keep the advanced chain solver in `frontend/src/lib/advanced-hints.ts`; every
  advanced hint must pass its independent proof verifier.
- Keep image processing in `frontend/src/lib/ocr-processing.ts`, with inference
  in `frontend/public/ocr/ocr-worker.js`. Images must remain on the device.
- The model is bundled at `frontend/assets/mnist-8.onnx` (Apache-2.0).
- Use OpenCV grid extraction before digit classification; do not add non-grid
  OCR paths or external AI services.
- Ignore small pencil notes. Treat image import as editable and potentially wrong.
- `frontend/scripts/prepare-browser-assets.mjs` builds the OCR and chain-solver
  bundles and static puzzle chunks before dev/build. Rebuild it after editing worker logic.
- Add behavior tests before changing behavior. Use Vitest + Testing Library for
  React behavior, tests beside lib modules for pure logic, and Playwright for
  the real browser/WASM pipeline. Do not string-match component source code.
- Preserve the two frozen Advanced 8+ benchmark samples and all local-only workflows.

## UX Rules

- Keep a distinct tutor workspace, not a clone of a reference solver site.
- Board entry uses `1`–`9`; `Space`, `Backspace`, `Delete`, and `0` clear a cell.
- Single-selection entry advances to the next empty cell.
- Modes: Normal, Corner notes, Center notes, Color paint. `Tab` cycles modes;
  `Z`/`X`/`C`/`V` select them directly.
- Support click-drag multi-selection, `Alt`/`Ctrl`+click toggling, and
  `Shift`+arrows. Digits, notes, and colors apply to the selection.
- Primary controls live in the right rail, above the strategy note.
- A correct complete board opens the finish dialog with local solve statistics.
- Preserve local board recovery, settings, theme, and self-contained share URLs.
