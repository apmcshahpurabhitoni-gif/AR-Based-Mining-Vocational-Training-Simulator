/**
 * Frame statistics.
 *
 * The numbers behind the on-screen readout in `Scene3D`. Pure and separate so
 * they can be tested: a frame counter that only ever exists inside a
 * `requestAnimationFrame` callback is a frame counter nobody can check, and
 * the whole point of Phase 0 is that these numbers are believed.
 *
 * What it reports, and why each one is here:
 *
 *   fps       — the obvious one. Averages over a window so it settles.
 *   frameMs   — the long frame, not the average. A room that runs at 30 fps
 *               with the occasional 200 ms stall is not a 30 fps room; the
 *               worst frame is what a trainee feels as a stutter, and it is
 *               the one that does not show up in a mean.
 *   calls     — draw calls. The number that decides whether adding the ducting
 *               in Phase 2 is affordable on the target handset.
 *   tris      — triangles, for the same reason.
 *   aimed     — the id under the crosshair. A reviewer who says "the hose reel
 *               looks wrong" and a reviewer who can point at the id are having
 *               different conversations, and only one of them is fixable.
 *
 * Averages are windowed rather than cumulative: a cumulative FPS since page load
 * is a number that stops meaning anything the moment the scene changes, which
 * is exactly when somebody is looking at it.
 */

export interface FrameSample {
  /** Frame duration in milliseconds. */
  ms: number;
}

export interface FrameStats {
  fps: number;
  /** Longest frame inside the window. */
  worstMs: number;
  /** Mean frame time inside the window. */
  meanMs: number;
  frames: number;
}

const WINDOW = 45;

/** ~1 s of frames at 45 fps, so the readout settles within about a second. */
export class FrameMeter {
  private samples: number[] = [];

  /** Record one frame. Returns the windowed summary. */
  push(ms: number): FrameStats {
    // Guard the input. `performance.now()` going backwards, or a NaN from a
    // coalesced event, would poison the mean for the rest of the window.
    this.samples.push(Number.isFinite(ms) && ms > 0 ? ms : 0);
    if (this.samples.length > WINDOW) this.samples.shift();
    return this.read();
  }

  read(): FrameStats {
    const n = this.samples.length;
    if (n === 0) return { fps: 0, worstMs: 0, meanMs: 0, frames: 0 };
    let sum = 0;
    let worst = 0;
    for (const ms of this.samples) {
      sum += ms;
      if (ms > worst) worst = ms;
    }
    const mean = sum / n;
    return {
      // A mean frame time of 0 would mean an infinite frame rate, which is not
      // a thing and would print "Infinity fps".
      fps: mean > 0 ? Math.min(999, Math.round(1000 / mean)) : 0,
      worstMs: Math.round(worst),
      meanMs: Math.round(mean * 10) / 10,
      frames: n,
    };
  }

  reset(): void {
    this.samples.length = 0;
  }
}

/** What the readout prints. Assembled here so the strings exist in one place. */
export interface Readout {
  fps: number;
  /** Pre-formatted, because the caller has a readout panel and not a table. */
  frameMs: string;
  worstMs: string;
  calls: number;
  tris: number;
  aimed: string;
}

/**
 * The readout, formatted for a corner of a screen.
 *
 * `worst` is flagged past a third of a second, because that is where a stall
 * stops being a dropped frame and becomes something a trainee would describe
 * as "it froze". A plain number in a list gets read as one more number.
 *
 * Returns lines rather than a record of fields: the caller concatenates them
 * into one text node, and a `<pre>` is the only way to get a multi-line
 * monospace block out of a single DOM write.
 */
export function readoutLines(
  stats: FrameStats,
  calls: number,
  tris: number,
  aimed: string,
  settings?: string,
): string {
  return [
    settings,
    `${stats.fps} fps`,
    `frame ${stats.meanMs.toFixed(1)} ms`,
    `worst ${stats.worstMs} ms${stats.worstMs > 300 ? "  <- stall" : ""}`,
    `${calls} calls`,
    `${tris > 9999 ? `${Math.round(tris / 1000)}k` : tris} tris`,
    `aimed ${aimed || "-"}`,
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");
}
