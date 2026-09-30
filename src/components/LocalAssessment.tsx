/**
 * Local assessment panel.
 *
 * Shown when the product has the trainee's attempts but not the server's
 * verdict — which is every offline run, and every run whose events have not
 * arrived yet. Before this existed the result page said "results are not
 * available yet, reconnect if you trained offline", which is honest and
 * useless: someone who worked a shift underground could not find out whether
 * the shift went well.
 *
 * This component is strictly presentational. It imports NO scoring and NO gate
 * code — docs/11 §2 puts the safety decision on the other side of the runner,
 * and a device that can say "you passed" is a device that can say it wrongly.
 * Everything here is a measurement passed in, or a statement that a thing is
 * unknown.
 *
 * The visual rule that matters: nothing in this panel is green. Green means
 * "the gate says yes" everywhere else in KAVACH, and a green 84 here would
 * teach a trainee to read a number as a verdict — the exact confusion the
 * eight-criterion gate exists to prevent. A score above the pass mark is
 * still shown in plain text, because hiding it would be its own kind of lie.
 */

import { clsx } from "clsx";
import { CircleSlash, Info, TriangleAlert } from "lucide-react";
import { Chip, Meter, Panel } from "./ui";
import {
  LOCAL_NOT_A_VERDICT,
  LOCAL_UNKNOWN_REASONS,
  type LocalAssessment as Report,
  type LocalModuleReport,
} from "../lib/local-assessment";
import { localise } from "../lib/i18n";
import type { Locale } from "../lib/types";

export function LocalAssessmentPanel({
  report,
  locale,
  awaitingServer,
  className,
}: {
  report: Report;
  locale: Locale;
  /**
   * Modules whose local run the server has not counted yet.
   *
   * Omitted when the server is simply unreachable, which is a different
   * statement: the panel then has nothing to reconcile against and says so
   * once, in the header, rather than marking every card.
   */
  awaitingServer?: string[];
  className?: string;
}) {
  if (report.modules.length === 0) return null;
  const awaiting = new Set(awaitingServer ?? []);

  return (
    <section className={clsx("space-y-4", className)}>
      <Panel className="border-ink-600">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold tracking-tight text-fog-50">
            {localise(LOCAL_NOT_A_VERDICT, locale)}
          </h2>
          <Chip tone="neutral">{localise({ en: "computed on device", hi: "डिवाइस पर गणना" }, locale)}</Chip>
        </div>
        {awaiting.size > 0 && (
          <p className="mt-3 text-sm leading-relaxed text-fog-400">
            {localise(
              {
                en: "Your latest run has not reached the server yet. These figures come from the same rubric over the same attempt records, so the server will compute the same numbers when they arrive.",
                hi: "आपका नवीनतम प्रयास अभी सर्वर तक नहीं पहुँचा है। ये आंकड़े उसी रूब्रिक से उन्हीं प्रयास रिकॉर्डों पर निकाले गए हैं, इसलिए पहुँचने पर सर्वर यही संख्याएँ निकालेगा।",
              },
              locale,
            )}
          </p>
        )}
      </Panel>

      {report.modules.map((module) => (
        <ModuleCard
          key={module.moduleCode}
          module={module}
          locale={locale}
          notYetCounted={awaiting.has(module.moduleCode)}
        />
      ))}

      {/* -- What it cannot know ------------------------------------------ */}
      {/*
       * The absence is stated rather than left implied. A trainee who sees
       * "84" and no mention of the re-check will read it as "84 means I am
       * nearly certified", and the re-check is the criterion the whole
       * product is built around.
       */}
      <Panel className="border-ink-600">
        <h3 className="flex items-center gap-2 font-mono text-[11px] font-semibold uppercase tracking-[0.18em] text-fog-600">
          <Info className="h-3.5 w-3.5" />
          {localise({ en: "what this cannot tell you", hi: "यह आपको क्या नहीं बता सकता" }, locale)}
        </h3>
        <ul className="mt-3 space-y-2">
          {LOCAL_UNKNOWN_REASONS.map((reason) => (
            <li key={reason.en} className="flex gap-2.5 text-sm leading-relaxed text-fog-400">
              <CircleSlash className="mt-0.5 h-4 w-4 shrink-0 text-fog-700" />
              {localise(reason, locale)}
            </li>
          ))}
        </ul>
      </Panel>
    </section>
  );
}

function ModuleCard({
  module,
  locale,
  notYetCounted,
}: {
  module: LocalModuleReport;
  locale: Locale;
  notYetCounted: boolean;
}) {
  const anyCriticalMiss = module.criticalMisses > 0;
  const anyBlocked = module.blockedFailures > 0;
  // The number itself is neutral on purpose — see the file header. Only a
  // missed critical step earns a warning colour, because that is the one
  // thing on this screen that is unambiguously bad news.
  const tone = anyCriticalMiss || anyBlocked ? "halt" : "amber";

  return (
    <Panel className={clsx("border-ink-600", anyCriticalMiss && "border-halt-400/40")}>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h3 className="font-mono text-xs uppercase tracking-wider text-fog-400">
          {module.moduleCode} · {localise(module.title, locale)}
        </h3>
        {notYetCounted && (
          <span className="font-mono text-[10px] uppercase tracking-wider text-fog-700">
            {localise({ en: "not yet counted by the server", hi: "सर्वर द्वारा अभी गिना नहीं गया" }, locale)}
          </span>
        )}
        <div className="flex items-baseline gap-2">
          <span className="tnum font-mono text-4xl font-semibold tracking-tight text-fog-50">
            {module.score}
          </span>
          <span className="font-mono text-xs text-fog-700">
            {localise({ en: "of 100", hi: "100 में से" }, locale)} ·{" "}
            {localise({ en: "pass mark", hi: "उत्तीर्ण अंक" }, locale)} {module.passMark}
          </span>
        </div>
      </div>

      <Meter value={module.score} max={100} tone={tone} className="mt-4" />

      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
        <Figure
          value={module.criticalMisses}
          label={localise({ en: "critical first-try misses", hi: "गंभीर पहली-बार गलतियाँ" }, locale)}
          bad={anyCriticalMiss}
        />
        <Figure
          value={module.blockedFailures}
          label={localise({ en: "blocking failures", hi: "रोकने वाली विफलताएँ" }, locale)}
          bad={anyBlocked}
        />
        <Figure
          value={`${module.stepsReached}/${module.stepsTotal}`}
          label={localise({ en: "steps completed", hi: "पूरे चरण" }, locale)}
          bad={false}
        />
        <Figure
          value={module.recordedOffline
            ? localise({ en: "offline", hi: "ऑफ़लाइन" }, locale)
            : localise({ en: "online", hi: "ऑनलाइन" }, locale)}
          label={localise({ en: "recorded", hi: "दर्ज" }, locale)}
          bad={false}
        />
      </dl>

      {/* -- The hard-fail condition, named -------------------------------- */}
      {anyCriticalMiss && (
        <div className="mt-5 rounded-lg border border-halt-400/30 bg-halt-400/5 p-4">
          <p className="flex items-center gap-2 font-mono text-[11px] font-semibold uppercase tracking-wider text-halt-300">
            <TriangleAlert className="h-4 w-4" />
            {localise({ en: "missed on the first try", hi: "पहली बार में गलत" }, locale)}
          </p>
          <ul className="mt-2 space-y-1">
            {module.missedCritical.map((step) => (
              <li key={step.stepId} className="font-mono text-sm text-fog-100">
                {step.stepId}
                {step.misconception ? (
                  <span className="ml-2 font-sans text-fog-400">{step.misconception}</span>
                ) : null}
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs leading-relaxed text-fog-500">
            {localise(
              {
                en: "A first-try miss on a critical step is recorded permanently. Retaking the module does not clear it.",
                hi: "किसी गंभीर चरण पर पहली बार की गलती स्थायी रूप से दर्ज होती है। मॉड्यूल दोबारा करने से यह मिट नहीं जाती।",
              },
              locale,
            )}
          </p>
        </div>
      )}

      {/* -- The unreviewed step, before anything that could read as good --- */}
      {module.blockedByPendingReview && (
        <div className="mt-5 rounded-lg border border-warn-400/40 bg-warn-400/5 p-4">
          <p className="flex items-center gap-2 font-mono text-[11px] font-semibold uppercase tracking-wider text-warn-400">
            <TriangleAlert className="h-4 w-4" />
            {localise({ en: "cannot be certified", hi: "प्रमाणित नहीं हो सकता" }, locale)}
          </p>
          <p className="mt-2 text-sm leading-relaxed text-fog-300">
            {localise(
              {
                en: "This module has a step still with the qualified safety reviewer, so it cannot be completed — and a module that cannot be completed cannot be certified. The score above is your work, not a qualification.",
                hi: "इस मॉड्यूल का एक चरण अभी योग्य सुरक्षा समीक्षक के पास है, इसलिए यह पूरा नहीं हो सकता — और जो मॉड्यूल पूरा नहीं हो सकता, वह प्रमाणित नहीं हो सकता। ऊपर का स्कोर आपका काम है, योग्यता नहीं।",
              },
              locale,
            )}
          </p>
        </div>
      )}

      {!module.complete && !module.blockedByPendingReview && (
        <p className="mt-4 text-sm leading-relaxed text-fog-500">
          {localise(
            {
              en: "Not finished. A step you never reached counts as not done, never as passed.",
              hi: "अधूरा। जिस चरण पर आप नहीं पहुँचे वह पूरा नहीं माना जाता, कभी सही नहीं माना जाता।",
            },
            locale,
          )}
        </p>
      )}
    </Panel>
  );
}

/** A labelled figure. Tabular so a row of them does not jitter. */
function Figure({
  value,
  label,
  bad,
}: {
  value: string | number;
  label: string;
  bad: boolean;
}) {
  return (
    // `dt` before `dd`: a `div` inside `dl` must hold terms before
    // definitions, and a screen reader announces them in source order.
    <div>
      <dt className="text-[11px] leading-snug text-fog-600">{label}</dt>
      <dd
        className={clsx(
          "tnum mt-0.5 font-mono text-2xl font-semibold",
          bad ? "text-halt-300" : "text-fog-100",
        )}
      >
        {value}
      </dd>
    </div>
  );
}
