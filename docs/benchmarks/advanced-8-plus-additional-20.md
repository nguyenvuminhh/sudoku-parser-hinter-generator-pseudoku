# Additional 20 Advanced 8+ puzzles

An independent sample was frozen before testing using `random.Random(20261019)`.
The original ten IDs and puzzle grids were excluded; duplicate grids were removed
from the sampling pool. The engine was unchanged during this benchmark.

Fixture: [`advanced-8-plus-additional-20.json`](../../tests/fixtures/advanced-8-plus-additional-20.json).

The same iterative harness and stored-solution checks described in the
[first benchmark](advanced-8-plus.md) were used.

| Puzzle ID suffix | SE | Original engine | Upgraded engine | Hint steps |
| --- | ---: | --- | --- | ---: |
| 000009658 | 8.4 | stalled (26 steps) | solved | 101 |
| 000005293 | 8.4 | stalled (36 steps) | solved | 112 |
| 000001973 | 8.4 | stalled (21 steps) | solved | 85 |
| 000003476 | 8.3 | stalled (16 steps) | solved | 82 |
| 000007709 | 8.3 | stalled (41 steps) | solved | 92 |
| 000008844 | 8.3 | stalled (33 steps) | solved | 107 |
| 000004800 | 8.3 | stalled (38 steps) | solved | 108 |
| 000004376 | 8.6 | stalled (11 steps) | solved | 112 |
| 000000453 | 8.8 | stalled (16 steps) | solved | 119 |
| 000005720 | 8.3 | stalled (7 steps) | solved | 88 |
| 000002260 | 8.8 | stalled (26 steps) | solved | 111 |
| 000000090 | 8.4 | stalled (24 steps) | solved | 103 |
| 000008944 | 8.4 | stalled (26 steps) | solved | 118 |
| 000004824 | 8.4 | stalled (20 steps) | solved | 105 |
| 000007219 | 8.3 | stalled (32 steps) | solved | 99 |
| 000004450 | 8.9 | stalled (16 steps) | solved | 122 |
| 000009129 | 8.4 | stalled (16 steps) | solved | 111 |
| 000005180 | 8.3 | stalled (23 steps) | solved | 107 |
| 000001266 | 8.4 | stalled (15 steps) | solved | 121 |
| 000001293 | 8.5 | stalled (15 steps) | solved | 128 |

Result: original engine **0/20**, upgraded engine **20/20**.
The upgraded engine completed **2131 hint steps**, including **281 verified contradiction-chain steps**.
Every placement and elimination was checked against the stored solution.
Chromium and WebKit returned the same completed grids and hint-step counts.

Combined with the first sample: **30/30 puzzles solved iteratively**. This is
coverage of these fixed samples, not a claim of universal Advanced 8+ coverage.

## Rerun

```sh
cd frontend
npm run build
HINT_BENCHMARK_FIXTURE=../tests/fixtures/advanced-8-plus-additional-20.json npx playwright test advanced-benchmark
```

Full per-step traces are saved under `frontend/test-results/` as
`advanced-8-plus-results.json` for each browser and engine.
