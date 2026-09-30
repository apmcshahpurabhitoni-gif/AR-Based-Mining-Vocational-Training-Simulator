/**
 * Write the safety review packet to `docs/`.
 *
 * The packet itself is rendered by `scripts/review-packet.ts`, which is pure —
 * no clock, no filesystem — so `src/lib/review-packet.test.ts` can render it and
 * compare against the committed file without writing anything. That test is the
 * reason this file is three lines: a packet that was accurate when written and is
 * not now is worse than no packet, because a reviewer trusts it.
 *
 * Run:    bun run scripts/make-review-packet.ts
 *         bun run make:packet
 * Output: docs/R9-SAFETY-REVIEW-PACKET.md
 */

import { writeFileSync } from "node:fs";
import { MODULES, MODULE_CODES } from "../src/lib/modules";
import { renderReviewPacket } from "./review-packet";

const OUT = "docs/R9-SAFETY-REVIEW-PACKET.md";

const text = renderReviewPacket();
writeFileSync(OUT, text, "utf8");

const steps = MODULE_CODES.reduce((n, code) => n + MODULES[code]!.steps.length, 0);
const questions = (text.match(/^### Q\d+ /gm) ?? []).length;

console.log(
  `KAVACH safety review packet — ${OUT}\n` +
    `  ${MODULE_CODES.length} modules · ${steps} steps · ${questions} questions for the reviewer\n` +
    `  ${text.split("\n").length} lines. Pass it to the safety reviewer named in docs/12 and docs/13.`,
);
