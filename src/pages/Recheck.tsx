/**
 * Cold retention re-check (G7).
 *
 * This is the screen the product exists for, so it behaves differently on
 * purpose:
 *
 *   - the sample is drawn on the server and never shown in advance, so the
 *     trainee cannot prepare for the specific questions
 *   - no hints, ever
 *   - one attempt per step, no retries — a wrong answer here is the finding
 *
 * What it deliberately does NOT do is lock the trainee out early. Failing the
 * re-check records the failure and withholds the certificate; the trainee
 * retrains and takes it again. The gate withholds, not this page.
 *
 * All the interaction is the shared runner, driven with `phase: "recheck"`
 * over a synthetic manifest containing only the sampled steps. Nothing about
 * grading is reimplemented here.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { clsx } from "clsx";
import { BrainCircuit, Lock, ShieldAlert, Timer } from "lucide-react";
import { useSession, useT } from "../lib/session";
import { Button, Chip, Panel } from "../components/ui";
import { Training, type RunOutcome } from "./Training";
import { bundledManifests, fetchRecheckSample, fetchRecheckStatus, submitRecheck } from "../lib/api";
import { RECHECK_MIN_DELAY_MS } from "../lib/gate";
import { MODULES } from "../lib/modules";
import type { ModuleManifest, RecheckSample } from "../lib/types";

export function Recheck() {
  const t = useT();
  const { token } = useSession();
  const navigate = useNavigate();

  const manifests = useMemo(() => bundledManifests(), []);
  const [sample, setSample] = useState<RecheckSample[] | null>(null);
  const [blocked, setBlocked] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setBlocked("Sign in to take the re-check.");
      return;
    }

    void (async () => {
      const [status, sampled] = await Promise.all([
        fetchRecheckStatus(token),
        fetchRecheckSample(token, manifests),
      ]);

      if (status.ok) {
        if (status.value.alreadyTaken) {
          setBlocked("You have already taken the re-check for this certification attempt.");
          return;
        }
        if (!status.value.eligible) {
          setBlocked(
            `The retention gap has not elapsed — ${Math.ceil(status.value.msRemaining / 1000)}s remaining.`,
          );
          return;
        }
      }

      if (!sampled.ok || sampled.value.length === 0) {
        setBlocked(
          "A sample cannot be drawn right now. The backend is unreachable or both modules are not complete yet.",
        );
        return;
      }
      setSample(sampled.value);
    })();
  }, [token, manifests]);

  if (blocked) {
    return (
      <Panel className="border-warn-400/30">
        <div className="flex items-start gap-4">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-warn-400/15 text-warn-400">
            <Lock className="h-5 w-5" />
          </span>
          <div>
            <h1 className="text-lg font-semibold text-fog-50">{t("recheck.waiting")}</h1>
            <p className="mt-1.5 text-sm text-fog-400">{blocked}</p>
            <div className="mt-5 flex gap-3">
              <Button onClick={() => navigate("/dashboard")} variant="secondary">
                {t("result.backToDashboard")}
              </Button>
              <Button onClick={() => navigate("/recheck")}>Check again</Button>
            </div>
          </div>
        </div>
      </Panel>
    );
  }

  if (!sample) {
    return (
      <div className="panel grid-bg-fine grid h-64 place-items-center">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-fog-600">
          drawing your sample…
        </p>
      </div>
    );
  }

  return <RecheckFlow sample={sample} manifests={manifests} />;
}

function RecheckFlow({
  sample,
  manifests,
}: {
  sample: RecheckSample[];
  manifests: ModuleManifest[];
}) {
  const t = useT();
  const { token } = useSession();
  const navigate = useNavigate();

  const [verdict, setVerdict] = useState<RunOutcome[] | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const submitting = useRef(false);

  /**
   * A manifest containing only the sampled steps, drawn from whichever modules
   * contributed. Original step ids and sequence numbers are preserved, so the
   * recorded results line up with the training attempts they test.
   */
  const recheckManifest = useMemo<ModuleManifest>(() => {
    const wanted = new Set(sample.map((s) => s.stepId));
    const contributing = [...new Set(sample.map((s) => s.moduleCode))]
      .map((code) => MODULES[code])
      .filter((m): m is ModuleManifest => Boolean(m));

    const first = contributing[0] ?? manifests[0]!;
    return {
      ...first,
      code: "RECHECK",
      title: { en: "Cold retention re-check", hi: "शीत प्रतिधारण पुनःपरीक्षण" },
      steps: contributing.flatMap((m) => m.steps).filter((s) => wanted.has(s.id)),
    };
  }, [sample, manifests]);

  async function onComplete(outcomes: RunOutcome[]) {
    setVerdict(outcomes);
    if (!token || submitting.current) return;
    submitting.current = true;

    const result = await submitRecheck(token, manifests, outcomes);
    setSubmitted(result.ok);

    if (result.ok) {
      // Give the verdict a beat to land before moving on.
      setTimeout(() => navigate("/result?recheck=1", { replace: true }), 1200);
    }
    submitting.current = false;
  }

  const retained = verdict?.filter((v) => v.outcome === "pass").length ?? 0;

  return (
    <div className="space-y-6">
      <header>
        <Chip tone="warn">
          <BrainCircuit className="h-3 w-3" />
          G7
        </Chip>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-fog-50">
          {t("recheck.title")}
        </h1>
        <p className="mt-3 max-w-2xl text-pretty text-sm leading-relaxed text-fog-400">
          {t("recheck.subtitle")}
        </p>
        <p className="mt-2 max-w-2xl text-sm text-fog-600">{t("recheck.sampleNotice")}</p>
      </header>

      <div className="grid gap-4 sm:grid-cols-3">
        <Figure label="Sample size" value={sample.length} />
        <Figure
          label="Critical steps"
          value={sample.filter((s) => s.critical).length}
          tone="halt"
        />
        <Figure label="Retention gap" value={`${Math.round(RECHECK_MIN_DELAY_MS / 1000)}s`} />
      </div>

      {/* The runner. `onComplete` fires once, with the first-attempt grades. */}
      <Training
        manifest={recheckManifest}
        phase="recheck"
        sample={sample}
        onComplete={(outcomes) => void onComplete(outcomes)}
      />

      {verdict && (
        <Panel
          className={clsx(
            "animate-rise",
            retained === sample.length ? "border-go-400/40" : "border-halt-400/40",
          )}
        >
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <ShieldAlert
                className={clsx(
                  "h-5 w-5",
                  retained === sample.length ? "text-go-300" : "text-halt-300",
                )}
              />
              <div>
                <p className="text-base font-semibold text-fog-50">
                  {retained === sample.length ? t("recheck.passed") : t("recheck.failed")}
                </p>
                <p className="mt-0.5 text-sm text-fog-400">
                  {retained} of {sample.length} retained after the gap.
                  {submitted && " Recording the result…"}
                </p>
              </div>
            </div>

            {retained < sample.length && (
              <Button variant="secondary" onClick={() => navigate("/result?recheck=1")}>
                {t("result.backToDashboard")}
              </Button>
            )}
          </div>
        </Panel>
      )}
    </div>
  );
}

function Figure({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: number | string;
  tone?: "neutral" | "halt";
}) {
  return (
    <Panel className="p-4">
      <p className="flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-wider text-fog-600">
        <Timer className="h-3 w-3" />
        {label}
      </p>
      <p
        className={clsx(
          "tnum mt-1 font-mono text-2xl font-semibold",
          tone === "halt" ? "text-halt-300" : "text-fog-50",
        )}
      >
        {value}
      </p>
    </Panel>
  );
}
