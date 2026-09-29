/**
 * Module registry (C3: content as data).
 *
 * The two manifests in `src/modules/*.json` are the single source of truth for
 * training content. They are imported here, typed once, and handed to every
 * consumer: the client runner, the content validator, the test suite, and the
 * seeding action that publishes them to Convex.
 *
 * Nothing in this file may import from React, Convex or the DOM — it is loaded
 * by `bun test`, by the CLI validator, and by the browser.
 */

import type { ModuleManifest, Step } from "./types";
import { SHIPPED_LOCALES } from "./types";

import fireJson from "../modules/FIRE.json";
import gasJson from "../modules/GAS.json";

/**
 * Approved critical steps (C4). A first-attempt miss on any of these is a hard
 * fail that blocks certification regardless of overall score. The list lives
 * here rather than only in the JSON so the validator can prove the content
 * still matches what the spec approved — see docs/06-content-spec.md §4.
 */
export const APPROVED_CRITICAL_STEPS = ["A-03", "A-05", "B-02", "B-03", "B-05"] as const;
export type ApprovedCriticalStep = (typeof APPROVED_CRITICAL_STEPS)[number];

/** A JSON import is structurally `any`; assert the shape once, here. */
function asManifest(raw: unknown, sourceFile: string): ModuleManifest {
  if (raw === null || typeof raw !== "object") {
    throw new Error(`${sourceFile}: manifest is not an object`);
  }
  return raw as ModuleManifest;
}

export const MODULES: Record<string, ModuleManifest> = Object.freeze({
  FIRE: asManifest(fireJson, "src/modules/FIRE.json"),
  GAS: asManifest(gasJson, "src/modules/GAS.json"),
});

export const MODULE_CODES = Object.keys(MODULES) as (keyof typeof MODULES)[];

export function getModule(code: string): ModuleManifest | undefined {
  return MODULES[code];
}

/** Throwing accessor for call sites where absence is a programming error. */
export function requireModule(code: string): ModuleManifest {
  const m = MODULES[code];
  if (!m) {
    throw new Error(`Unknown module: ${code}`);
  }
  return m;
}

export function getStep(moduleCode: string, stepId: string): Step | undefined {
  return MODULES[moduleCode]?.steps.find((s) => s.id === stepId);
}

export function isApprovedCritical(stepId: string): boolean {
  return (APPROVED_CRITICAL_STEPS as readonly string[]).includes(stepId);
}

export { SHIPPED_LOCALES };
