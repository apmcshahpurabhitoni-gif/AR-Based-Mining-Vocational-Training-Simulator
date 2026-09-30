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
 * Output: public/icons/*.png
 *
 * PNG is written by hand (IHDR/IDAT/IEND with zlib deflate) because pulling in
 * an image library to draw two rounded shapes would be a heavier dependency
 * than the encoder is code.
 */

import { deflateSync, crc32 } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";

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
function encodePng(size: number, rgba: Buffer): Buffer {
  // Raw scanlines, each prefixed with filter type 0.
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
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
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
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

for (const [path, size, padding] of jobs) {
  writeFileSync(path, encodePng(size, drawIcon(size, padding)));
  console.log(`wrote ${path} (${size}x${size})`);
}
