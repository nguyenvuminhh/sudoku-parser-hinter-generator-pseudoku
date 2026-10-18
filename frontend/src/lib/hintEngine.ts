// Typed client for the l2sg WebAssembly hint solver. The wasm runs in a Web
// Worker (public/wasm/hint-worker.js) so solving never blocks the main thread;
// this module owns a single worker for the page lifetime and multiplexes
// requests over it by id. See ../../wasm/README.md for the build pipeline.
import type { ChainProof } from "./advanced-hints";

// Mirrors the JSON emitted by wasm/bindings.cpp. Cell values are board indices
// (0..80, index = row * 9 + col).
export interface HintResult {
  /** Ordered logical deductions for advanced chain hints. */
  explanation?: string[];
  /** Replayable exact-one implication certificate; no solution lookup. */
  proof?: ChainProof;
  /** l2sg display name, e.g. "Naked Single", "X-Wings". */
  technique: string;
  /** One-line human readable summary of the step. */
  description: string;
  /** Rank, lower = simpler technique. */
  difficulty: number;
  /** Cell indices that form the pattern (highlight as "primary"). */
  causalCells: number[];
  /** Cell indices where candidates are removed. */
  eliminationCells: number[];
  /** Candidate eliminations the step makes. */
  eliminations: Array<{ cell: number; digit: number }>;
  /** Set when the step places a value, otherwise null. */
  placement: { cell: number; digit: number } | null;
}

type WorkerMessage =
  | { type: "ready" }
  | { type: "error"; error: string }
  | { type: "result"; id: number; hint: HintResult | null }
  | { type: "result"; id: number; error: string };

type Pending = {
  resolve: (value: HintResult | null) => void;
  reject: (reason: Error) => void;
};

// Matches next.config.ts so the worker resolves under a configured basePath.
const rawBasePath = process.env.NEXT_PUBLIC_BASE_PATH?.trim() ?? "";
const basePath = rawBasePath && rawBasePath !== "/" ? `/${rawBasePath.replace(/^\/+|\/+$/g, "")}` : "";
const WORKER_URL = `${basePath}/wasm/hint-worker.js`;

function hintErrorMessage(code: string): string {
  switch (code) {
    case "invalid_format":
      return "The hint engine could not read the board.";
    case "unsolvable":
      return "This board has no valid solution, so no hint is available.";
    case "invalid_candidates":
      return "The current notes contradict Sudoku constraints. Restore missing candidates or check the board before asking for a hint.";
    default:
      return code || "Hint generation failed.";
  }
}

class HintEngineClient {
  private readonly worker: Worker;
  private readonly pending = new Map<number, Pending>();
  private nextId = 0;
  private loadError: Error | null = null;
  private resolveReady!: () => void;
  private rejectReady!: (error: Error) => void;
  /** Resolves once the wasm module has loaded; rejects if it fails to. */
  readonly ready: Promise<void>;

  constructor() {
    this.ready = new Promise<void>((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });
    // Classic worker (no { type: "module" }) so it can importScripts the glue.
    this.worker = new Worker(WORKER_URL);
    this.worker.addEventListener("message", this.handleMessage);
    this.worker.addEventListener("error", this.handleError);
  }

  private handleMessage = (event: MessageEvent<WorkerMessage>) => {
    const data = event.data;
    if (data.type === "ready") {
      this.resolveReady();
      return;
    }
    if (data.type === "error") {
      this.fail(new Error(data.error || "Hint engine failed to load."));
      return;
    }
    // data.type === "result"
    const pending = this.pending.get(data.id);
    if (!pending) {
      return;
    }
    this.pending.delete(data.id);
    if ("error" in data) {
      pending.reject(new Error(hintErrorMessage(data.error)));
    } else {
      pending.resolve(data.hint);
    }
  };

  private handleError = (event: ErrorEvent) => {
    this.fail(new Error(event.message || "Hint worker crashed."));
  };

  /** Records a fatal load/worker error and rejects every outstanding request. */
  private fail(error: Error) {
    this.loadError = error;
    this.rejectReady(error);
    for (const pending of this.pending.values()) {
      pending.reject(error);
    }
    this.pending.clear();
  }

  /**
   * Returns the next logical step for `puzzle` (81 chars, 0/. for empty), or
   * null when no supported logical step is found (including solved boards).
   * `candidates` are optional pencil marks (see hint-worker.js / bindings)
   * so the hint respects work the player has already done.
   */
  async getHint(puzzle: string, candidates = ""): Promise<HintResult | null> {
    if (this.loadError) {
      throw this.loadError;
    }
    await this.ready;
    const id = this.nextId++;
    return new Promise<HintResult | null>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ type: "hint", id, puzzle, candidates });
    });
  }
}

let singleton: HintEngineClient | null = null;

/**
 * Lazily creates the shared hint engine. The worker lives for the page lifetime
 * so the wasm module is loaded once, not per hint request (and not torn down on
 * a transient component unmount).
 */
export function getHintEngine(): HintEngineClient {
  if (typeof window === "undefined") {
    throw new Error("The hint engine is only available in the browser.");
  }
  if (!singleton) {
    singleton = new HintEngineClient();
  }
  return singleton;
}

export type { HintEngineClient };
