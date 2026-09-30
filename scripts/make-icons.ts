/**
 * Generate the PWA icons.
 *
 * docs/04 asset pipeline: "nothing downloaded, nothing scraped, nothing
 * licensed from a vendor." So the icons are drawn here, in code, from geometry
 * — no binary asset in the repo that nobody can regenerate, and no CDN.
 *
 * KAVACH means armour, so the mark is a shield with a tick in it: the product
 * is a certificate that says a person was assessed, not merely shown a video.
 *
 * Run:  bun run scripts/make-icons.ts
 * Output: public/icons/*.png, and the Android launcher icons and splash if the
 *         `android/` project is present (see docs/17). Skipped rather than
 *         failed when it is not, so the same command works before the wrapper
 *         has been added.
 *
 * PNG is written by hand (IHDR/IDAT/IEND with zlib deflate) because pulling in
 * an image library to draw two rounded shapes would be a heavier dependency
 * than the encoder is code.
 */

import { deflateSync, crc32 } from "node:zlib";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";

const INK: readonly [number, number, number] = [0x0b, 0x0f, 0x14]; // app background
const AMBER: readonly [number, number, number] = [0xfb, 0xbf, 0x24]; // brand accent
const GO: readonly [number, number, number] = [0x22, 0xc5, 0x5e]; // the tick

/** Shield half-width at normalised height `t` (0 = top, 1 = pointed base). */
function shieldHalfWidth(t: number): number {
  if (t < 0.62) return 1 - 0.06 * t;
  const u = (t - 0.62) / 0.38;
  return Math.max(0, 0.94 * Math.sqrt(Math.max(0, 1 - u * u)));
}

/** Distance from point p to segment ab. Used to stroke the tick. */
function distToSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

/**
 * Draw one icon.
 *
 * `padding` is the fraction of the canvas kept clear. Android's maskable icons
 * crop to a circle and only guarantee the central 80%, so the maskable variant
 * is drawn smaller rather than being the same file declared twice.
 */
function drawIcon(size: number, padding: number): Buffer {
  const px = Buffer.alloc(size * size * 4);
  const inset = size * padding;
  const box = size - inset * 2;

  // Shield geometry, centred in the padded box.
  const shieldTop = inset + box * 0.06;
  const shieldBottom = inset + box * 0.96;
  const shieldHalf = box * 0.34 * 1.12;

  // Tick, in the upper-middle of the shield.
  const tickY = shieldTop + box * 0.4;
  const t1 = { x: size / 2 - box * 0.13, y: tickY };
  const t2 = { x: size / 2 - box * 0.03, y: tickY + box * 0.11 };
  const t3 = { x: size / 2 + box * 0.15, y: tickY - box * 0.12 };
  const stroke = Math.max(2, box * 0.055);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      let r: number = INK[0];
      let g: number = INK[1];
      let b: number = INK[2];

      // Inside the shield?
      if (y >= shieldTop && y <= shieldBottom) {
        const t = (y - shieldTop) / (shieldBottom - shieldTop);
        const halfW = shieldHalf * shieldHalfWidth(t);
        const dx = Math.abs(x - size / 2);
        if (dx <= halfW) {
          // Amber border, ink fill — an outlined shield rather than a blob.
          const edge = halfW - dx;
          const onBorder = edge < stroke || t > 0.93;
          r = onBorder ? AMBER[0] : INK[0];
          g = onBorder ? AMBER[1] : INK[1];
          b = onBorder ? AMBER[2] : INK[2];

          // The tick, drawn over the fill.
          const d = Math.min(
            distToSegment(x, y, t1.x, t1.y, t2.x, t2.y),
            distToSegment(x, y, t2.x, t2.y, t3.x, t3.y),
          );
          if (d <= stroke) {
            r = GO[0];
            g = GO[1];
            b = GO[2];
          }
        }
      }

      px[i] = r;
      px[i + 1] = g;
      px[i + 2] = b;
      px[i + 3] = 255;
    }
  }
  return px;
}

/** Minimal PNG encoder: RGBA, 8-bit, no interlacing. */
function encodePng(width: number, height: number, rgba: Buffer): Buffer {
  // Raw scanlines, each prefixed with filter type 0. Width and height are
  // separate because the Android splash is not square, and a landscape tablet
  // splash drawn into a square buffer is the sort of thing that only shows up as
  // a stretched logo on a phone nobody in the room has.
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  const chunk = (type: string, data: Buffer): Buffer => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const typeBuf = Buffer.from(type, "ascii");
    const body = Buffer.concat([typeBuf, data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body) >>> 0, 0);
    return Buffer.concat([len, body, crc]);
  };

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // adaptive filtering
  ihdr[12] = 0; // no interlace

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

mkdirSync("public/icons", { recursive: true });

const jobs: Array<[string, number, number]> = [
  ["public/icons/icon-192.png", 192, 0.06],
  ["public/icons/icon-512.png", 512, 0.06],
  // Maskable: keep everything inside the guaranteed centre.
  ["public/icons/icon-maskable-512.png", 512, 0.18],
  // iOS ignores the manifest and wants its own touch icon.
  ["public/icons/apple-touch-icon.png", 180, 0.06],
];

/*
 * The same mark, for Android — `docs/17`.
 *
 * Without this the APK ships with Capacitor's default launcher icon, which is
 * the difference between an app a trainee was told to install and an app they
 * cannot tell from a browser's shortcut. Sizes are the platform's own: the
 * legacy square icon at 48dp-equivalent per density, and the adaptive-icon
 * foreground at 108dp per density, which the launcher masks to a circle and
 * then to whatever shape the phone's theme uses.
 *
 * The foreground is drawn with a much larger padding than the legacy icon,
 * because the adaptive mask keeps only the middle 72 of those 108 units. A
 * shield drawn to fill the canvas would be cropped to its own border.
 */
const ANDROID_DENSITIES: ReadonlyArray<readonly [string, number, number]> = [
  ["mdpi", 48, 108],
  ["hdpi", 72, 162],
  ["xhdpi", 96, 216],
  ["xxhdpi", 144, 324],
  ["xxxhdpi", 192, 432],
];

for (const [density, legacy, foreground] of ANDROID_DENSITIES) {
  const dir = `android/app/src/main/res/mipmap-${density}`;
  if (!existsSync(dir)) continue;
  const legacyIcon = encodePng(legacy, legacy, drawIcon(legacy, 0.08));
  writeFileSync(`${dir}/ic_launcher.png`, legacyIcon);
  writeFileSync(`${dir}/ic_launcher_round.png`, legacyIcon);
  writeFileSync(
    `${dir}/ic_launcher_foreground.png`,
    encodePng(foreground, foreground, drawIcon(foreground, 0.26)),
  );
  console.log(`wrote ${dir}/ic_launcher{,_round,_foreground}.png (${legacy} / ${foreground})`);
}

/*
 * The splash, which is the first thing anyone sees and the thing a screenshot
 * of a locked phone shows. Ink, with the mark centred, at each density's own
 * portrait and landscape size. Same rule as the icons: generated, committed, and
 * regenerable — no binary in the repo that nobody can reproduce.
 */
const SPLASH_SIZES: ReadonlyArray<readonly [string, number, number]> = [
  ["drawable-port-mdpi", 320, 480],
  ["drawable-port-hdpi", 480, 800],
  ["drawable-port-xhdpi", 720, 1280],
  ["drawable-port-xxhdpi", 960, 1600],
  ["drawable-port-xxxhdpi", 1280, 1920],
  ["drawable-land-mdpi", 480, 320],
  ["drawable-land-hdpi", 800, 480],
  ["drawable-land-xhdpi", 1280, 720],
  ["drawable-land-xxhdpi", 1600, 960],
  ["drawable-land-xxxhdpi", 1920, 1280],
];

/** Ink with the mark centred, at a size that is not square. */
function drawSplash(width: number, height: number): Buffer {
  const px = Buffer.alloc(width * height * 4);
  // The mark is sized off the short edge, so it is the same apparent size in
  // portrait and on a tablet.
  const mark = Math.round(Math.min(width, height) * 0.34);
  const markX = drawIcon(mark, 0.04);
  const ox = Math.round((width - mark) / 2);
  const oy = Math.round((height - mark) / 2);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const insideMark = x >= ox && x < ox + mark && y >= oy && y < oy + mark;
      if (insideMark) {
        const s = ((y - oy) * mark + (x - ox)) * 4;
        px[i] = markX[s] as number;
        px[i + 1] = markX[s + 1] as number;
        px[i + 2] = markX[s + 2] as number;
      } else {
        px[i] = INK[0];
        px[i + 1] = INK[1];
        px[i + 2] = INK[2];
      }
      px[i + 3] = 255;
    }
  }
  return px;
}

for (const [dir, width, height] of SPLASH_SIZES) {
  if (!existsSync(`android/app/src/main/res/${dir}`)) continue;
  writeFileSync(
    `android/app/src/main/res/${dir}/splash.png`,
    encodePng(width, height, drawSplash(width, height)),
  );
  console.log(`wrote android/app/src/main/res/${dir}/splash.png (${width}x${height})`);
}

for (const [path, size, padding] of jobs) {
  writeFileSync(path, encodePng(size, size, drawIcon(size, padding)));
  console.log(`wrote ${path} (${size}x${size})`);
}
