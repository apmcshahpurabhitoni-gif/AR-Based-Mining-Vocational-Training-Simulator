/**
 * Types for the vendored `mindar-three.js`.
 *
 * tsconfig has no `allowJs`, so the implementation is not typechecked. This
 * declaration is the contract the app codes against, and it deliberately covers
 * only what this project actually uses — a hand-written declaration that tries
 * to mirror the whole class would drift from the implementation silently.
 *
 * `stop()` is the one exception: it is part of the teardown contract even though
 * its internals reach through the controller, and getting teardown wrong is how
 * a camera light stays on after the trainee leaves the step.
 */

import type { Group, PerspectiveCamera, Scene, WebGLRenderer } from "three";

export interface MindARAnchor {
  group: Group;
  targetIndex: number;
  /** True once the marker has been located at least once and not lost. */
  visible: boolean;
  onTargetFound: (() => void) | null;
  onTargetLost: (() => void) | null;
  onTargetUpdate: (() => void) | null;
}

export interface MindARThreeOptions {
  container: HTMLElement;
  /** URL of the compiled `.mind` target file. */
  imageTargetSrc: string;
  /** How many markers may be tracked at once. 1 is enough and cheapest. */
  maxTrack?: number;
  uiLoading?: "yes" | "no";
  uiScanning?: "yes" | "no";
  uiError?: "yes" | "no";
  filterMinCF?: number | null;
  filterBeta?: number | null;
  warmupTolerance?: number | null;
  missTolerance?: number | null;
}

export declare class MindARThree {
  constructor(options: MindARThreeOptions);

  readonly renderer: WebGLRenderer;
  readonly scene: Scene;
  readonly camera: PerspectiveCamera;
  readonly container: HTMLElement;
  readonly anchors: MindARAnchor[];
  /** Present only after `start()` has resolved. */
  video?: HTMLVideoElement;

  /** Requests the camera, loads the targets and begins tracking. */
  start(): Promise<void>;
  /** Stops tracking and releases the camera track. Safe to call twice. */
  stop(): void;
  addAnchor(targetIndex: number): MindARAnchor;
  resize(): void;
}
