/*
 * Classic Web Worker that runs the l2sg hint solver (WebAssembly) off the main
 * thread. Built artifacts (l2sg.js + l2sg.wasm) sit next to this file and are
 * produced by ../../wasm/build.sh.
 *
 * Protocol (see ../src/lib/hintEngine.ts):
 *   main -> worker:  { type: "hint", id, puzzle, candidates }
 *   worker -> main:  { type: "ready" }
 *                    { type: "error", error }                      // load failed
 *                    { type: "result", id, hint }                  // HintResult | null
 *                    { type: "result", id, error }                 // per-request failure
 */

// importScripts resolves relative to this worker's URL, e.g. /wasm/ (or
// /<basePath>/wasm/), so the wasm is fetched from the same directory.
const baseUrl = self.location.href.replace(/[^/]*$/, "");
self.importScripts(baseUrl + "l2sg.js");

let modulePromise = null;
let advancedLoaded = false;
function getAdvancedHint(puzzle, candidates) {
  if (!advancedLoaded) {
    self.importScripts(baseUrl + "advanced-hints.js");
    advancedLoaded = true;
  }
  const hint = self.AdvancedHints.findAdvancedHint(puzzle, candidates);
  if (hint && !self.AdvancedHints.verifyChainProof(puzzle, candidates, hint)) {
    throw new Error("The chain solver could not verify its explanation. Please try another hint.");
  }
  return hint;
}
function getModule() {
  if (!modulePromise) {
    // createL2sgModule is defined by the emscripten glue (EXPORT_NAME).
    modulePromise = self.createL2sgModule({ locateFile: (path) => baseUrl + path });
  }
  return modulePromise;
}

// Warm the module up immediately so the first hint is fast.
getModule().then(
  () => self.postMessage({ type: "ready" }),
  (err) => self.postMessage({ type: "error", error: String((err && err.message) || err) })
);

self.onmessage = async (event) => {
  const data = event.data;
  if (!data || data.type !== "hint") {
    return;
  }

  const { id, puzzle, candidates } = data;
  try {
    const mod = await getModule();
    const json = mod.getHint(puzzle, candidates || "");
    if (!json || json === "null") {
      self.postMessage({ type: "result", id, hint: getAdvancedHint(puzzle, candidates || "") });
      return;
    }
    const parsed = JSON.parse(json);
    if (parsed && parsed.error) {
      self.postMessage({ type: "result", id, error: parsed.error });
      return;
    }
    self.postMessage({ type: "result", id, hint: parsed });
  } catch (err) {
    self.postMessage({ type: "result", id, error: String((err && err.message) || err) });
  }
};
