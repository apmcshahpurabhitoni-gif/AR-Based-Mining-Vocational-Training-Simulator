import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { MODULES } from "./modules";
import { scoreModule } from "./scoring";
import {
  LOCAL_UNKNOWN_REASONS,
  localAssessment,
  localModuleReport,
  modulesAwaitingServer,
  type LocalAssessment,
} from "./local-assessment";
import type { AttemptEvent, ModuleManifest, Step } from "./types";

const FIRE = MODULES.FIRE!;

/** One passing attempt on a step. */
function pass(step: Step, index = 0): AttemptEvent {
  return {
    eventId: `e-${step.id}-${index}`,
    sessionId: "s1",
    moduleCode: step.moduleCode,
    moduleVersion: FIRE.version,
    stepId: step.id,
    stepSeq: step.seq,
    critical: step.critical,
    outcome: "pass",
    attemptIndex: index,
    elapsedMs: 1000,
    hintUsed: 0,
    selfRecovered: index > 0,
    prompted: false,
    orderViolation: false,
    offline: true,
    clientTs: 1_000 + index,
    locale: "en",
  };
}

/** One failing attempt on a step, optionally as a critical/blocking failure. */
function fail(
  step: Step,
  opts: { index?: number; blocking?: boolean; misconception?: string } = {},
): AttemptEvent {
  return {
    eventId: `e-${step.id}-${opts.index ?? 0}`,
    sessionId: "s1",
    moduleCode: step.moduleCode,
    moduleVersion: FIRE.version,
    stepId: step.id,
    stepSeq: step.seq,
    critical: step.critical,
    outcome: "fail",
    attemptIndex: opts.index ?? 0,
    elapsedMs: 2000,
    hintUsed: 0,
    selfRecovered: false,
    prompted: false,
    orderViolation: false,
    failureKind: opts.blocking ? "critical" : "penalty",
    ...(opts.misconception ? { misconception: opts.misconception } : {}),
    offline: true,
    clientTs: 1_000 + (opts.index ?? 0),
    locale: "en",
  };
}

function cleanRun(): AttemptEvent[] {
  return FIRE.steps.map((step) => pass(step));
}

describe("local assessment — the device's own record", () => {
  test("reports the same score the server will compute from the same events", () => {
    // The whole reason this is safe to show is that there is one rubric. If
    // this ever fails, the device is displaying a number that disagrees with
    // the official one, which is worse than showing nothing.
    const events = FIRE.steps.map((step) =>
      step.critical && step.id === FIRE.steps[1]!.id ? [fail(step), pass(step, 1)] : [pass(step)],
    );
    const flat = events.flat();

    const report = localModuleReport(FIRE, flat);
    const server = scoreModule(FIRE, records(FIRE, flat));

    expect(report.score).toBe(server.score);
    expect(report.criticalMisses).toBe(server.criticalMisses);
    expect(report.blockedFailures).toBe(server.blockedFailures);
  });

  test("a clean run is complete, with no critical misses", () => {
    const report = localModuleReport(FIRE, cleanRun());
    expect(report.score).toBe(100);
    expect(report.complete).toBe(true);
    expect(report.criticalMisses).toBe(0);
    expect(report.missedCritical).toEqual([]);
    expect(report.stepsReached).toBe(FIRE.steps.length);
  });

  test("a first-try miss on a critical step is counted, named, and permanent", () => {
    const critical = FIRE.steps.find((s) => s.critical)!;
    const events = FIRE.steps.flatMap((step) =>
      step.id === critical.id ? [fail(step, { misconception: "no-alarm" }), pass(step, 1)] : [pass(step)],
    );

    const report = localModuleReport(FIRE, events);

    expect(report.criticalMisses).toBe(1);
    // Named explicitly, because "you missed one" and "you missed THIS one" are
    // different messages and only the second one is actionable.
    expect(report.missedCritical.map((s) => s.stepId)).toEqual([critical.id]);
    expect(report.missedCritical[0]!.misconception).toBe("no-alarm");
    // Passing it on the second attempt does not undo the first-try miss.
    expect(report.missedCritical[0]!.everPassed).toBe(true);
    expect(report.missedCritical[0]!.firstTryPassed).toBe(false);
  });

  test("a first-try miss on a NON-critical step is not a critical miss", () => {
    const nonCritical = FIRE.steps.find((s) => !s.critical)!;
    const events = FIRE.steps.flatMap((step) =>
      step.id === nonCritical.id ? [fail(step), pass(step, 1)] : [pass(step)],
    );

    const report = localModuleReport(FIRE, events);
    expect(report.criticalMisses).toBe(0);
    expect(report.missedCritical).toEqual([]);
  });

  test("a step never reached is incomplete, never passed", () => {
    // The single most consequential rule in the product. Inherited from the
    // rubric rather than reimplemented, and asserted here so a future change
    // to the report cannot quietly start crediting untouched steps.
    const partial = FIRE.steps.slice(0, 2).map((step) => pass(step));
    const report = localModuleReport(FIRE, partial);

    expect(report.complete).toBe(false);
    expect(report.stepsReached).toBe(2);
    const untouched = report.steps.filter((s) => s.attempts === 0);
    expect(untouched.length).toBe(FIRE.steps.length - 2);
    expect(untouched.every((s) => !s.everPassed)).toBe(true);
    // Partial work cannot reach a full mark.
    expect(report.score).toBeLessThan(100);
  });

  test("an empty event list is a report, not a crash", () => {
    const report = localModuleReport(FIRE, []);
    expect(report.score).toBe(0);
    expect(report.complete).toBe(false);
    expect(report.stepsReached).toBe(0);
    expect(report.missedCritical).toEqual([]);
  });

  test("events for unknown step ids are ignored, not scored", () => {
    // A manifest version bump must not corrupt a live session's local report.
    const stray: AttemptEvent = { ...pass(FIRE.steps[0]!), stepId: "ZZ-99" };
    const report = localModuleReport(FIRE, [...cleanRun(), stray]);
    expect(report.steps.some((s) => s.stepId === "ZZ-99")).toBe(false);
    expect(report.score).toBe(100);
  });

  test("records whether the run happened with the network off", () => {
    const offline = localModuleReport(FIRE, cleanRun());
    expect(offline.recordedOffline).toBe(true);

    const online = localModuleReport(
      FIRE,
      cleanRun().map((e) => ({ ...e, offline: false })),
    );
    expect(online.recordedOffline).toBe(false);
  });
});

describe("local assessment — modules", () => {
  test("a module with no local events is listed as empty, not scored as zero", () => {
    // Zero would read as "you scored nothing", which is a different and false
    // claim about someone who has not trained.
    const report = localAssessment([FIRE], new Map());
    expect(report.modules).toEqual([]);
    expect(report.empty).toEqual([FIRE.code]);
  });

  test("each module is scored from its own events", () => {
    const gas = MODULES.GAS!;
    const map = new Map<string, AttemptEvent[]>([[FIRE.code, cleanRun()]]);
    const report = localAssessment([FIRE, gas], map);

    expect(report.modules.map((m) => m.moduleCode)).toEqual([FIRE.code]);
    expect(report.empty).toEqual([gas.code]);
  });
});

describe("local assessment — a module that cannot be certified", () => {
  test("the pending-review module is flagged, and never reported complete", () => {
    // GAS step 4 has no approved procedure. A trainee who answers everything
    // else must be told why the score does not lead anywhere, in the panel
    // itself — there is nowhere else they would find out.
    const gas = MODULES.GAS!;
    const answerable = gas.steps.filter((s) => !s.pendingSafetyReview);
    const events = answerable.map((step) => pass(step));

    const report = localModuleReport(gas, events);

    expect(report.blockedByPendingReview).toBe(true);
    expect(report.complete).toBe(false);
    const pending = report.steps.find((s) => s.pendingSafetyReview)!;
    expect(pending.stepId).toBe("B-04");
    expect(pending.everPassed).toBe(false);
  });

  test("even a perfect score on the answerable steps is still not complete", () => {
    const gas = MODULES.GAS!;
    const answerable = gas.steps.filter((s) => !s.pendingSafetyReview);
    const report = localModuleReport(gas, answerable.map((step) => pass(step)));

    // The score is high because the rubric scores what was done. The report
    // must not let that read as success, which is why `complete` and
    // `blockedByPendingReview` are separate fields the panel has to show.
    expect(report.score).toBeGreaterThan(0);
    expect(report.complete).toBe(false);
    expect(report.blockedByPendingReview).toBe(true);
  });
});

describe("local assessment — reconciling with the server", () => {
  const report: LocalAssessment = localAssessment(
    [FIRE],
    new Map([[FIRE.code, cleanRun()]]),
  );

  test("a run the server already agrees with is not flagged", () => {
    expect(modulesAwaitingServer(report, [{ moduleCode: "FIRE", score: 100 }])).toEqual([]);
  });

  test("a run the server has not counted is flagged", () => {
    expect(modulesAwaitingServer(report, [{ moduleCode: "FIRE", score: 72 }])).toEqual(["FIRE"]);
  });

  test("a module the server has never scored is flagged", () => {
    expect(modulesAwaitingServer(report, [])).toEqual(["FIRE"]);
  });

  test("an unrelated module's score does not mark this one as awaiting", () => {
    expect(
      modulesAwaitingServer(report, [
        { moduleCode: "GAS", score: 10 },
        { moduleCode: "FIRE", score: 100 },
      ]),
    ).toEqual([]);
  });
});

describe("local assessment — what it says it cannot do", () => {
  test("every stated unknown is bilingual", () => {
    // A disclosure in a language the trainee cannot read is not a disclosure.
    for (const reason of LOCAL_UNKNOWN_REASONS) {
      expect(reason.en.length).toBeGreaterThan(20);
      expect(reason.hi.length).toBeGreaterThan(10);
      // Must not be a copy of the English left in place by mistake.
      expect(reason.hi).not.toBe(reason.en);
    }
  });

  test("the re-check is named, because it is the criterion the product is about", () => {
    expect(LOCAL_UNKNOWN_REASONS.some((r) => r.en.includes("re-check"))).toBe(true);
  });
});

describe("local assessment — it cannot reach a safety decision", () => {
  /**
   * docs/11 §2: presentation must never reach scoring, a certificate, or a
   * safety decision. A device that can say "you passed" is a device that can
   * say it wrongly, and this panel is the one place in KAVACH that shows a
   * number with no gate behind it.
   *
   * Read from the source rather than asserted in prose, because the thing
   * being prevented is someone later adding one import.
   */
  const REPORT = readFileSync("src/lib/local-assessment.ts", "utf8");
  const PANEL = readFileSync("src/components/LocalAssessment.tsx", "utf8");

  test("the report never imports the gate", () => {
    expect(REPORT).not.toMatch(/from\s+"\.\/gate"/);
    expect(REPORT).not.toMatch(/evaluateGate/);
  });

  test("the panel imports neither scoring nor gate", () => {
    expect(PANEL).not.toMatch(/from\s+"\.\.\/lib\/(scoring|gate)"/);
  });

  test("nothing in the report or the panel claims a verdict", () => {
    for (const source of [REPORT, PANEL]) {
      // Comments are stripped first. This file's own header explains that the
      // device must never be able to say "you passed", so a grep that ran over
      // prose would match the warning about the thing it is warning about.
      const code = stripComments(source);
      expect(code).not.toMatch(/certificat\w*\s+(?:granted|issued|approved|awarded)/i);
      expect(code).not.toMatch(/you\s+(?:passed|qualified|certified)/i);
    }
  });

  test("the report exposes no field that reads as a certificate decision", () => {
    // An exact allowlist, not a pattern. A regex reading `/pass/` would flag
    // `passMark`, which is the module's own threshold and is deliberately
    // shown as a number. The allowlist is also the stronger test: a future
    // `gatePassed: boolean` cannot be added without appearing in this list, so
    // adding one is a deliberate act rather than a slip.
    const report = localModuleReport(FIRE, cleanRun());
    expect(Object.keys(report).sort()).toEqual([
      "blockedByPendingReview",
      "blockedFailures",
      "complete",
      "criticalMisses",
      "missedCritical",
      "moduleCode",
      "passMark",
      "recordedOffline",
      "score",
      "steps",
      "stepsReached",
      "stepsTotal",
      "title",
    ]);
    // And the one field whose name could be misread: it is the threshold, not
    // a comparison against it.
    expect(report.passMark).toBe(FIRE.passScore);
  });

  test("the pass mark is shown as a number, never as a comparison", () => {
    // The panel is allowed to print `manifest.passScore`. It is not allowed to
    // compare against it and render a pass, because on this device there is
    // no gate to have passed.
    expect(PANEL).toContain("module.passMark");
    expect(PANEL).not.toMatch(/passMark\s*(?:>=|>|===|==)\s*module\.score/);
  });
});

/**
 * Remove comments so a source guard reads code and copy, not prose.
 *
 * Deliberately not a full parser — a regex that removes `/* … *\/` and `// …`
 * can be fooled by those sequences inside a string literal, which is fine here
 * because a false negative in a guard is a test failure, never a pass.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
}

/** Mirror of the join the report does internally, for the parity assertion. */
function records(manifest: ModuleManifest, events: AttemptEvent[]) {  return events.map((event) => {
    const step = manifest.steps.find((s) => s.id === event.stepId);
    return {
      ...event,
      maxHints: step ? Math.max(1, step.maxHints ?? step.hints.length) : 1,
      expectedMs: step ? (step.expectedMs ?? step.action?.expectedMs ?? 0) : 0,
      weight: step && typeof step.weight === "number" && step.weight > 0 ? step.weight : 1,
    };
  });
}
