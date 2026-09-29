/**
 * Trainee dashboard.
 *
 * Answers three questions in order of urgency: do I have a valid certificate,
 * what do I still owe, and what do I start next. Everything else is supporting
 * detail — a trainee opening this on a phone between shifts should be done in
 * ten seconds.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  Award,
  BrainCircuit,
  CheckCircle2,
  CircleDot,
  Clock,
  Flame,
  Play,
  RefreshCw,
} from "lucide-react";
import { useSession, useT } from "../lib/session";
import { Button, Chip, EmptyState, LinkButton, Meter, Panel, SectionLabel } from "../components/ui";
import { OfflineNotice } from "../components/AppShell";
import { fetchAssessment, fetchRecheckStatus, fetchSessions, bundledManifests } from "../lib/api";
import { MODULES, MODULE_CODES } from "../lib/modules";
import { GATE_THRESHOLDS, RECHECK_MIN_DELAY_MS } from "../lib/gate";
import type { GateResult, ModuleManifest, ModuleScore } from "../lib/types";
import { pendingCount } from "../lib/db";
import { useSyncQueue } from "../lib/sync";

interface SessionRow {
  id: string;
  moduleCode: string;
  completedAt: number | null;
  finalScore: number | null;
  passed: boolean | null;
}

interface RecheckState {
  modulesCompleted: number;
  eligible: boolean;
  msRemaining: number;
  alreadyTaken: boolean;
  earliestEligibleAt: number | null;
}

const DOMAIN_ICON: Record<string, typeof Flame> = {
  fire_and_explosion: Flame,
  gas_leak_confined_space: CircleDot,
};

export function Dashboard() {
  const t = useT();
  const { profile, token, locale, backendReachable } = useSession();
  const queue = useSyncQueue(token);

  const manifests = useMemo(() => bundledManifests(), []);
  const [scores, setScores] = useState<ModuleScore[]>([]);
  const [gate, setGate] = useState<GateResult | null>(null);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [recheck, setRecheck] = useState<RecheckState | null>(null);
  const [queued, setQueued] = useState(0);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!token) {
      setLoading(false);
      return;
    }
    const [assessment, sessionRows, status] = await Promise.all([
      fetchAssessment(token, manifests),
      fetchSessions(token),
      fetchRecheckStatus(token),
    ]);

    if (assessment.ok) {
      setScores(assessment.value.moduleScores);
      setGate(assessment.value.gate);
    }
    if (sessionRows.ok) {
      setSessions(sessionRows.value as unknown as SessionRow[]);
    }
    if (status.ok) setRecheck(status.value as unknown as RecheckState);
    setQueued(await pendingCount().catch(() => 0));
    setLoading(false);
  }, [token, manifests]);

  useEffect(() => {
    void load();
  }, [load]);

  // The eligibility countdown has to tick on its own; nothing else will
  // re-render it when the 90 seconds elapse.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const latestByModule = useMemo(() => {
    const map = new Map<string, SessionRow>();
    for (const row of sessions) {
      if (!row.completedAt) continue;
      const existing = map.get(row.moduleCode);
      if (!existing || (row.completedAt ?? 0) > (existing.completedAt ?? 0)) {
        map.set(row.moduleCode, row);
      }
    }
    return map;
  }, [sessions]);

  const failedCriteria = gate?.criteria.filter((c) => !c.met) ?? [];
  const awaitingRecheck =
    gate !== null &&
    !gate.failed.includes("G7") &&
    failedCriteria.some((c) => !c.met) &&
    recheck !== null &&
    !recheck.alreadyTaken;

  const modulesDone = MODULE_CODES.filter((c) => latestByModule.has(c)).length;

  return (
    <div className="space-y-8">
      {/* -- Greeting ----------------------------------------------------- */}
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-amber-400">
            {profile?.workerCode ?? "—"} · {profile?.orgName}
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-fog-50">
            {t("dashboard.greeting")}
            {profile ? `, ${profile.name.split(" ")[0]}` : ""}.
          </h1>
        </div>
        <Button variant="secondary" size="sm" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={loading ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
          Refresh
        </Button>
      </header>

      {!backendReachable && <OfflineNotice queued={queued} />}

      {/* -- Certificate standing ----------------------------------------- */}
      <Panel className={gate?.passed ? "border-go-400/40" : ""}>
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-4">
            <span
              className={`grid h-12 w-12 shrink-0 place-items-center rounded-xl ${
                gate?.passed ? "bg-go-400/15 text-go-300" : "bg-ink-800 text-amber-400"
              }`}
            >
              {gate?.passed ? (
                <CheckCircle2 className="h-6 w-6" />
              ) : (
                <Award className="h-6 w-6" />
              )}
            </span>
            <div>
              <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-fog-600">
                {t("dashboard.yourStanding")}
              </p>
              <h2 className="mt-1 text-lg font-semibold text-fog-50">
                {gate?.passed ? t("result.certificateIssued") : t("dashboard.noCertificate")}
              </h2>
              {gate && (
                <p className="mt-1 text-sm text-fog-400">
                  {gate.criteria.filter((c) => c.met).length} of {gate.criteria.length} criteria
                  met.
                  {!gate.passed && failedCriteria.length > 0 && (
                    <>
                      {" "}
                      Outstanding:{" "}
                      <span className="font-mono text-amber-300">
                        {failedCriteria.map((c) => c.id).join(", ")}
                      </span>
                    </>
                  )}
                </p>
              )}
            </div>
          </div>

          <div className="flex shrink-0 gap-2">
            {gate?.passed ? (
              <LinkButton to="/certificate" size="sm">
                <Award className="h-4 w-4" />
                {t("dashboard.certificate")}
              </LinkButton>
            ) : awaitingRecheck && recheck?.eligible ? (
              <LinkButton to="/recheck" size="sm">
                <BrainCircuit className="h-4 w-4" />
                {t("result.takeRecheck")}
              </LinkButton>
            ) : (
              <LinkButton to="/dashboard" variant="secondary" size="sm" className="pointer-events-none opacity-50">
                <Clock className="h-4 w-4" />
                {t("recheck.waiting")}
              </LinkButton>
            )}
          </div>
        </div>
      </Panel>

      {/* -- Re-check readiness ------------------------------------------- */}
      {recheck && !recheck.alreadyTaken && modulesDone > 0 && (
        <RecheckReadiness state={recheck} now={now} totalModules={MODULE_CODES.length} />
      )}

      {/* -- Modules ------------------------------------------------------ */}
      <section>
        <SectionLabel>{t("dashboard.modules")}</SectionLabel>
        <div className="grid gap-4 md:grid-cols-2">
          {MODULE_CODES.map((code) => (
            <ModuleCard
              key={code}
              manifest={MODULES[code]!}
              session={latestByModule.get(code)}
              score={scores.find((s) => s.moduleCode === code)}
              locale={locale}
            />
          ))}
        </div>
      </section>

      {sessions.length === 0 && !loading && (
        <EmptyState
          title="no history yet"
          body={
            <>
              Run a module above and this fills in. Everything is scored on the device first,
              so it works with the network off.
            </>
          }
        />
      )}

      {/* -- Criteria reference ------------------------------------------- */}
      {gate && (
        <section>
          <SectionLabel>{t("result.gateTitle")}</SectionLabel>
          <GateStrip criteria={gate.criteria} />
        </section>
      )}

      {queue.pending > 0 && (
        <p className="text-center font-mono text-[11px] text-fog-800">
          {queue.pending} attempt{queue.pending === 1 ? "" : "s"} waiting to sync ·{" "}
          <button type="button" onClick={queue.flush} className="text-amber-400 hover:underline">
            flush now
          </button>
        </p>
      )}
    </div>
  );
}

function ModuleCard({
  manifest,
  session,
  score,
  locale,
}: {
  manifest: ModuleManifest;
  session?: SessionRow;
  score?: ModuleScore;
  locale: "en" | "hi" | "sat";
}) {
  const t = useT();
  const Icon = DOMAIN_ICON[manifest.domain] ?? CircleDot;
  const done = Boolean(session?.completedAt);
  const criticals = manifest.steps.filter((s) => s.critical).length;

  return (
    <article className="panel flex flex-col p-0">
      <div className="flex items-start gap-4 p-5 sm:p-6">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-ink-800 text-amber-400">
          <Icon className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-semibold text-fog-50">{manifest.title[locale === "sat" ? "en" : locale]}</h3>
          <p className="mt-1 font-mono text-[11px] uppercase tracking-wider text-fog-800">
            {manifest.steps.length} {t("dashboard.steps")} · {manifest.estimatedMinutes}{" "}
            {t("dashboard.minutes")} · {criticals} {t("common.critical").toLowerCase()}
          </p>
        </div>
        {done && session?.finalScore !== null && (
          <span className="tnum shrink-0 font-mono text-2xl font-semibold text-fog-50">
            {session?.finalScore}
          </span>
        )}
      </div>

      {done && score && (
        <div className="border-t border-ink-800 px-5 py-4 sm:px-6">
          <div className="grid grid-cols-3 gap-3 font-mono text-[11px]">
            <Metric
              label="1st try"
              value={`${Math.round(score.firstAttemptAccuracy * 100)}%`}
              tone={score.firstAttemptAccuracy >= GATE_THRESHOLDS.minFirstAttemptAccuracy ? "go" : "halt"}
            />
            <Metric
              label="hints"
              value={`${Math.round(score.meanHintDependency * 100)}%`}
              tone={score.meanHintDependency <= GATE_THRESHOLDS.maxMeanHintDependency ? "go" : "warn"}
            />
            <Metric
              label="critical"
              value={`${score.criticalMisses}`}
              tone={score.criticalMisses === 0 ? "go" : "halt"}
            />
          </div>
          {score.criticalMisses > 0 && (
            <div className="mt-3">
              <Meter value={score.criticalMisses} max={criticals || 1} tone="halt" />
              <p className="mt-1.5 font-mono text-[11px] text-halt-300">
                {score.criticalMisses} critical step
                {score.criticalMisses === 1 ? "" : "s"} missed first time — blocks the
                certificate.
              </p>
            </div>
          )}
        </div>
      )}

      <div className="mt-auto border-t border-ink-800 p-5 sm:px-6">
        <LinkButton
          to={`/train/${manifest.code}`}
          variant={done ? "secondary" : "primary"}
          size="md"
          className="w-full"
        >
          {done ? t("dashboard.retake") : t("dashboard.startModule")}
          {done ? <RefreshCw className="h-4 w-4" /> : <Play className="h-4 w-4" />}
        </LinkButton>
      </div>
    </article>
  );
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "go" | "halt" | "warn";
}) {
  const tones = { go: "text-go-300", halt: "text-halt-300", warn: "text-warn-400" };
  return (
    <div>
      <div className={`tnum text-base font-semibold ${tones[tone]}`}>{value}</div>
      <div className="text-[10px] uppercase tracking-wider text-fog-800">{label}</div>
    </div>
  );
}

function RecheckReadiness({
  state,
  now,
  totalModules,
}: {
  state: RecheckState;
  now: number;
  totalModules: number;
}) {
  const t = useT();
  // The server sends the absolute eligibility time; the countdown is derived
  // from the local clock so it ticks without a round trip.
  const remaining =
    state.earliestEligibleAt === null
      ? RECHECK_MIN_DELAY_MS
      : Math.max(0, state.earliestEligibleAt - now);
  const elapsed = Math.max(
    0,
    Math.min(1, 1 - remaining / RECHECK_MIN_DELAY_MS),
  );

  if (state.modulesCompleted < totalModules) {
    return (
      <Panel className="border-warn-400/30">
        <div className="flex items-center gap-3.5">
          <Clock className="h-5 w-5 shrink-0 text-warn-400" />
          <div>
            <p className="text-sm font-medium text-fog-50">
              {state.modulesCompleted} of {totalModules} modules complete
            </p>
            <p className="mt-0.5 text-sm text-fog-400">
              The cold re-check samples across both modules, so finish both first.
            </p>
          </div>
        </div>
      </Panel>
    );
  }

  if (state.eligible) {
    return (
      <Panel className="border-amber-400/40 bg-amber-400/[0.04]">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3.5">
            <BrainCircuit className="h-5 w-5 shrink-0 text-amber-400" />
            <div>
              <p className="text-sm font-medium text-fog-50">{t("recheck.eligible")}</p>
              <p className="mt-0.5 text-sm text-fog-400">{t("recheck.subtitle")}</p>
            </div>
          </div>
          <LinkButton to="/recheck" size="sm" className="shrink-0">
            {t("result.takeRecheck")}
            <ArrowRight className="h-4 w-4" />
          </LinkButton>
        </div>
      </Panel>
    );
  }

  const seconds = Math.ceil(remaining / 1000);
  return (
    <Panel>
      <div className="flex items-center gap-3.5">
        <Clock className="h-5 w-5 shrink-0 text-fog-400" />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-sm font-medium text-fog-50">{t("recheck.waiting")}</p>
            <span className="tnum font-mono text-sm text-amber-300">
              {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}
            </span>
          </div>
          <Meter value={elapsed} className="mt-2.5" />
          <p className="mt-2 text-xs text-fog-600">
            The gap is the point. A re-check taken immediately measures recall of the screen
            you just used, not retention.
          </p>
        </div>
      </div>
    </Panel>
  );
}

export function GateStrip({ criteria }: { criteria: GateResult["criteria"] }) {
  return (
    <div className="grid gap-px overflow-hidden rounded-xl border border-ink-700 bg-ink-700 sm:grid-cols-2 lg:grid-cols-4">
      {criteria.map((c) => (
        <div key={c.id} className="bg-ink-850 p-4">
          <div className="flex items-center gap-2">
            <span
              className={`tnum grid h-6 w-8 place-items-center rounded font-mono text-[11px] font-semibold ${
                c.met ? "bg-go-400/15 text-go-300" : "bg-halt-400/15 text-halt-300"
              }`}
            >
              {c.id}
            </span>
            <span className="text-xs font-medium text-fog-200">{c.label}</span>
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-fog-600">{c.detail}</p>
        </div>
      ))}
    </div>
  );
}
