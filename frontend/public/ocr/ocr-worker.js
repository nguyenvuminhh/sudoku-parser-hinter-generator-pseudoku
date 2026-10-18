/* All image processing stays in this worker. Only local static assets are fetched. */
const runtimeUrl = new URL("runtime/", self.location.href).href;
let runtimePromise;
function runtime() {
  if (!runtimePromise) runtimePromise = (async () => {
    self.importScripts(runtimeUrl + "opencv.js", runtimeUrl + "ort.wasm.min.js", runtimeUrl + "processing.js");
    // This OpenCV build exposes a self-resolving Emscripten thenable, rather
    // than a native Promise. Await runtime readiness without assimilating it.
    await new Promise((resolve, reject) => {
      if (self.cv.Mat) resolve();
      else {
        self.cv.onRuntimeInitialized = () => resolve();
        self.cv.onAbort = reason => reject(new Error(String(reason)));
      }
    });
    const cv = self.cv;
    const ort = self.ort;
    ort.env.wasm.wasmPaths = runtimeUrl;
    // Single-thread WASM works on static hosts without cross-origin isolation.
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.proxy = false;
    const session = await ort.InferenceSession.create(runtimeUrl + "mnist-8.onnx", { executionProviders: ["wasm"] });
    return { cv, ort, session };
  })();
  return runtimePromise;
}
let queue = Promise.resolve();
self.onmessage = ({ data }) => {
  if (data.type !== "recognize") return;
  // Serialize inference, avoiding concurrent OpenCV/WASM work on repeated uploads.
  queue = queue.then(async () => {
    let bitmap;
    try {
      const { cv, ort, session } = await runtime();
      bitmap = await createImageBitmap(data.file);
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) throw new Error("This browser could not decode the image.");
      // Composite transparency onto white, as a normal screenshot background.
      context.fillStyle = "white";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(bitmap, 0, 0);
      const digits = self.OcrProcessing.extractDigits(cv, context.getImageData(0, 0, canvas.width, canvas.height));
      const cells = [];
      for (const digit of digits) {
        let prediction = { value: null, confidence: .96 };
        if (digit.image) {
          const sample = Float32Array.from(digit.image, value => value / 255);
          const output = await session.run({ [session.inputNames[0]]: new ort.Tensor("float32", sample, [1, 1, 28, 28]) });
          prediction = self.OcrProcessing.predictionFromScores(output[session.outputNames[0]].data, digit.hasLoop);
        }
        cells.push({ row: digit.row, col: digit.col, ...prediction });
      }
      self.postMessage({ id: data.id, cells });
    } catch (error) {
      self.postMessage({ id: data.id, error: error instanceof Error ? error.message : String(error) });
    } finally { bitmap?.close(); }
  });
};
