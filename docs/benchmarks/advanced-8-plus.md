# Advanced 8+ iterative hint benchmark

Ten puzzles were sampled once from the checked-in Advanced 8+ corpus with
`random.Random(20261018).sample`, then frozen in
[`tests/fixtures/advanced-8-plus-benchmark.json`](../../tests/fixtures/advanced-8-plus-benchmark.json).
The sample was selected before running either solver; no puzzles were replaced.

For each puzzle, start with its givens and legal candidates. Request one hint,
apply its placement or eliminations, prune candidates after placements, and repeat.
Stop on completion, no hint, an error, a repeated step, or 500 steps. Every
placement and elimination is checked against the stored unique solution. The
solution is a test oracle only; it is never sent to the hint worker.

| Puzzle ID suffix | SE | Original solver | Upgraded solver | Hint steps |
| --- | ---: | --- | --- | ---: |
| 000003291 | 8.3 | stalled (43 steps) | solved | 87 |
| 000005397 | 8.3 | solved (94 steps) | solved | 94 |
| 000001044 | 8.4 | stalled (24 steps) | solved | 105 |
| 000007492 | 8.3 | stalled (32 steps) | solved | 96 |
| 000008230 | 9.0 | stalled (16 steps) | solved | 104 |
| 000008929 | 8.2 | stalled (32 steps) | solved | 93 |
| 000001893 | 8.4 | stalled (31 steps) | solved | 96 |
| 000003617 | 8.3 | stalled (26 steps) | solved | 101 |
| 000000917 | 8.5 | stalled (17 steps) | solved | 117 |
| 000004466 | 8.4 | stalled (23 steps) | solved | 86 |

Result: original l2sg plus its pattern fallbacks solved 1/10;
the upgraded pipeline solved 10/10 in 979 hint steps.
The upgraded pipeline used 65 verified contradiction-chain steps.
Both Chromium and WebKit produced the same completed grids and hint-step counts.
No incorrect placements, solution-candidate removals, or repeated steps occurred.

The upgrade retains simpler l2sg hints first, then tries exact-one implication
chains, cell forcing chains, and region forcing chains. Every advanced hint
carries a certificate that is replayed independently before returning it to the UI.
These chains use deductions under explicit assumptions, not a solved-grid reveal.

This benchmark establishes coverage of this fixed sample, not every SE 8+ puzzle.

## Rerun

```sh
cd frontend
npm run build
npx playwright test advanced-benchmark
```

Full per-step traces are written into each browser test output directory as
`advanced-8-plus-results.json` under `frontend/test-results/`.

An [additional independent 20-puzzle sample](advanced-8-plus-additional-20.md)
also passes 20/20 with the unchanged upgraded engine (30/30 combined).
