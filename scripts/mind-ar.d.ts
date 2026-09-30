/**
 * Type declarations for the untyped internals of `mind-ar` used by
 * `scripts/make-targets.ts`.
 *
 * mind-ar ships no types, and its deep module paths (`mind-ar/src/...`) are not
 * covered by `@types/mind-ar` either. These declarations are deliberately narrow
 * — they describe only the members this project calls, so they cannot quietly
 * claim more of the library than we actually depend on.
 */

declare module "mind-ar/src/image-target/compiler-base.js" {
  /** A greyscale target image, already reduced to one channel. */
  export interface TargetImage {
    data: Uint8Array;
    width: number;
    height: number;
  }

  export class CompilerBase {
    data: unknown[];
    compileImageTargets(
      images: Array<{ width: number; height: number }>,
      progressCallback: (percent: number) => void,
    ): Promise<unknown[]>;
    createProcessCanvas(img: { width: number; height: number }): unknown;
    compileTrack(args: {
      progressCallback: (percent: number) => void;
      targetImages: TargetImage[];
      basePercent: number;
    }): Promise<unknown[]>;
    exportData(): Uint8Array;
    importData(buffer: ArrayBuffer | Uint8Array): TargetImage[];
  }
}

declare module "mind-ar/src/image-target/image-list.js" {
  import type { TargetImage } from "mind-ar/src/image-target/compiler-base.js";
  export function buildImageList(image: TargetImage): TargetImage[];
  export function buildTrackingImageList(image: TargetImage): TargetImage[];
}

declare module "mind-ar/src/image-target/tracker/extract-utils.js" {
  import type { TargetImage } from "mind-ar/src/image-target/compiler-base.js";
  export function extractTrackingFeatures(
    imageList: TargetImage[],
    doneCallback: (index: number) => void,
  ): unknown;
}

declare module "mind-ar/src/image-target/detector/kernels/cpu/index.js";
