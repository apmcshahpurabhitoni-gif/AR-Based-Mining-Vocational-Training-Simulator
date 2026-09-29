/**
 * Gate result.
 *
 * The screen the product is actually about. It shows the score AND the gate,
 * because they can disagree — a trainee can score 89 and still be refused a
 * certificate because they missed a critical step first time. Showing only the
 * number would teach the wrong lesson.
 *
 * Every failing criterion says what was measured, what was required, and what
 * to do. A red cross with no explanation is not feedback.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { clsx } from "clsx";
import {
  ArrowRight,
  BrainCircuit,
  Check,
  CircleSlash,
  Info,
  TriangleAlert,
} from "lucide-react";
import { useSession, useT } from "../lib/session";
import { Button, Chip, LinkButton, Meter, Panel } from "../components/ui";
import { GateStrip } from "./Dashboard";
import { bundledManifests, fetchAssessment, fetchRecheckStatus, issueCertificate } from "../lib/api";
import type { GateResult, ModuleScore } from "../lib/types";
import { GATE_THRESHOLDS } from "../lib/gate";

export function Result() {
  const t = useT();
  const { token } = useSession();
  const [params] = useSearchParams();
  const wasRecheck = params.get("recheck") === "1";

  const manifests = useMemo(() => bundledManifests(), []);
  const [scores, setScores] = useState<ModuleScore[]>([]);
  const [gate, setGate] = useState<GateResult | null>(null);
  const [recheckEligible, setRecheckEligible] = useState(false);
  const [issuedCode, setIssuedCode] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [issuing, setIssuing] = useState(false);

  const load = useCallback(async () => {
    if (!token) {
      setLoading(false);
      return;
    }
    const [assessment, status] = await Promise.all([
      fetchAssessment(token, manifests),
      fetchRecheckStatus(token),
    ]);
    if (assessment.ok) {
      setScores(assessment.value.moduleScores);
      setGate(assessment.value.gate);
    }
    if (status.ok) {
      setRecheckEligible(status.value.eligible && !status.value.alreadyTaken);
    }
    setLoading(false);
  }, [token, manifests]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Issue on arrival when the gate already passes.
   *
   * Safe to call automatically: the mutation is idempotent per user, so a
   * reload cannot mint a second certificate. It also refuses if the gate fails.
   */
  useEffect(() => {
    if (!gate?.passed || !token || issuedCode) return;
    setIssuing(true);
    void issueCertificate(token, manifests).then((result) => {
      if (result.ok && result.value.issued) setIssuedCode(result.value.code as string);
      setIssuing(false);
    });
  }, [gate, token, issuedCode, manifests]);

  if (loading) {
    return (
      <div className="panel grid-bg-fine grid h-64 place-items-center">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-fog-600">scoring…</p>
      </div>
    );
  }

  if (!gate) {
    return (
      <Panel>
        <p className="text-fog-400">
          Results are not available yet. They are computed on the server from your recorded
          attempts — reconnect if you trained offline.
        </p>
        <LinkButton to="/dashboard" className="mt-5">
          {t("result.backToDashboard")}
        </LinkButton>
      </Panel>
    );
  }

  const failed = gate.criteria.filter((c) => !c.met);
  const recheckPending = gate.failed.includes("G7") || !recheckEligible;

  return (
    <div className="space-y-6">
      {/* -- Verdict ------------------------------------------------------ */}
      <Panel className={clsx("overflow-hidden", gate.passed ? "border-go-400/40" : "border-amber-400/30")}>
        {gate.passed && <div className="h-1 w-full bg-go-400" aria-hidden="true" />}
        {!gate.passed && failed.some((c) => c.id === "G3" || c.id === "G4") && (
          <div className="hazard-tape h-1 w-full opacity-80" aria-hidden="true" />
        )}

        <div className="flex flex-col gap-6 p-6 sm:flex-row sm:items-start sm:justify-between sm:p-8">
          <div className="min-w-0">
            <Chip tone={gate.passed ? "go" : "amber"}>{t("result.trainingComplete")}</Chip>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight text-fog-50">
              {gate.passed ? t("result.certificateIssued") : t("result.certificateBlocked")}
            </h1>
            <p className="mt-3 max-w-xl text-pretty text-sm leading-relaxed text-fog-400">
              {gate.passed
                ? "Every criterion is met, including the cold retention re-check. This certificate is a record of competence, not attendance."
                : recheckPending
                  ? t("result.recheckRequired")
                  : `${failed.length} of ${gate.criteria.length} criteria are not met. Retrain the affected module — the gate re-evaluates from your most recent run.`}
            </p>
          </div>

          <div className="shrink-0 sm:text-right">
            <div className="tnum font-mono text-6xl font-semibold tracking-tight text-fog-50">
              {gate.criteria.filter((c) => c.met).length}
              <span className="text-2xl text-fog-800">/{gate.criteria.length}</span>
            </div>
            <p className="mt-1 font-mono text-[11px] uppercase tracking-wider text-fog-600">
              criteria met
            </p>
          </div>
        </div>
      </Panel>

      {/* -- Module scores ------------------------------------------------ */}
      <div className="grid gap-4 sm:grid-cols-2">
        {scores.map((score) => {
          const met = score.score >= GATE_THRESHOLDS.minModuleScore;
          return (
            <div key={score.moduleCode} className="panel p-5">
              <div className="flex items-baseline justify-between">
                <h3 className="font-mono text-xs uppercase tracking-wider text-fog-400">
                  {score.moduleCode}
                </h3>
                <span className={clsx("tnum font-mono text-2xl font-semibold", met ? "text-fog-50" : "text-halt-300")}>
                  {score.score}
                </span>
              </div>
              <Meter value={score.score} max={100} tone={met ? "go" : "halt"} className="mt-3" />
              <p className="mt-2 font-mono text-[11px] text-fog-800">
                first try {Math.round(score.firstAttemptAccuracy * 100)}% · hints{" "}
                {Math.round(score.meanHintDependency * 100)}% · critical misses{" "}
                {score.criticalMisses}
              </p>
            </div>
          );
        })}
      </div>

      {/* -- The gate ------------------------------------------------------ */}
      <section>
        <div className="mb-3 flex items-center gap-2">
          <h2 className="font-mono text-[11px] font-semibold uppercase tracking-[0.18em] text-fog-600">
            {t("result.gateTitle")}
          </h2>
          <Info className="h-3.5 w-3.5 text-fog-800" />
        </div>
        <GateStrip criteria={gate.criteria} />
      </section>

      {/* -- What to do next ----------------------------------------------- */}
      {!gate.passed && failed.length > 0 && (
        <Panel className="border-halt-400/30">
          <h2 className="flex items-center gap-2 text-base font-semibold text-fog-50">
            <TriangleAlert className="h-4 w-4 text-halt-400" />
            What is holding the certificate
          </h2>
          <ul className="mt-4 space-y-3">
            {failed.map((c) => (
              <li key={c.id} className="flex gap-3">
                <span className="tnum mt-0.5 grid h-6 w-8 shrink-0 place-items-center rounded bg-halt-400/15 font-mono text-[11px] font-semibold text-halt-300">
                  {c.id}
                </span>
                <div>
                  <p className="text-sm font-medium text-fog-100">{c.label}</p>
                  <p className="mt-0.5 text-sm text-fog-400">{c.detail}</p>
                  <p className="mt-1 font-mono text-[11px] text-fog-800">
                    measured {formatValue(c.value)} · required {formatValue(c.threshold)}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {/* -- Actions -------------------------------------------------------- */}
      <div className="flex flex-wrap gap-3">
        {gate.passed && issuedCode && (
          <LinkButton to={`/certificate/${issuedCode}`} size="lg">
            <Check className="h-5 w-5" />
            {t("dashboard.certificate")}
            <ArrowRight className="h-5 w-5" />
          </LinkButton>
        )}
        {gate.passed && issuing && (
          <Button size="lg" disabled>
            {t("common.loading")}
          </Button>
        )}
        {!gate.passed && recheckPending && (
          <LinkButton
            to="/recheck"
            size="lg"
            variant={recheckEligible ? "primary" : "secondary"}
          >
            <BrainCircuit className="h-5 w-5" />
            {t("result.takeRecheck")}
          </LinkButton>
        )}
        <LinkButton to="/dashboard" variant="secondary" size="lg">
          {t("result.backToDashboard")}
        </LinkButton>
      </div>

      {!gate.passed && !recheckPending && (
        <p className="flex items-start gap-2 text-sm text-fog-600">
          <CircleSlash className="mt-0.5 h-4 w-4 shrink-0" />
          Retraining replaces your most recent run for that module. The gate always evaluates
          the latest honest attempt — there is no way to keep an older, better score on file.
        </p>
      )}

      {wasRecheck && (
        <p className="text-center font-mono text-[11px] text-fog-800">
          This was a cold re-check. Its result is recorded as its own event, separately from
          your training attempts.
        </p>
      )}
    </div>
  );
}

function formatValue(value: number): string {
  if (!Number.isFinite(value)) return "—";
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(2);
}
