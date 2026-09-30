/**
 * Generate the MindAR image targets, and compile them into `public/targets.mind`.
 *
 * ---------------------------------------------------------------------------
 * What this produces, and why it exists
 * ---------------------------------------------------------------------------
 *
 * MindAR tracks *printed images*. It does not track image files at runtime: the
 * detector needs a precomputed feature set, which MindAR packs into a `.mind`
 * file. That file has to be built from target artwork, and docs/04 requires the
 * artwork be in-house ("nothing downloaded, nothing scraped, nothing licensed
 * from a vendor"). So both halves are generated here, from geometry.
 *
 * Two files come out of each run:
 *
 *   public/targets/<id>.png   the printable sheet you tape to the wall
 *   public/targets.mind       the compiled features `MindARThree` loads
 *
 * The order of the markers in `TARGET_ORDER` is load-bearing: MindAR addresses
 * targets by *index*, and `SceneAR` calls `addAnchor(i)` with that index. Adding
 * a marker in the middle renumbers everything after it, which is why the order
 * is a frozen constant and `targetIndexFor()` is the only way to read it.
 *
 * ---------------------------------------------------------------------------
 * Why not `bunx mind-ar-export`
 * ---------------------------------------------------------------------------
 *
 * mind-ar's own Node CLI is `offline-compiler.js`, which imports the native
 * `canvas` package. `canvas` builds with node-gyp, there is no C++ toolchain in
 * the hosting image, and `bun install` runs from clean on every deploy — so that
 * dependency is stubbed out in package.json (`scripts/canvas-stub`) and this
 * script drives MindAR's own `CompilerBase` with `@napi-rs/canvas` instead. Same
 * algorithm, same output format, no build toolchain.
 *
 * Run:  bun run make:targets
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import * as tf from "@tensorflow/tfjs";
import * as msgpack from "@msgpack/msgpack";
import { TRACKED_TARGETS, TARGET_LABELS } from "../src/lib/ar/targets";
import { CompilerBase, type TargetImage } from "mind-ar/src/image-target/compiler-base.js";
import { buildTrackingImageList } from "mind-ar/src/image-target/image-list.js";
import { extractTrackingFeatures } from "mind-ar/src/image-target/tracker/extract-utils.js";
// Registers MindAR's custom TFJS kernels. Without this the detector throws on
// the first frame with an unknown-op error rather than anything legible.
import "mind-ar/src/image-target/detector/kernels/cpu/index.js";

/**
 * Artwork resolution.
 *
 * 512 is a deliberate choice, not a shortcut. MindAR builds a pyramid of the
 * target and extracts features at several scales; starting at 1024 quadruples
 * the compile time for tracking quality that is already well past what a phone
 * camera at arm's length can resolve. Print size matters far more than pixel
 * count here — see the print note at the end of this script.
 */
const SIZE = 512;
const OUT_DIR = "public/targets";

/**
 * The marker set comes from `src/lib/ar/targets.ts`, which the runtime also
 * imports. MindAR addresses targets by index, so the two sides disagreeing about
 * order would bind an anchor to the wrong printed image — see that file.
 */
const TARGETS = TRACKED_TARGETS.map((id) => ({ id, label: TARGET_LABELS[id] }));

/** Deterministic value noise, so a rebuild produces byte-identical artwork. */
function noise(seed: number): number {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

/**
 * The distinctive glyph per marker.
 *
 * Drawn as flat high-contrast vector shapes. It has two jobs: it has to look
 * like the thing it stands for, so a trainee taping it up puts it in the right
 * place, and it has to be visually unlike the other three, so a phone pointed at
 * one cannot lock onto another.
 */
function drawGlyph(g: ReturnType<ReturnType<typeof createCanvas>["getContext"]>, id: string, cx: number, cy: number, s: number) {
  g.save();
  g.translate(cx, cy);
  g.fillStyle = "#000000";
  g.strokeStyle = "#000000";
  g.lineCap = "round";
  g.lineJoin = "round";

  if (id === "exit-sign") {
    // Running figure, plus an arrow — the ISO 7010 exit pictogram.
    g.beginPath();
    g.arc(-s * 0.05, -s * 0.42, s * 0.1, 0, Math.PI * 2);
    g.fill();
    g.lineWidth = s * 0.13;
    g.beginPath();
    g.moveTo(-s * 0.05, -s * 0.28);
    g.lineTo(-s * 0.22, s * 0.04);
    g.lineTo(-s * 0.34, s * 0.42);
    g.stroke();
    g.beginPath();
    g.moveTo(-s * 0.05, -s * 0.28);
    g.lineTo(s * 0.18, s * 0.0);
    g.lineTo(s * 0.3, s * 0.4);
    g.stroke();
    g.beginPath();
    g.moveTo(-s * 0.05, -s * 0.2);
    g.lineTo(-s * 0.36, -s * 0.16);
    g.stroke();
    g.beginPath();
    g.moveTo(-s * 0.05, -s * 0.2);
    g.lineTo(s * 0.3, -s * 0.3);
    g.stroke();
    // Doorway
    g.lineWidth = s * 0.09;
    g.strokeRect(s * 0.3, -s * 0.62, s * 0.42, s * 1.2);
  } else if (id === "fire-alarm") {
    // Bell on a mounting plate, with a manual call point square.
    g.beginPath();
    g.moveTo(-s * 0.4, s * 0.05);
    g.quadraticCurveTo(-s * 0.4, -s * 0.48, 0, -s * 0.48);
    g.quadraticCurveTo(s * 0.4, -s * 0.48, s * 0.4, s * 0.05);
    g.closePath();
    g.fill();
    g.beginPath();
    g.arc(0, s * 0.13, s * 0.13, 0, Math.PI * 2);
    g.fill();
    g.lineWidth = s * 0.1;
    g.beginPath();
    g.moveTo(-s * 0.5, s * 0.24);
    g.lineTo(s * 0.5, s * 0.24);
    g.stroke();
    g.fillRect(-s * 0.62, -s * 0.66, s * 0.24, s * 0.24);
  } else if (id === "gas-cylinder") {
    // A banded bottle with a valve wheel.
    g.beginPath();
    g.moveTo(-s * 0.26, -s * 0.46);
    g.lineTo(s * 0.26, -s * 0.46);
    g.lineTo(s * 0.26, s * 0.3);
    g.quadraticCurveTo(s * 0.26, s * 0.56, 0, s * 0.56);
    g.quadraticCurveTo(-s * 0.26, s * 0.56, -s * 0.26, s * 0.3);
    g.closePath();
    g.fill();
    // Bands, cut out in white so the silhouette is not one solid blob.
    g.globalCompositeOperation = "destination-out";
    g.fillRect(-s * 0.3, -s * 0.24, s * 0.6, s * 0.1);
    g.fillRect(-s * 0.3, s * 0.08, s * 0.6, s * 0.1);
    g.globalCompositeOperation = "source-over";
    g.lineWidth = s * 0.09;
    g.beginPath();
    g.arc(0, -s * 0.58, s * 0.15, 0, Math.PI * 2);
    g.stroke();
  } else {
    // Hazard barrier: diagonal stripes on a post.
    g.lineWidth = s * 0.12;
    g.strokeRect(-s * 0.5, -s * 0.34, s, s * 0.34);
    g.save();
    g.beginPath();
    g.rect(-s * 0.5, -s * 0.34, s, s * 0.34);
    g.clip();
    g.lineWidth = s * 0.14;
    for (let i = -3; i <= 8; i++) {
      g.beginPath();
      g.moveTo(-s * 0.5 + i * s * 0.16, -s * 0.34);
      g.lineTo(-s * 0.5 + i * s * 0.16 - s * 0.34, s * 0.0);
      g.stroke();
    }
    g.restore();
    g.fillRect(-s * 0.06, -s * 0.02, s * 0.12, s * 0.6);
    g.beginPath();
    g.moveTo(-s * 0.28, s * 0.58);
    g.lineTo(s * 0.28, s * 0.58);
    g.lineTo(s * 0.2, s * 0.44);
    g.lineTo(-s * 0.2, s * 0.44);
    g.closePath();
    g.fill();
  }

  g.restore();
}

/**
 * One printable marker.
 *
 * MindAR detects corner-like features, so a marker that is one flat shape
 * tracks badly however high its contrast. Three things here exist purely to
 * give the detector something to lock onto:
 *
 *   - a nested black/white/black frame, which yields long stable edges
 *   - a speckle field, which yields many small corners
 *   - a quiet white margin, which MindAR wants around the tracked area
 */
function drawMarker(index: number, id: string, label: string) {
  const canvas = createCanvas(SIZE, SIZE);
  const g = canvas.getContext("2d");

  g.fillStyle = "#ffffff";
  g.fillRect(0, 0, SIZE, SIZE);

  const M = SIZE * 0.08; // quiet margin
  const inner = SIZE - M * 2;

  // Speckle field — the corner supply the detector actually matches on.
  for (let i = 0; i < 1400; i++) {
    const x = M + noise(i * 1.7 + index * 91) * inner;
    const y = M + noise(i * 3.1 + index * 57 + 11) * inner;
    const w = 3 + noise(i * 7.3) * 13;
    const h = 3 + noise(i * 5.9 + 3) * 13;
    g.fillStyle = noise(i * 2.3) > 0.5 ? "#000000" : "#8f8f8f";
    g.fillRect(x, y, w, h);
  }

  // White card, so the glyph reads and the speckle does not fight it.
  const cardPad = inner * 0.2;
  g.fillStyle = "#ffffff";
  g.fillRect(M + cardPad, M + cardPad, inner - cardPad * 2, inner - cardPad * 2);
  g.strokeStyle = "#000000";
  g.lineWidth = SIZE * 0.014;
  g.strokeRect(M + cardPad, M + cardPad, inner - cardPad * 2, inner - cardPad * 2);

  const cx = SIZE / 2;
  const cy = SIZE / 2 - SIZE * 0.045;
  drawGlyph(g, id, cx, cy, inner * 0.34);

  // Nested frame: long, straight, high-contrast edges.
  g.strokeStyle = "#000000";
  g.lineWidth = SIZE * 0.03;
  g.strokeRect(M, M, inner, inner);
  g.lineWidth = SIZE * 0.012;
  g.strokeRect(M + SIZE * 0.045, M + SIZE * 0.045, inner - SIZE * 0.09, inner - SIZE * 0.09);

  // Corner registration blocks, unique to this marker's index.
  const blk = SIZE * 0.05;
  for (let c = 0; c < 4; c++) {
    const code = ((index + 1) * 5 + c * 3) % 7;
    for (let b = 0; b < code + 1; b++) {
      g.fillRect(
        M + b * (blk + 4) + 6,
        c < 2 ? M + 6 : SIZE - M - blk - 6,
        blk,
        blk,
      );
    }
  }

  // Human-readable label. Deliberately at the very bottom, outside the tracked
  // area, so it cannot be mistaken for a feature the detector should match.
  g.fillStyle = "#000000";
  g.font = `bold ${Math.round(SIZE * 0.036)}px sans-serif`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(label, cx, SIZE - M * 0.5);

  return canvas;
}

/**
 * Node-side compiler.
 *
 * MindAR ships this as `OfflineCompiler`, but that class imports native `canvas`
 * just to get `createCanvas`. Supplying the one method from `@napi-rs/canvas` is
 * the whole of the substitution.
 */
class NapiCompiler extends CompilerBase {
  override createProcessCanvas(img: { width: number; height: number }) {
    return createCanvas(img.width, img.height);
  }

  override compileTrack({
    progressCallback,
    targetImages,
    basePercent,
  }: {
    progressCallback: (percent: number) => void;
    targetImages: TargetImage[];
    basePercent: number;
  }): Promise<unknown[]> {
    return new Promise<unknown[]>((resolve) => {
      const percentPerImage = (100 - basePercent) / targetImages.length;
      let percent = 0;
      const list: unknown[] = [];
      for (let i = 0; i < targetImages.length; i++) {
        const imageList = buildTrackingImageList(targetImages[i]!);
        const percentPerAction = percentPerImage / imageList.length;
        const trackingData = extractTrackingFeatures(imageList, () => {
          percent += percentPerAction;
          progressCallback(basePercent + percent);
        });
        list.push(trackingData);
      }
      resolve(list);
    });
  }
}

// -- Run ---------------------------------------------------------------------
//
// Compiled one marker at a time, with a cache, rather than all four in a single
// pass.
//
// Feature extraction on the pure-JS TensorFlow backend costs roughly a minute
// per marker at this resolution, and there is no GPU or native tfjs backend in
// the build container. Four in one pass therefore runs for several minutes —
// long enough to be killed by a command timeout, which presents as an
// unexplained failure rather than a slow build. One marker per step, cached to
// disk, means the first run is four short jobs and every later run is instant,
// and it survives an interrupted run instead of starting over.

const CACHE = "node_modules/.cache/kavach-targets";

mkdirSync(OUT_DIR, { recursive: true });
mkdirSync(CACHE, { recursive: true });

console.log("drawing marker artwork");
const paths: string[] = [];
for (const [i, target] of TARGETS.entries()) {
  const canvas = drawMarker(i, target.id, target.label);
  const path = `${OUT_DIR}/${target.id}.png`;
  writeFileSync(path, canvas.toBuffer("image/png"));
  paths.push(path);
  console.log(`  ${path}  (${SIZE}x${SIZE})`);
}

// TFJS has no GPU in Node. Without this the first detector call either throws or
// silently falls back with a warning at an unhelpful moment.
await tf.setBackend("cpu");
await tf.ready();

/** One marker's compiled entry, from cache when the artwork has not changed. */
async function compiledEntry(index: number, path: string): Promise<unknown> {
  const png = readFileSync(path);
  // Cache key includes the artwork, so editing drawMarker invalidates it.
  const key = `${CACHE}/${TARGETS[index]!.id}-${png.length}-${SIZE}.bin`;

  if (existsSync(key)) {
    console.log(`  [${index}] ${TARGETS[index]!.id}: cached`);
    return msgpack.decode(new Uint8Array(readFileSync(key)));
  }

  // The `Image` object itself, not a copy of its fields.
  //
  // `{ ...img }` produces a plain object and `drawImage` rejects it with
  // "Value is not one of these types: CanvasElement, SVGCanvas, Image". Because
  // CompilerBase wraps that call in `new Promise(async (resolve, reject) => ...)`,
  // the rejection is swallowed by the async executor and the promise never
  // settles — so the symptom is an indefinite hang, not an error. Passing the
  // real object avoids it; @napi-rs/canvas images already carry width/height.
  const img = await loadImage(png);
  const compiler = new NapiCompiler();
  await compiler.compileImageTargets([img], () => {});
  const entry = compiler.data[0];

  // Mirrors CompilerBase.exportData(): the raw feature list is dropped because
  // it is large and rebuildable from targetImage.
  const e = entry as { targetImage: { width: number; height: number }; trackingData: unknown; matchingData: unknown };
  const packed = {
    targetImage: { width: e.targetImage.width, height: e.targetImage.height },
    trackingData: e.trackingData,
    matchingData: e.matchingData,
  };
  writeFileSync(key, Buffer.from(msgpack.encode(packed)));
  console.log(`  [${index}] ${TARGETS[index]!.id}: compiled`);
  return packed;
}

console.log("\ncompiling features");
const dataList: unknown[] = [];
for (const [i, p] of paths.entries()) {
  dataList.push(await compiledEntry(i, p));
}

// CURRENT_VERSION from MindAR's CompilerBase. A mismatch makes the runtime
// refuse the file with "might be outdated", so it is asserted here rather than
// discovered on a phone at the demo.
const MIND_FORMAT_VERSION = 2;
const out = "public/targets.mind";
writeFileSync(out, Buffer.from(msgpack.encode({ v: MIND_FORMAT_VERSION, dataList })));

console.log(`\nwrote ${out}`);
console.log("\nTargets, in .mind index order (SceneAR addresses these by index):");
TRACKED_TARGETS.forEach((id, i) => console.log(`  [${i}] ${id}`));
console.log("\nPrint public/targets/*.png at ~15 cm square and tape each beside the real object.");
