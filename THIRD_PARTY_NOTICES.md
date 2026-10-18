# Third-Party Notices

Pseudoku is MIT licensed. This maintenance summary records attribution for
software and assets shipped with the static app; it is not legal advice.
Exact package versions are pinned in `frontend/package-lock.json`.

## Browser image processing and model

| Project | Purpose | License | Source |
| --- | --- | --- | --- |
| OpenCV.js via `@techstark/opencv-js` | Grid extraction and image processing | Apache-2.0 | https://github.com/TechStark/opencv-js and https://github.com/opencv/opencv |
| ONNX Runtime Web | Local MNIST inference in WebAssembly | MIT | https://github.com/microsoft/onnxruntime |
| `onnxmodelzoo/mnist-8` | Bundled handwritten digit classifier | Apache-2.0, as listed by the model host | https://huggingface.co/onnxmodelzoo/mnist-8 |

The model is stored at `frontend/assets/mnist-8.onnx`, with its source/license
note beside it. ONNX Runtime license and third-party notices are stored in
`frontend/assets`. The asset build copies these notices and the OpenCV package
license alongside the generated runtime under `frontend/public/ocr/runtime`.
All runtime files are served by the static host. Images remain on the device.

## Logical hint engine

The l2sg C++ solver is compiled to WebAssembly and shipped as
`frontend/public/wasm/l2sg.js` and `l2sg.wasm`.

- Source: https://github.com/rafaelfassi/l2sg
- License: MIT
- Binding and rebuild instructions: `wasm/`

Emscripten-generated glue is produced with the Emscripten SDK (MIT / University
of Illinois NCSA). That SDK is needed only to rebuild the C++ solver. The local
TypeScript chain solver and its proof verifier are part of Pseudoku.

## Puzzle corpus

The checked-in corpus at `data/puzzles/serate-buckets` is generated puzzle data.
Its provenance includes Tdoku candidate generation and Sukaku Explainer `serate`
ratings:

- https://github.com/t-dillon/tdoku
- https://github.com/SudokuMonster/SukakuExplainer

Neither generator runs in the app. The build converts the existing corpus into
static chunks, preserving puzzle solutions and SE ratings.

## Frontend and build dependencies

| Project | Purpose | License | Source |
| --- | --- | --- | --- |
| Next.js | Static export and build system | MIT | https://github.com/vercel/next.js |
| React / React DOM | Browser UI | MIT | https://github.com/facebook/react |
| lucide-react | Icons | ISC | https://github.com/lucide-icons/lucide |
| Inter / Fraunces via Fontsource | Locally served fonts | SIL OFL-1.1 | https://github.com/fontsource/font-files |
| TypeScript | Type checking | Apache-2.0 | https://github.com/microsoft/TypeScript |
| esbuild | Worker bundle preparation | MIT | https://github.com/evanw/esbuild |
| Vitest / Vite | Unit and behavior tests | MIT | https://github.com/vitest-dev/vitest |
| Playwright | Browser integration tests | Apache-2.0 | https://github.com/microsoft/playwright |

Build/test dependencies are not application services. Fonts, JavaScript, model,
WASM, and puzzle assets are served from the same static host as the page.

The npm lockfile includes transitive packages under MIT, ISC, BSD-3-Clause,
Apache-2.0, 0BSD, and other licenses. Relevant build dependency notes:

- `caniuse-lite`: CC-BY-4.0 browser compatibility data.
- `lightningcss`: MPL-2.0 CSS build tooling.
- `sharp`: Apache-2.0; optional `libvips` distributions include LGPL-3.0-or-later.

Refer to the packages and lockfile for complete version-specific notices.
