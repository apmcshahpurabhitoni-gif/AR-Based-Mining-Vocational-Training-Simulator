/**
 * Stub for the `canvas` package.
 *
 * ---------------------------------------------------------------------------
 * Why this exists
 * ---------------------------------------------------------------------------
 *
 * `mind-ar` lists `canvas` as a hard dependency. `canvas` is a native module
 * that builds with node-gyp, and the build fails in a plain Node container with
 * no C++ toolchain — which is exactly what the production hosting image is.
 * Because `bun install` runs from clean on every deploy, a failing postinstall
 * there does not degrade the build, it *breaks* it. So mind-ar cannot be
 * installed as-is.
 *
 * The irony is that `canvas` is never needed at runtime. The only importer is
 * `mind-ar/src/image-target/offline-compiler.js` — the Node-side `.mind`
 * compiler. The browser runtime (MindARThree, the detector, the tracker) touches
 * canvas only through the DOM. This project compiles its targets with
 * `scripts/make-targets.ts`, which supplies its own canvas via `@napi-rs/canvas`
 * (a prebuilt binary with no build step) and never imports offline-compiler.js.
 *
 * So the dependency is satisfied by this stub, wired in through `overrides` in
 * package.json. It is deliberately *loud* rather than inert: if someone later
 * imports the offline compiler for real, they get a clear instruction instead of
 * a confusing `undefined is not a function` three calls deep.
 */

function unavailable(name) {
  return () => {
    throw new Error(
      `The \`canvas\` package is stubbed in this project (scripts/canvas-stub). ` +
        `Something imported mind-ar's Node offline compiler, which uses ${name}. ` +
        `Compile image targets with \`bun run scripts/make-targets.ts\` instead, ` +
        `which uses @napi-rs/canvas and needs no build toolchain.`,
    );
  };
}

export const createCanvas = unavailable("createCanvas");
export const loadImage = unavailable("loadImage");
export const Image = unavailable("Image");
export const ImageData = unavailable("ImageData");

export default { createCanvas, loadImage, Image, ImageData };
