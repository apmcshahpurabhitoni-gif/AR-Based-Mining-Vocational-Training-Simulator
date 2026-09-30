/**
 * Local assessment report.
 *
 * The trainee's device is the system of record until there is a network
 * (docs/04-data-model.md §5), and until now that meant training and grading
 * happened offline and then *nothing was shown*. The result page said
 * "results are not available yet, reconnect if you trained offline" — which
 * is honest, and useless: a trainee who worked a whole shift underground had
 * no idea whether the shift went well or badly, and the only number anywhere
 * in the product was a session-history figure on the dashboard.
 *
 * This module builds that report. Three rules shape it:
 *
 *   1. It reuses `scoreModule` and nothing else. The number on the device and
 *      the number the server computes from the same events are the same
 *      number, because they come from the same function over the same rows.
 *      A local score that disagreed with the server's would be worse than no
 *      local score at all.
 *
 *   2. It NEVER evaluates the gate. docs/11 §2 forbids presentation reaching a
 *      safety decision, and a device that could say "you passed" is a device
 *      that can say it wrongly. The report exposes measurements and the module
 *      pass mark; it does not import `gate.ts`, and it has no function that
 *      returns a verdict. What it cannot see — the cold re-check, ordering
 *      across modules, the overall figures — is stated as absent rather than
 *      estimated.
 *
 *   3. A step the trainee never reached is incomplete, never passed. Inherited
 *      from the rubric rather than reimplemented, because that is the single
 *      most consequential rule in the whole product.
 */

import { expectedMsFor, maxHintsFor, scoreModule, weightFor } from "./scoring";
import type {
  AttemptEvent,
  Localised,
  ModuleManifest,
  StepAttemptRecord,
  StepKind,
} from "./types";

/** One step, as the trainee should read it. */
export interface LocalStepRow {
  stepId: string;
  kind: StepKind;
  critical: boolean;
  /** Attempts recorded. 0 means the trainee never got here. */
  attempts: number;
  everPassed: boolean;
  /** The only thing the hard-fail rule looks at. */
  firstTryPassed: boolean;
  /** Misconception behind the most frequent wrong answer, if any. */
  misconception?: string;
  /**
   * Content exists but has not been approved by the qualified reviewer. The
   * step is in the module because the specification requires it, and it can
   * never be answered, so the module can never be completed. Reported
   * explicitly, because a trainee who reads a score on this panel has no other
   * way of knowing that this is the reason the certificate is not coming.
   */
  pendingSafetyReview: boolean;
}

/** The trainee's own record of one module, computed on the device. */
export interface LocalModuleReport {
  moduleCode: string;
  title: Localised;
  /** 0..100 from the shared rubric. */
  score: number;
  /** G1's per-module threshold. Shown as a reference, not as a verdict. */
  passMark: number;
  /** First-attempt misses on critical steps. The hard-fail condition. */
  criticalMisses: number;
  /** Attempts that carried a certificate-blocking failure. */
  blockedFailures: number;
  stepsReached: number;
  stepsTotal: number;
  /** False while any step is unanswered, including a pending-review one. */
  complete: boolean;
  /** True when an unreviewed step makes completion impossible. */
  blockedByPendingReview: boolean;
  steps: LocalStepRow[];
  /** Critical steps missed first time, in module order. */
  missedCritical: LocalStepRow[];
  /** True when any attempt in this run was recorded with no network. */
  recordedOffline: boolean;
}

/** Everything one offline run produced. */
export interface LocalAssessment {
  modules: LocalModuleReport[];
  /** Modules that produced no local events at all. */
  empty: string[];
}

/**
 * Join raw events against the manifest.
 *
 * The extra fields the rubric needs are read from the step definition rather
 * than trusted from the event, exactly as `toStepRecords` does in the runner —
 * a version bump must not change how an already-recorded attempt is scored.
 */
function toRecords(manifest: ModuleManifest, events: AttemptEvent[]): StepAttemptRecord[] {
  return events.map((event) => {
    const step = manifest.steps.find((s) => s.id === event.stepId);
    return {
      ...event,
      maxHints: step ? maxHintsFor(step) : 1,
      expectedMs: step ? expectedMsFor(step) : 0,
      weight: step ? weightFor(step) : 1,
    };
  });
}

/** Score one module from its locally stored attempts. */
export function localModuleReport(
  manifest: ModuleManifest,
  events: AttemptEvent[],
): LocalModuleReport {
  const score = scoreModule(manifest, toRecords(manifest, events));

  const steps: LocalStepRow[] = manifest.steps.map((step) => {
    const metrics = score.steps.find((m) => m.stepId === step.id);
    const row: LocalStepRow = {
      stepId: step.id,
      kind: step.kind,
      critical: step.critical,
      attempts: metrics?.attemptCount ?? 0,
      everPassed: metrics?.everPassed ?? false,
      firstTryPassed: (metrics?.firstAttemptAccuracy ?? 0) === 1,
      pendingSafetyReview: step.pendingSafetyReview === true,
    };
    if (metrics?.topMisconception) row.misconception = metrics.topMisconception;
    return row;
  });

  const missedCritical = steps.filter((s) => s.critical && s.attempts > 0 && !s.firstTryPassed);
  const blockedByPendingReview = steps.some((s) => s.pendingSafetyReview);

  return {
    moduleCode: manifest.code,
    title: manifest.title,
    score: score.score,
    passMark: manifest.passScore,
    criticalMisses: score.criticalMisses,
    blockedFailures: score.blockedFailures,
    stepsReached: steps.filter((s) => s.everPassed).length,
    stepsTotal: steps.length,
    complete: steps.every((s) => s.everPassed),
    blockedByPendingReview,
    steps,
    missedCritical,
    recordedOffline: events.some((e) => e.offline),
  };
}

/**
 * Build the report for every module that has local events.
 *
 * `eventsByModule` comes from IndexedDB, so an unsynced run and a synced one
 * are indistinguishable here — deliberately. The panel cannot claim a run has
 * been accepted, because on this device there is no way to know.
 */
export function localAssessment(
  manifests: ModuleManifest[],
  eventsByModule: Map<string, AttemptEvent[]>,
): LocalAssessment {
  const modules: LocalModuleReport[] = [];
  const empty: string[] = [];

  for (const manifest of manifests) {
    const events = eventsByModule.get(manifest.code) ?? [];
    if (events.length === 0) {
      empty.push(manifest.code);
      continue;
    }
    modules.push(localModuleReport(manifest, events));
  }

  return { modules, empty };
}

/**
 * What the local report deliberately does not decide.
 *
 * Rendered next to the numbers so the absence is visible. Each item is a gate
 * criterion this device has no data for — the cold re-check is server-scheduled
 * against a delay, and the cross-module figures need every module's events to
 * have arrived. Listing them is the difference between "your score is 84" and
 * "your score is 84, and this is not a certificate".
 */
export const LOCAL_NOT_A_VERDICT: Localised = {
  en: "Not a certificate decision",
  hi: "प्रमाणपत्र का निर्णय नहीं",
};

/** A score as the server holds it. */
export interface ServerScore {
  moduleCode: string;
  score: number;
}

/**
 * Modules whose local run the server has not reflected yet.
 *
 * Detected by comparing figures rather than by trusting a "synced" flag,
 * because the comparison is the thing that matters to a trainee: if the
 * number on the server differs from the number on the device, the device's
 * run has not been counted yet, and hiding the local copy until they match
 * would leave a score visibly changing for no stated reason.
 *
 * A module the server has never scored at all counts as awaiting — which is
 * the ordinary case for a first offline run, and the one the panel exists for.
 */
export function modulesAwaitingServer(
  report: LocalAssessment,
  serverScores: ServerScore[],
): string[] {
  const server = new Map(serverScores.map((s) => [s.moduleCode, s.score]));
  return report.modules
    .filter((m) => server.get(m.moduleCode) !== m.score)
    .map((m) => m.moduleCode);
}

export const LOCAL_UNKNOWN_REASONS: Localised[] = [
  {
    en: "The cold re-check is scheduled by the server and happens later, without hints.",
    hi: "शीत पुनःपरीक्षण सर्वर द्वारा निर्धारित होता है और बाद में, बिना संकेत के होता है।",
  },
  {
    en: "Your other modules and your ordering across the whole programme are not counted here.",
    hi: "आपके अन्य मॉड्यूल और पूरे कार्यक्रम में क्रम यहाँ नहीं गिना जाता।",
  },
  {
    en: "The server decides from your recorded attempts once they arrive, and it is the only thing that decides.",
    hi: "सर्वर आपके दर्ज किए गए प्रयासों के आने पर निर्णय लेता है, और निर्णय केवल वही लेता है।",
  },
];
