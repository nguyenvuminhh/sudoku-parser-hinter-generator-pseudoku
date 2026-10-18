# Puzzle Hint

Sudoku-first tutor that runs entirely in the browser, served as a static Next.js export. Supabase is optional for accounts and leaderboards. The Python backend remains available for development and standalone API use.

## What is built

- Manual Sudoku entry and clean image upload flow.
- Keyboard entry for the board: `1`-`9` fill cells, and `Space`, `Backspace`, `Delete`, or `0` clear cells.
- Correction-first validation for invalid grids and low-confidence OCR cells.
- Step-by-step hints with technique name, conclusion, layered explanation, highlights, and history.
- Advanced hints include verified contradiction and forcing chains; the [fixed Advanced 8+ benchmark](docs/benchmarks/advanced-8-plus.md) checks iterative completion of ten rated puzzles.
- Local puzzle selection from 78,213 pregenerated, SE-rated puzzles across eight difficulty levels.
- Row/column/box peer highlighting around the selected cell.
- Corner notes, center notes, and a 9-color cell paint mode (`Tab` cycles modes, `Z`/`X`/`C`/`V` jump directly).
- Multi-cell selection with click-drag, `Alt`/`Ctrl`+click, and `Shift`+arrows; entry applies to the whole selection.
- Solve clock with pause (board hidden while paused) and automatic solved detection with elapsed time.
- Finish dialog with solve statistics: time, hints and checks used, cells filled, and hint techniques encountered.
- Keypad remaining-digit counts and auto-advancing quick fill digit, both toggleable in Settings.
- Undo and redo (`Ctrl+Z` / `Ctrl+Y`), and the in-progress game survives page reloads via local storage.
- Image import, validation, solution checking, and logical hints run on the device; uploaded images never go to an API.
- Optional FastAPI API routes under `/api/sudoku/*` remain available for standalone tools.
- Next.js static export that can be served by FastAPI or deployed separately.

## Run locally

Only Node.js and npm are needed for the tutor:

```bash
cd frontend
npm ci
npm run dev
```

Open `http://localhost:3000`. From the repo root, `make fe` does the same.
No FastAPI process or `make model` step is required for the browser app.

For production-style static serving:

```bash
cd frontend
npm run build
node scripts/serve-static.mjs
```

Then open `http://127.0.0.1:3100`. Deploy the generated `frontend/out` directory
to any static host. `npm run dev` and `npm run build` prepare browser assets
from pinned npm dependencies, the bundled 26 KB MNIST model, and the checked-in
SE corpus. Generated runtime and puzzle files are ignored by Git.

## Public deployment

Deploy `frontend/out` to GitHub Pages or another static host. The workflow at
`.github/workflows/frontend-pages.yml` builds the complete app; no API server
or `NEXT_PUBLIC_API_BASE_URL` is needed. Set `NEXT_PUBLIC_BASE_PATH=/<repo-name>`
for project Pages hosting, or leave it blank for root hosting.

OCR libraries load only when image import is used, inside a Web Worker. All
runtime files and the model are served from the same static host. Puzzle
selection fetches a small static chunk for the chosen level rather than the
whole collection. Initial asset downloads still need a connection; this is not
a fully offline/PWA installation.

### Optional legacy backend

The FastAPI service can still be deployed on Amazon EC2 or run locally for
standalone API consumers, regression comparisons, and corpus tools. It is
independent of browser gameplay. Install `requirements.txt` and use `make be`
for local API development. The legacy Rust generator is needed only for API
requests when the local corpus is absent.

Backend container:

```bash
docker build -t puzzle-hint-api .
docker run -d \
  --name puzzle-hint-api \
  --restart unless-stopped \
  -p 127.0.0.1:8001:8001 \
  -e PUZZLE_HINT_CORS_ORIGINS=https://<github-user>.github.io,https://<github-user>.github.io/<repo-name> \
  puzzle-hint-api
```

The backend image uses a multi-stage Docker build: Rust compiles the local
`tools/sudoku-engine-cli` wrapper, then the Python runtime image copies only the
compiled `sudoku-engine` binary. Bare-metal backend runs need that binary at
`bin/sudoku-engine` or `SUDOKU_ENGINE_BIN=/path/to/sudoku-engine`.

The baseline SE bucket corpus is committed at `data/puzzles/serate-buckets` and
is copied into the backend Docker image. The backend also reads
`PUZZLE_HINT_SERATE_CORPUS_DIR` when set, which is useful for overriding the
bundled corpus with a larger server-mounted corpus. If the corpus is missing,
`easy` through `master` fall back to `sudoku-engine`; `extreme` and advanced
levels require the corpus.

GitHub Pages repository variable:

```text
NEXT_PUBLIC_BASE_PATH=/<repo-name>
```

Leave `NEXT_PUBLIC_BASE_PATH` blank for a user or organization Pages site at
`https://<github-user>.github.io/`.

## Supabase Auth and Leaderboards

Guest play is local-only by default and does not start a Supabase anonymous
session or touch leaderboard storage. Supabase is used only when a
non-anonymous signed-in session exists. Without Supabase environment variables,
Sudoku play still works and the account and leaderboard UI shows the cloud
features as unavailable.

Create a Supabase project, keep Auth anonymous sign-ins disabled, and run:

```sql
-- In Supabase SQL editor or through the Supabase CLI:
-- supabase/migrations/202606160001_auth_leaderboards.sql
```

Frontend build variables:

```text
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<publishable-or-anon-key>
```

For GitHub Pages deploys, set those as GitHub Actions repository variables
alongside `NEXT_PUBLIC_BASE_PATH`; the static
frontend must receive them during `npm run build`.

The browser uses the public key only. Do not put a Supabase service-role key in
frontend environment variables. Completed solves are saved as leaderboard
records only for non-anonymous signed-in users; V1 does not apply clean-solve
filtering after a solve is eligible to save.

### Supabase migration deployment

Checked-in Supabase migrations deploy through
`.github/workflows/supabase-migrations.yml`. The workflow runs on pushes to
`main` that change `supabase/migrations/**`, and it can also be run manually
from GitHub Actions.

Add these GitHub Actions repository secrets before enabling automatic
migrations:

```text
SUPABASE_ACCESS_TOKEN=<Supabase personal access token>
SUPABASE_PROJECT_ID=<project-ref>
SUPABASE_DB_PASSWORD=<database password>
```

The workflow installs the Supabase CLI, links the project, and runs
`supabase db push --linked`. Keep anonymous sign-ins disabled in Supabase Auth.

### Supabase Auth URL configuration

The migration workflow also updates Supabase Auth URL settings through the
Management API. By default it sets the Auth Site URL to the GitHub Pages URL
derived from `NEXT_PUBLIC_BASE_PATH` and adds that URL plus local development
URLs to the redirect allow-list:

```text
https://<github-user>.github.io/<repo-name>/
http://localhost:3000/**
http://127.0.0.1:3000/**
```

Set `SUPABASE_AUTH_SITE_URL` as a GitHub Actions repository variable only when
the production frontend uses a custom domain or a non-standard Pages URL. Set
`SUPABASE_AUTH_REDIRECT_URLS` to add more comma-separated redirect URLs, such as
preview deployment URLs.

## Image Import Pipeline

The upload endpoint is local-first and uses OpenCV grid extraction before digit
classification.

Current flow:

```text
image upload
-> OpenCV grayscale/threshold processing
-> largest square contour detection
-> perspective warp to a flat 9x9 grid
-> split into 81 cell images
-> blank detection that ignores small pencil notes
-> digit classifier
-> Sudoku consistency warnings
-> editable correction grid
```

The browser uses OpenCV.js for grid extraction, then thresholds each grayscale
cell with Otsu's method and maps the majority tone to black background. It
merges ink components within 7% of the original cell width and accepts only
one cluster whose longest dimension is at least 50% of the cell width. It
normalizes the original strokes to 28×28 and runs the bundled MNIST model via
ONNX Runtime Web (single-threaded WebAssembly, inside the worker).

The model predicts labels `0..9`; `0` is treated as empty. Image import remains
an editable assistant: review classified digits before solving. The browser
never uploads the image or calls an external recognition service.

The optional Python importer can use the same model after `make model` downloads
it into `data/models/onnx-mnist/mnist-8.onnx`; `SUDOKU_DIGIT_MODEL` overrides
that backend path. The browser model is bundled in `frontend/assets`.

Browser integration checks against the static export:

```bash
cd frontend
npx playwright install chromium webkit
npm run test:browser
```

Tests cover all eight levels, WASM hints, image upload, invalid uploads, and
client-side OCR. If the ten local crops exist under `data/img/cropped`, the
suite also checks their 810 cells against the manually transcribed grids in
`tests/fixtures/ocr-screenshots.json`; those private/local images are not in Git.

## Master and Extreme Corpus Generation

For a large pregenerated hard-puzzle corpus, use Tdoku for fast candidate
generation and Sukaku Explainer `serate` as the rating gate. The repository
script keeps only puzzles that actually rate as hard enough by SE rating:

- `master`: `8.0 <= SE rating < 10.0`
- `extreme`: `SE rating >= 10.0`

Both thresholds are configurable with `--master-min-rating` and
`--extreme-min-rating`. On Apple Silicon local generation, `extreme >= 9.0`
is a more practical starting point than `>= 10.0`.

Install or build these outside this repository:

- Tdoku: https://github.com/t-dillon/tdoku
- Sukaku Explainer / serate jar: https://github.com/SudokuMonster/SukakuExplainer

Example local run for a small smoke test:

```bash
python3 scripts/generate_hard_sudoku_corpus.py \
  --candidate-command "/path/to/tdoku/build/generate -p0 -c0 -g1 -d1 -n100 -e50 -s0 -l 10000 -a1" \
  --serate-jar /path/to/SukakuExplainer.jar \
  --target-per-level 10 \
  --chunk-size 5 \
  --batch-size 250 \
  --max-candidates 10000 \
  --master-min-rating 8.0 \
  --extreme-min-rating 9.0 \
  --threads 10 \
  --output-dir data/puzzles/serate-hard
```

For the full local corpus, keep the same command shape and use the default
`--target-per-level 1000000`. Output is written as gzip-compressed NDJSON chunks:

```text
data/puzzles/serate-hard/
  manifest.json
  master/part-000000.ndjson.gz
  extreme/part-000000.ndjson.gz
```

Each record includes the puzzle, solution, SE rating, pearl rating, diamond
rating, and highest-rated serate technique. Existing chunks are scanned on
startup, so rerunning the command resumes without duplicating already written
puzzles.

### Faster Seed Expansion Workflow

For million-record corpora, prefer verified hard seeds plus Sudoku-preserving
transformations over brute-force candidate generation. The local Tdoku checkout
ships `data.zip`, whose `data/puzzles5_forum_hardest_1905_11+` member is
documented by Tdoku as about 49,000 very difficult puzzles with Sudoku
Explainer ratings of 11 or higher.

Verify a small seed catalog and expand it:

```bash
python3 scripts/expand_hard_sudoku_seeds.py \
  --seed-zip tdoku/data.zip \
  --seed-member data/puzzles5_forum_hardest_1905_11+ \
  --seed-catalog data/puzzles/verified-extreme-seeds.ndjson.gz \
  --serate-jar SukakuExplainer.jar \
  --java-bin /opt/homebrew/opt/openjdk/bin/java \
  --threads 10 \
  --verify-batch-size 50 \
  --max-seeds 100 \
  --levels extreme \
  --target-per-level 1000 \
  --chunk-size 100 \
  --output-dir data/puzzles/expanded-extreme \
  --extreme-min-rating 9.0
```

For a full extreme corpus, remove `--max-seeds` after the smoke test and set
`--target-per-level 1000000`. The script verifies each seed once with `serate`,
solves it once, then creates variants using digit relabeling, row/column swaps
within valid bands/stacks, band/stack swaps, and transpose. These transformations
preserve Sudoku structure and logical difficulty while producing different
puzzle/solution strings.

### Full SE Bucket Corpus

To fill all app difficulty buckets from one candidate stream, use
`scripts/generate_serate_bucket_corpus.py`. The default buckets are:

```text
easy              [1, 2)
medium            [2, 3)
hard              [3, 4)
expert            [4, 5)
master            [5, 6)
extreme           [6, 7)
advanced_7_8      [7, 8)
advanced_8_plus   [8, infinity)
```

Smoke test:

```bash
python3 scripts/generate_serate_bucket_corpus.py \
  --candidate-command "tdoku/build/generate -p0 -c0 -g1 -d1 -n100 -e50 -s0 -l 5000 -a1" \
  --serate-jar SukakuExplainer.jar \
  --java-bin /opt/homebrew/opt/openjdk/bin/java \
  --target-per-bucket 10 \
  --chunk-size 5 \
  --batch-size 50 \
  --max-candidates 5000 \
  --threads 10 \
  --output-dir data/puzzles/serate-buckets-smoke
```

Full run:

```bash
python3 scripts/generate_serate_bucket_corpus.py \
  --candidate-command "tdoku/build/generate -p0 -c0 -g1 -d1 -n500 -e100 -s0 -a1" \
  --serate-jar SukakuExplainer.jar \
  --java-bin /opt/homebrew/opt/openjdk/bin/java \
  --target-per-bucket 1000000 \
  --chunk-size 10000 \
  --batch-size 250 \
  --threads 10 \
  --output-dir data/puzzles/serate-buckets
```

The 9-10 and 10+ buckets are rare with brute-force generation. If those lag,
use the verified seed expansion workflow for advanced buckets and this bucket
script for the common ranges.

At runtime, the committed `data/puzzles/serate-buckets` path works by default.
To override it with a larger server-mounted corpus:

```bash
PUZZLE_HINT_SERATE_CORPUS_DIR=/srv/puzzle-hint/serate-buckets \
python3 -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8001
```

## Third-party notices

Puzzle Hint is MIT-licensed. Important third-party runtime, build-time, OCR,
model, and frontend dependency notices are maintained in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Verification

```bash
python3 -m unittest discover -s tests -v
cd frontend
npm test -- --run
npm run typecheck
npm run build
```
