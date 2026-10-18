import { copyFile, mkdir, readFile, readdir, writeFile, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { build } from "esbuild";

const frontend = fileURLToPath(new URL("../", import.meta.url));
const root = path.resolve(frontend, "..");
const runtime = path.join(frontend, "public/ocr/runtime");
await mkdir(runtime, { recursive: true });
for (const [source, destination] of [
  ["node_modules/@techstark/opencv-js/dist/opencv.js", "opencv.js"],
  ["node_modules/onnxruntime-web/dist/ort.wasm.min.js", "ort.wasm.min.js"],
  ["node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.mjs", "ort-wasm-simd-threaded.mjs"],
  ["node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm", "ort-wasm-simd-threaded.wasm"],
  ["assets/mnist-8.onnx", "mnist-8.onnx"],
  ["assets/mnist-8.LICENSE.txt", "mnist-8.LICENSE.txt"],
  ["node_modules/@techstark/opencv-js/LICENSE", "opencv.LICENSE"],
  ["assets/onnxruntime.LICENSE", "onnxruntime.LICENSE"],
  ["assets/onnxruntime.ThirdPartyNotices.txt", "onnxruntime.ThirdPartyNotices.txt"],
]) await copyFile(path.join(frontend, source), path.join(runtime, destination));
await build({ entryPoints: [path.join(frontend, "src/lib/ocr-processing.ts")], outfile: path.join(runtime, "processing.js"),
  bundle: true, format: "iife", globalName: "OcrProcessing", platform: "browser", target: "es2022", minify: true });
await build({ entryPoints: [path.join(frontend, "src/lib/advanced-hints.ts")], outfile: path.join(frontend, "public/wasm/advanced-hints.js"),
  bundle: true, format: "iife", globalName: "AdvancedHints", platform: "browser", target: "es2022", minify: true });

const corpus = path.join(root, "data/puzzles/serate-buckets");
const sourceManifest = JSON.parse(await readFile(path.join(corpus, "manifest.json"), "utf8"));
const output = path.join(frontend, "public/puzzles");
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
const manifest = { levels: {} };
let total = 0;
for (const bucket of sourceManifest.buckets) {
  const folder = path.join(corpus, bucket.id);
  const records = [];
  for (const file of (await readdir(folder)).filter(file => file.endsWith(".ndjson.gz")).sort()) {
    const content = gunzipSync(await readFile(path.join(folder, file))).toString("utf8");
    for (const line of content.split("\n").filter(line => line.trim())) {
      const record = JSON.parse(line);
      if (!/^[0-9.]{81}$/.test(record.puzzle) || !/^[1-9]{81}$/.test(record.solution)) throw new Error(`Invalid puzzle in ${file}`);
      records.push([record.puzzle.replaceAll(".", "0"), record.solution, record.se_rating, record.highest_technique || ""]);
    }
  }
  if (!records.length) throw new Error(`Missing puzzles for ${bucket.id}`);
  const chunkSize = 256;
  await mkdir(path.join(output, bucket.id), { recursive: true });
  for (let start = 0; start < records.length; start += chunkSize) {
    await writeFile(path.join(output, bucket.id, `${start / chunkSize}.json`), JSON.stringify(records.slice(start, start + chunkSize)));
  }
  manifest.levels[bucket.id] = { name: bucket.label, count: records.length, chunkSize };
  total += records.length;
}
await writeFile(path.join(output, "manifest.json"), JSON.stringify(manifest));
console.log(`Prepared browser OCR assets and ${total} rated puzzles across ${Object.keys(manifest.levels).length} levels.`);
