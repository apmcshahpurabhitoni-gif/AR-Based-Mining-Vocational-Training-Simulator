/**
 * Content validation (C3, C5, C8).
 *
 * Training content is the one artefact in KAVACH that can be wrong in a way
 * that typechecking cannot catch. A missing Hindi string ships a Hindi trainee
 * an English screen; a `decide` step with two correct answers teaches the wrong
 * thing; a critical step that is not on the approved list silently weakens the
 * hard-fail gate.
 *
 * This module is pure so it can run in three places: `bun test`, the CLI
 * (`scripts/validate-content.ts`), and CI.
 */

import type { Localised, ModuleManifest, Step } from "./types";
import { SHIPPED_LOCALES } from "./types";
import { APPROVED_CRITICAL_STEPS, MODULES, MODULE_CODES } from "./modules";
import { MARKERS, INTERACTABLES } from "./markers";

export interface ContentIssue {
  /** `FIRE` or `FIRE/A-03` — precise enough to jump straight to the fix. */
  where: string;
  message: string;
}

/**
 * Steps that are allowed to exist with no approved answer yet.
 *
 * A step here is present, correctly shaped, correctly critical, and
 * deliberately unwinnable. The flag is a safety valve, not a convenience: it
 * says "the qualified reviewer has not supplied this yet", and the whole
 * system treats that as a hard stop. So the list is an allowlist of exactly the
 * gaps we know about, each with the reason it exists — adding a *new* pending
 * step fails this check, which means a placeholder can never be slipped in
 * quietly. Closing an entry is a one-line deletion once the content lands.
 */
const PENDING_SAFETY_REVIEW: Readonly<Record<string, string>> = {
  "GAS/B-04":
    "docs/13 makes GAS step 4 (withdraw or remain outside the hazardous area) critical, and requires " +
    "this step to capture the misconception of entering a suspected hazardous atmosphere. The approved " +
    "procedure, the scenario that decides between withdrawing and remaining, and the answer key are all " +
    "the safety reviewer's to supply. Until they are, the step must be visible and blocking rather than " +
    "silently absent — before this, KAVACH had no withdrawal step at all and a trainee who never learned " +
    "to withdraw could still be issued a GAS certificate.",
};

/**
 * The word a placeholder must carry in its instruction, per shipped locale.
 *
 * Per locale rather than one English string, because "unreviewed" has to be
 * declared in the language the trainee is actually reading. Checking for the
 * English word in a Hindi string would let a Hindi trainee meet an unreviewed
 * step that never said so.
 */
const PENDING_MARKERS: Readonly<Record<string, string>> = {
  en: "PENDING",
  hi: "लंबित",
};

function checkLocalised(
  where: string,
  field: string,
  value: Localised | undefined,
  issues: ContentIssue[],
): void {
  if (!value || typeof value !== "object") {
    issues.push({ where, message: `${field} is missing` });
    return;
  }
  for (const locale of SHIPPED_LOCALES) {
    const text = value[locale];
    if (typeof text !== "string" || text.trim() === "") {
      issues.push({ where, message: `${field} has no "${locale}" string` });
    }
  }
  // `sat` is a reserved slot: absent is correct, present-but-blank is not.
  if (value.sat !== undefined && value.sat.trim() === "") {
    issues.push({ where, message: `${field} has an empty "sat" string (omit it instead)` });
  }
}

function checkSemver(where: string, field: string, value: string, issues: ContentIssue[]): void {
  if (!/^\d+\.\d+\.\d+$/.test(value)) {
    issues.push({ where, message: `${field} "${value}" is not MAJOR.MINOR.PATCH` });
  }
}

export function validateManifest(manifest: ModuleManifest): ContentIssue[] {
  const issues: ContentIssue[] = [];
  const at = `module ${manifest.code}`;

  if (!/^[A-Z]{2,8}$/.test(manifest.code)) {
    issues.push({ where: at, message: `code "${manifest.code}" must be 2-8 uppercase letters` });
  }
  checkLocalised(at, "title", manifest.title, issues);
  checkSemver(at, "version", manifest.version, issues);

  if (!Number.isFinite(manifest.estimatedMinutes) || manifest.estimatedMinutes <= 0) {
    issues.push({ where: at, message: "estimatedMinutes must be a positive number" });
  }
  if (manifest.passScore < 0 || manifest.passScore > 100) {
    issues.push({ where: at, message: `passScore ${manifest.passScore} is outside 0..100` });
  }
  if (manifest.steps.length === 0) {
    issues.push({ where: at, message: "has no steps" });
    return issues;
  }

  const seenIds = new Set<string>();
  let prevSeq = -1;

  for (const step of manifest.steps) {
    const where = `${manifest.code}/${step.id}`;

    // -- identity -----------------------------------------------------------
    if (seenIds.has(step.id)) {
      issues.push({ where, message: "duplicate step id in manifest" });
    }
    seenIds.add(step.id);

    if (step.moduleCode !== manifest.code) {
      issues.push({
        where,
        message: `moduleCode "${step.moduleCode}" does not match manifest "${manifest.code}"`,
      });
    }
    if (step.seq !== prevSeq + 1) {
      issues.push({
        where,
        message: `seq ${step.seq} is not the previous seq + 1 (expected ${prevSeq + 1})`,
      });
    }
    prevSeq = step.seq;

    checkLocalised(where, "instruction", step.instruction, issues);
    if (!step.narrationKey || step.narrationKey.trim() === "") {
      issues.push({ where, message: "narrationKey is empty" });
    }

    // -- pending safety review ---------------------------------------------
    // A step awaiting the qualified reviewer is checked differently, and the
    // difference is deliberate. Everything that can be known without the
    // reviewer — ids, vocabulary, localisation, shape — is enforced exactly as
    // for any other step. What cannot be known is which answer is right, so
    // the two rules that need an answer key are not applied to it: "exactly one
    // correct choice" and "every wrong choice carries a misconception". Asserting
    // them would mean inventing a safety answer, which is the one thing this
    // project must not do.
    const pending = step.pendingSafetyReview === true;
    if (pending) {
      if (!PENDING_SAFETY_REVIEW[where]) {
        issues.push({
          where,
          message:
            "is flagged pendingSafetyReview but is not on the PENDING_SAFETY_REVIEW allowlist in " +
            "src/lib/validate-content.ts — either the review has landed and the flag should be removed, " +
            "or the new gap needs to be declared here with its reason",
        });
      }
      for (const locale of SHIPPED_LOCALES) {
        const text = step.instruction[locale] ?? "";
        if (!text.includes(PENDING_MARKERS[locale] ?? PENDING_MARKERS.en!)) {
          issues.push({
            where,
            message: `instruction.${locale} does not declare the step as pending review — an unreviewed step must label itself, in every shipped locale`,
          });
        }
      }
      // A step that cannot be answered must not be one you can sail past.
      if (!step.failure.blocksCertificate) {
        issues.push({
          where,
          message: "is pending safety review but its failure does not block the certificate",
        });
      }
    }

    // -- shape matches kind -------------------------------------------------
    // Everything this step can be answered with must be drawable in the 3D
    // training environment. docs/12 and docs/13 both require all six steps of a
    // module to be representable there, so an option outside the vocabulary is
    // a step the renderer cannot show.
    const knownActions = new Set(INTERACTABLES[manifest.code] ?? []);

    if (step.kind === "decide") {
      const choices = step.choices ?? [];
      if (choices.length < 2) {
        issues.push({ where, message: "decide step needs at least 2 choices" });
      }
      const correct = choices.filter((c) => c.correct);
      if (!pending && correct.length !== 1) {
        issues.push({
          where,
          message: `decide step must have exactly one correct choice (found ${correct.length})`,
        });
      }
      for (const choice of choices) {
        // A choice becomes a selectable object in the training space, so it
        // must be one this project has actually defined. Same reasoning as the
        // observe-target rule: an id nobody specified cannot be drawn, and a
        // manifest that reaches past the vocabulary is how invented objects
        // reach a trainee.
        if (knownActions.size > 0 && !knownActions.has(choice.id)) {
          issues.push({
            where,
            message: `choice "${choice.id}" is not in the ${manifest.code} interactable vocabulary (src/lib/markers.ts)`,
          });
        }
        checkLocalised(where, `choice "${choice.id}".label`, choice.label, issues);
        checkLocalised(where, `choice "${choice.id}".consequence`, choice.consequence, issues);
        // C8: a wrong answer with no misconception tag is a dead heatmap cell.
        // A pending step has no wrong answers yet — it has candidates, and the
        // reviewer decides which are which.
        if (!choice.correct && !choice.misconception && !pending) {
          issues.push({
            where,
            message: `wrong choice "${choice.id}" has no misconception tag (C8)`,
          });
        }
      }
      if (step.targets && step.targets.length > 0) {
        issues.push({ where, message: "decide step should not define targets" });
      }
    }

    if (step.kind === "observe") {
      const targets = step.targets ?? [];
      if (targets.length === 0) {
        issues.push({ where, message: "observe step needs at least one target" });
      }
      const targetIds = new Set(targets.map((t) => t.id));
      // An observe target becomes a physical object in the training space, so
      // it has to be an object this project has actually defined. This is the
      // rule that keeps a module's room made of its own equipment.
      const known = new Set(MARKERS[manifest.code] ?? []);
      for (const target of targets) {
        if (known.size > 0 && !known.has(target.id)) {
          issues.push({
            where,
            message: `target "${target.id}" is not in the ${manifest.code} marker vocabulary (docs/05 §3)`,
          });
        }
      }
      for (const target of targets) {
        checkLocalised(where, `target "${target.id}".label`, target.label, issues);
        if (target.position.x < 0 || target.position.x > 1 || target.position.y < 0 || target.position.y > 1) {
          issues.push({
            where,
            message: `target "${target.id}".position must be normalised to 0..1`,
          });
        }
      }
      for (const required of step.success.requiredTargets ?? []) {
        if (!targetIds.has(required)) {
          issues.push({
            where,
            message: `success.requiredTargets references unknown target "${required}"`,
          });
        }
      }
      if (step.success.type === "identify" && (step.success.requiredTargets ?? []).length === 0) {
        issues.push({ where, message: 'observe step must use success.type "identify"' });
      }
    }

    if (step.kind === "act") {
      if (!step.action) {
        issues.push({ where, message: "act step needs an action spec" });
      } else if (step.action.elements.length === 0) {
        issues.push({ where, message: "act step has an empty action sequence" });
      } else if (step.action.type === "sequence") {
        for (const element of step.action.elements) {
          if (knownActions.size > 0 && !knownActions.has(element)) {
            issues.push({
              where,
              message: `action element "${element}" is not in the ${manifest.code} interactable vocabulary (src/lib/markers.ts)`,
            });
          }
        }
        const duplicates = step.action.elements.filter(
          (el, i) => step.action && step.action.elements.indexOf(el) !== i,
        );
        if (duplicates.length > 0) {
          issues.push({
            where,
            message: `action sequence repeats an element: ${[...new Set(duplicates)].join(", ")}`,
          });
        }
      }
    }

    // -- failure semantics (C4) --------------------------------------------
    checkLocalised(where, "failure.consequence", step.failure.consequence, issues);
    if (step.failure.kind === "critical" && !step.failure.blocksCertificate) {
      issues.push({
        where,
        message: "failure.kind is critical but blocksCertificate is false",
      });
    }
    if (step.critical && step.failure.kind !== "critical") {
      issues.push({
        where,
        message: "step is flagged critical but its failure.kind is not \"critical\"",
      });
    }

    // -- hints --------------------------------------------------------------
    if (step.maxHints !== undefined && step.maxHints !== step.hints.length) {
      issues.push({
        where,
        message: `maxHints ${step.maxHints} does not match hints.length ${step.hints.length}`,
      });
    }
    step.hints.forEach((hint, i) => checkLocalised(where, `hints[${i}]`, hint, issues));

    // -- scoring inputs -----------------------------------------------------
    if (step.weight !== undefined && (!Number.isFinite(step.weight) || step.weight <= 0)) {
      issues.push({ where, message: `weight ${step.weight} must be a positive number` });
    }
    if (step.critical && step.weight !== 3) {
      issues.push({ where, message: `critical step must carry weight 3 (has ${step.weight})` });
    }
    const expected = step.expectedMs ?? step.action?.expectedMs;
    if (expected === undefined || expected <= 0) {
      issues.push({ where, message: "step has no positive expectedMs for the hesitation metric" });
    }
  }

  // -- module-level critical roster (C4) ------------------------------------
  // Step ids are globally unique and carry a domain prefix (A- for FIRE,
  // B- for GAS) that does not have to match the module code, so ownership is
  // resolved through the manifest's own step list rather than by prefix.
  const stepIds = new Set(manifest.steps.map((s: Step) => s.id));
  const actualCritical = manifest.steps
    .filter((s: Step) => s.critical)
    .map((s: Step) => s.id)
    .sort();
  const expectedCritical = APPROVED_CRITICAL_STEPS.filter((id) => stepIds.has(id))
    .map((id) => id as string)
    .sort();

  for (const missing of expectedCritical.filter((id) => !actualCritical.includes(id))) {
    issues.push({ where: at, message: `approved critical step ${missing} is not flagged critical` });
  }
  for (const extra of actualCritical.filter((id) => !expectedCritical.includes(id))) {
    issues.push({ where: at, message: `step ${extra} is critical but is not on the approved list` });
  }

  return issues;
}

/** Validates every registered manifest plus cross-module rules. */
export function validateAllModules(): ContentIssue[] {
  const issues: ContentIssue[] = [];

  for (const code of MODULE_CODES) {
    issues.push(...validateManifest(MODULES[code]!));
  }

  // Every registered module needs a marker vocabulary, and no marker may
  // belong to two of them. A shared marker would let a distractor cross a
  // module boundary, which is how a gas room ends up offering a fire hose.
  const markerOwner = new Map<string, string>();
  for (const code of MODULE_CODES) {
    const pool = MARKERS[code];
    if (!pool || pool.length === 0) {
      issues.push({ where: `module ${code}`, message: "has no marker vocabulary in src/lib/markers.ts" });
      continue;
    }
    for (const marker of pool) {
      const previous = markerOwner.get(marker);
      if (previous) {
        issues.push({
          where: `module ${code}`,
          message: `marker "${marker}" is also claimed by module ${previous}`,
        });
      }
      markerOwner.set(marker, code);
    }
  }

  // The same rule for the second vocabulary. Every module needs an
  // interactable list, and no interactable may belong to two modules — the
  // options on a decide step are the answer surface, so one leaking across a
  // module boundary would offer a trainee a choice from a module they are not
  // being assessed in.
  const interactableOwner = new Map<string, string>();
  for (const code of MODULE_CODES) {
    const pool = INTERACTABLES[code];
    if (!pool || pool.length === 0) {
      issues.push({
        where: `module ${code}`,
        message: "has no interactable vocabulary in src/lib/markers.ts",
      });
      continue;
    }
    for (const id of pool) {
      const previous = interactableOwner.get(id);
      if (previous) {
        issues.push({
          where: `module ${code}`,
          message: `interactable "${id}" is also claimed by module ${previous}`,
        });
      }
      interactableOwner.set(id, code);
    }
  }

  // Step ids must be globally unique: attempts are keyed by stepId, and the
  // re-check sampler mixes modules.
  const owner = new Map<string, string>();
  for (const code of MODULE_CODES) {
    for (const step of MODULES[code]!.steps) {
      const previous = owner.get(step.id);
      if (previous) {
        issues.push({
          where: `${code}/${step.id}`,
          message: `step id already used by module ${previous}`,
        });
      }
      owner.set(step.id, code);
    }
  }

  // Content must actually be able to clear the gate. G1 needs every module
  // score >= 80, and a clean run must reach 100 — if it cannot, the demo and
  // the certification promise are both broken.
  for (const code of MODULE_CODES) {
    const manifest = MODULES[code]!;
    if (manifest.passScore !== 80) {
      issues.push({
        where: `module ${code}`,
        message: `passScore ${manifest.passScore} must match GATE_THRESHOLDS.minModuleScore (80)`,
      });
    }
  }

  return issues;
}

export function formatIssues(issues: ContentIssue[]): string {
  return issues.map((i) => `  ${i.where}: ${i.message}`).join("\n");
}
