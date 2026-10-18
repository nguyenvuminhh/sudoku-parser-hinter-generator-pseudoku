# Third-Party Notices

Puzzle Hint is released under the MIT License. This file records practical
attribution and notice-preservation information for important third-party
software, model assets, and build-time packages used by the project. It is a
summary for project maintenance and public releases, not legal advice.

Dependency versions are controlled by:

- Python backend: `requirements.txt` and `requirements-model.txt`
- Frontend: `frontend/package.json` and `frontend/package-lock.json`
- Rust Sudoku engine wrapper: `tools/sudoku-engine-cli/Cargo.toml`
- Docker image contents: `Dockerfile`

## Backend Python Runtime

The FastAPI service and OCR/import pipeline use these principal Python
dependencies and their transitive dependency trees:

| Project | Purpose | SPDX license | Source |
| --- | --- | --- | --- |
| FastAPI | Backend API framework | MIT | https://github.com/fastapi/fastapi |
| Starlette | ASGI toolkit used by FastAPI | BSD-3-Clause | https://github.com/encode/starlette |
| Uvicorn | ASGI production server | BSD-3-Clause | https://github.com/encode/uvicorn |
| python-multipart | Upload/form parsing for FastAPI file uploads | Apache-2.0 | https://github.com/Kludex/python-multipart |
| httpx | Test client transport dependency for FastAPI/Starlette tests | BSD-3-Clause | https://github.com/encode/httpx |
| NumPy | Numeric arrays and image preprocessing | BSD-3-Clause | https://github.com/numpy/numpy |
| OpenCV / opencv-python-headless | Sudoku grid extraction and image processing | Apache-2.0 | https://github.com/opencv/opencv and https://github.com/opencv/opencv-python |

The product direction keeps OpenCV grid extraction as the image import path.

## Optional Model Runtime

The static frontend ships a copy of `mnist-8.onnx` from
`https://huggingface.co/onnxmodelzoo/mnist-8` (Apache-2.0), stored in
`frontend/assets/mnist-8.onnx`. It runs locally using `onnxruntime-web` (MIT)
and OpenCV.js via `@techstark/opencv-js` (Apache-2.0). The build copies the
model notice, OpenCV license, and ONNX Runtime license/third-party notices
alongside the browser runtime in `frontend/public/ocr/runtime/`. Those runtime
files are built from pinned npm dependencies and served from the app's own
static host; image data is not sent to an external recognition service.

Browser asset preparation uses esbuild (MIT). Browser integration tests use
Playwright (Apache-2.0); neither is loaded by the running app.

`requirements-model.txt` enables the optional ONNX digit classifier support:

| Project | Purpose | SPDX license | Source |
| --- | --- | --- | --- |
| onnxruntime | Runs the optional ONNX digit classifier | MIT | https://github.com/microsoft/onnxruntime |
| Hugging Face Hub (`huggingface_hub`) | Downloads the optional model in `scripts/download_digit_model.py` | Apache-2.0 | https://github.com/huggingface/huggingface_hub |

## Downloaded ONNX Model

Docker builds run `scripts/download_digit_model.py`, which downloads:

- Model: `onnxmodelzoo/mnist-8`
- File: `mnist-8.onnx`
- Local path in the app/Docker image: `data/models/onnx-mnist/mnist-8.onnx`
- Source: https://huggingface.co/onnxmodelzoo/mnist-8
- License listed by Hugging Face: Apache-2.0

The repository ignores `data/models/` and `data/img/`, but production Docker
images include the downloaded ONNX model. The download script also writes
`data/models/onnx-mnist/LICENSE-NOTE.txt` beside the model inside generated
runtime artifacts.

## Sudoku Generation Engine

Puzzle generation and advanced human-style Sudoku rating use the Ukodus
`sudoku-core` Rust engine through the local wrapper in `tools/sudoku-engine-cli`.

- Project: Ukodus sudoku-core
- Source: https://github.com/kcirtapfromspace/sudoku-core
- Pinned commit: `ad8f024d507a52eff99fdd8b5173763487b30a31`
- License: MIT
- Copyright: Copyright (c) 2026 Patrick Deutsch

The wrapper crate also uses `serde` and `serde_json`, which are commonly
distributed under MIT OR Apache-2.0. The Docker image compiles the wrapper in a
Rust build stage and copies only the compiled `sudoku-engine` binary into the
Python runtime image.

## Sudoku Hint Engine (WebAssembly)

In-browser hints are produced by the `l2sg` C++ logical Sudoku solver compiled
to WebAssembly via Emscripten. The compiled artifacts are committed to the
repository at `frontend/public/wasm/l2sg.js` and `frontend/public/wasm/l2sg.wasm`
and are shipped with the static frontend; the binding and build pipeline live in
`wasm/`.

- Project: l2sg
- Source: https://github.com/rafaelfassi/l2sg
- License: MIT

The Emscripten-generated glue (`l2sg.js`) is produced by the Emscripten SDK
(MIT / University of Illinois NCSA), which is required only at build time.

## Generated SE Bucket Corpus

The baseline runtime corpus at `data/puzzles/serate-buckets` is generated data
and is committed with the application for simpler deployments. It is produced
by local scripts that use:

- Tdoku candidate generation: https://github.com/t-dillon/tdoku
- Sukaku Explainer `serate` rating: https://github.com/SudokuMonster/SukakuExplainer

Deployments can use the bundled corpus or mount a larger generated corpus beside
the backend and set `PUZZLE_HINT_SERATE_CORPUS_DIR`.

## Frontend Runtime And Build Dependencies

The static Next.js frontend is built from `frontend/package.json` and
`frontend/package-lock.json`. Principal dependencies include:

| Project | Purpose | SPDX license | Source |
| --- | --- | --- | --- |
| Next.js | Static export framework and build system | MIT | https://github.com/vercel/next.js |
| React | UI runtime | MIT | https://github.com/facebook/react |
| React DOM | DOM renderer for React | MIT | https://github.com/facebook/react |
| lucide-react | Icon components | ISC | https://github.com/lucide-icons/lucide |
| TypeScript | Type checking | Apache-2.0 | https://github.com/microsoft/TypeScript |
| Vitest | Frontend tests | MIT | https://github.com/vitest-dev/vitest |
| Vite | Vitest/build tooling dependency | MIT | https://github.com/vitejs/vite |

The npm lockfile also includes common bundled/transitive frontend packages under
MIT, ISC, BSD-3-Clause, Apache-2.0, and 0BSD licenses, including packages such
as `@next/env`, `@next/swc-*`, `@swc/helpers`, `postcss`, `source-map-js`,
`nanoid`, `picocolors`, `fdir`, `picomatch`, `semver`, and `tslib`.

### Frontend Special License Notes

- `caniuse-lite` is present in `frontend/package-lock.json` under CC-BY-4.0.
  It is browser compatibility data used by frontend tooling.
- `lightningcss` and platform-specific `lightningcss-*` packages are present
  under MPL-2.0. These are CSS transform/minification tooling used by the
  Next.js build chain.
- `sharp` is present under Apache-2.0, and optional platform packages for
  `sharp`/`libvips` appear in the lockfile. The `@img/sharp-libvips-*`
  packages are listed under LGPL-3.0-or-later. These packages are optional
  native install/build/runtime helpers for Node-based image handling in the
  Next.js ecosystem; they are not authored application code and are distinct
  from browser-shipped Puzzle Hint source.

For exact frontend dependency versions and resolved package tarballs, use
`frontend/package-lock.json`.
