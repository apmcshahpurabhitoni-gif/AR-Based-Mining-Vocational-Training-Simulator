/**
 * The review packet must match the manifests it claims to describe.
 *
 * A safety packet is the one document in this repository that somebody outside
 * the project will read and trust. That is exactly what makes staleness dangerous
 * rather than merely untidy: a packet that was accurate when written and is not
 * now is not a packet that gets ignored, it is a packet that gets relied on. The
 * reviewer signs off what is in the file, not what is in the manifest.
 *
 * So the file in `docs/` is generated and this compares it to a fresh render.
 * Editing a manifest without regenerating fails the build. Editing the generated
 * file by hand fails the build, which is the same thing from the other side.
 *
 * The renderer is pure — no clock, no filesystem — so this writes nothing. That
 * matters: a test that regenerated the file in place would make a failing run
 * repair itself and prove nothing.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { renderReviewPacket } from "../../scripts/review-packet";
import { MODULES, MODULE_CODES } from "./modules";

const PACKET = "docs/R9-SAFETY-REVIEW-PACKET.md";

describe("the safety review packet", () => {
  test("is committed and matches the manifests it describes", () => {
    const committed = readFileSync(PACKET, "utf8");
    const fresh = renderReviewPacket();
    if (committed !== fresh) {
      // Point at the first divergence, because "these 900 lines differ" is not
      // an actionable failure message.
      const a = committed.split("\n");
      const b = fresh.split("\n");
      const at = a.findIndex((line, i) => line !== b[i]);
      throw new Error(
        `${PACKET} is out of date with the manifests.\n` +
          `  first difference at line ${at + 1}:\n` +
          `    committed: ${JSON.stringify(a[at])}\n` +
          `    rendered:  ${JSON.stringify(b[at])}\n` +
          `  run: bun run make:packet`,
      );
    }
    expect(committed).toBe(fresh);
  });

  test("covers every step of every module", () => {
    const packet = renderReviewPacket();
    for (const code of MODULE_CODES) {
      for (const step of MODULES[code]!.steps) {
        // As a heading, so it is a section rather than a passing mention: the
        // reviewer works through the document, they do not grep it.
        expect(packet).toContain(`### \`${step.id}\` — `);
      }
    }
  });

  test("carries the spec's own review-gate wording, not a paraphrase", () => {
    // The packet's authority comes from quoting the specification. A paraphrase
    // is a summary the reviewer cannot check against the document they were
    // asked to approve, and a summary is where a safety scope quietly narrows.
    const packet = renderReviewPacket();
    expect(packet).toContain("Qualified mining safety review of extinguisher mapping");
    expect(packet).toContain("Qualified mining safety review of all procedures and language");
    expect(packet).toContain("release blocker");
  });

  test("asks a question for every blocked step, and names it as blocked", () => {
    const packet = renderReviewPacket();
    for (const code of MODULE_CODES) {
      for (const step of MODULES[code]!.steps) {
        if (!step.pendingSafetyReview) continue;
        expect(packet).toContain(`\`${code}/${step.id}\``);
        expect(packet).toContain("awaiting qualified safety review");
        // And the module it belongs to must be marked unreviewable, not quietly
        // presented as a module a reviewer can sign off today.
        expect(packet).toContain("no — see below");
      }
    }
  });

  test("prints every wrong answer with the misconception it represents", () => {
    // docs/06 C8. If a wrong answer reaches the packet without its
    // misconception, the reviewer cannot tell whether the mapping is right, and
    // the heatmap stays decorative.
    const packet = renderReviewPacket();
    let wrong = 0;
    for (const code of MODULE_CODES) {
      for (const step of MODULES[code]!.steps) {
        for (const choice of step.choices ?? []) {
          if (choice.correct) continue;
          wrong += 1;
          if (!choice.misconception) continue;
          expect(packet).toContain(`\`${choice.id}\``);
        }
      }
    }
    expect(wrong).toBeGreaterThan(0);
  });

  test("carries no date, so regenerating unchanged content is byte-identical", () => {
    // The fingerprint is a hash of the manifest content. A timestamp would make
    // every run differ, and a freshness test that fails every day is a freshness
    // test people learn to ignore.
    const packet = renderReviewPacket();
    expect(packet).toMatch(/\*\*Generated from:\*\*.*fingerprint `[0-9a-f]{12}`/);
    expect(packet).not.toMatch(/\b20\d\d-\d\d-\d\d\b/);
  });
});
