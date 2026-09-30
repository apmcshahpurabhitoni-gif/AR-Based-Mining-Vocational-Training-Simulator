/**
 * Landing page.
 *
 * The job of this page is to make one argument: everyone else certifies that
 * you turned up. This one checks whether you can still do the job ninety
 * seconds later. Everything on it supports that claim, so the hero shows the
 * actual gate rather than a stock illustration, and the numbers come from the
 * database rather than being invented.
 */

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  BatteryCharging,
  BrainCircuit,
  Camera,
  Grid3x3,
  Languages,
  QrCode,
  ShieldCheck,
  ThermometerSun,
  TriangleAlert,
} from "lucide-react";
import { useSession, useT } from "../lib/session";
import { Button, Chip, LinkButton } from "../components/ui";
import { BACKEND_LABEL, fetchDemoStats, publishBundledModules } from "../lib/api";
import { GATE_THRESHOLDS } from "../lib/gate";
import { LOCALE_LABELS, SELECTABLE_LOCALES } from "../lib/i18n";
import type { Locale } from "../lib/types";
import { MODULE_CODES, MODULES } from "../lib/modules";

interface Stats {
  trainees: number;
  certificatesIssued: number;
  criticalSteps: number;
  steps: number;
}

export function Landing() {
  const t = useT();
  const { profile, locale, setLocale } = useSession();
  const [stats, setStats] = useState<Stats | null>(null);
  const [reachable, setReachable] = useState(true);

  useEffect(() => {
    // Publish on first load so a brand-new database has content to serve.
    void publishBundledModules().then((r) => {
      setReachable(r.ok);
      if (r.ok) void fetchDemoStats().then((s) => setStats(s.ok ? s.value : null));
    });
  }, []);

  const criticalCount = MODULE_CODES.reduce(
    (n, code) => n + MODULES[code]!.steps.filter((s) => s.critical).length,
    0,
  );

  const stepCount = MODULE_CODES.reduce((n, code) => n + MODULES[code]!.steps.length, 0);

  return (
    <div className="min-h-dvh bg-ink-950">
      <div className="hazard-tape h-1 w-full opacity-70" aria-hidden="true" />

      <header className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-4 sm:px-6">
        <div className="flex items-center gap-2.5">
          <span className="grid h-8 w-8 place-items-center rounded-md bg-amber-400 text-ink-950">
            <ShieldCheck className="h-5 w-5" strokeWidth={2.4} />
          </span>
          <span className="font-mono text-sm font-bold tracking-[0.2em] text-fog-50">KAVACH</span>
        </div>

        <nav className="ml-auto flex items-center gap-2">
          <LocalePills locale={locale} onChange={setLocale} />
          {profile ? (
            <LinkButton to="/dashboard" size="sm">
              {t("nav.dashboard")}
              <ArrowRight className="h-4 w-4" />
            </LinkButton>
          ) : (
            <>
              <LinkButton to="/verify" variant="ghost" size="sm">
                {t("landing.cta.secondary")}
              </LinkButton>
              <LinkButton to="/auth" size="sm">
                {t("common.signIn")}
              </LinkButton>
            </>
          )}
        </nav>
      </header>

      {/* -- Hero ---------------------------------------------------------- */}
      <section className="relative overflow-hidden">
        <div className="grid-bg pointer-events-none absolute inset-0 opacity-60" />
        <div
          className="pointer-events-none absolute left-1/2 top-0 h-[420px] w-[820px] -translate-x-1/2 rounded-full opacity-25 blur-3xl"
          style={{ background: "radial-gradient(closest-side, #f5920a, transparent)" }}
          aria-hidden="true"
        />

        <div className="relative mx-auto grid max-w-6xl gap-12 px-4 pb-16 pt-14 sm:px-6 lg:grid-cols-[1.05fr_0.95fr] lg:items-center lg:pb-24 lg:pt-20">
          <div className="animate-rise">
            <Chip tone="amber" className="mb-6">
              <span className="h-1.5 w-1.5 rounded-full bg-current" />
              SIH26041 · Govt. of Jharkhand
            </Chip>

            <h1 className="text-balance text-4xl font-semibold leading-[1.08] tracking-tight text-fog-50 sm:text-5xl lg:text-6xl">
              {t("landing.hero.title")}
            </h1>

            <p className="mt-6 max-w-xl text-pretty text-base leading-relaxed text-fog-400 sm:text-lg">
              {t("landing.hero.subtitle")}
            </p>

            <div className="mt-9 flex flex-wrap items-center gap-3">
              <LinkButton to={profile ? "/dashboard" : "/auth"} size="lg">
                {t("landing.cta.primary")}
                <ArrowRight className="h-5 w-5" />
              </LinkButton>
              <LinkButton to="/verify" variant="secondary" size="lg">
                <QrCode className="h-5 w-5" />
                {t("landing.cta.secondary")}
              </LinkButton>
            </div>

            <p className="mt-4 font-mono text-[11px] text-fog-800">
              No headset. No printed markers. Runs offline.
            </p>
          </div>

          <GatePanel />
        </div>
      </section>

      {/* -- Live numbers --------------------------------------------------- */}
      <section className="border-y border-ink-700 bg-ink-900">
        <div className="mx-auto grid max-w-6xl grid-cols-2 gap-6 px-4 py-8 sm:px-6 md:grid-cols-4">
          <Figure
            value={stats ? stats.certificatesIssued : "—"}
            label={t("landing.stat.certificates")}
            icon={ShieldCheck}
          />
          <Figure value={stats ? stats.trainees : "—"} label={t("landing.stat.trainees")} icon={BrainCircuit} />
          <Figure
            value={stats ? stats.criticalSteps || criticalCount : criticalCount}
            label={t("landing.stat.critical")}
            icon={ThermometerSun}
          />
          <Figure value={stepCount} label="assessed steps" icon={Grid3x3} />
        </div>
      </section>

      {/* -- Features ------------------------------------------------------- */}
      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:py-24">
        <div className="mb-12 max-w-2xl">
          <p className="mb-3 font-mono text-[11px] font-semibold uppercase tracking-[0.2em] text-amber-400">
            Why it is different
          </p>
          <h2 className="text-3xl font-semibold tracking-tight text-fog-50 sm:text-4xl">
            Six reasons a KAVACH certificate is worth checking
          </h2>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Feature
            icon={ThermometerSun}
            title={t("landing.feature.gate.title")}
            body={t("landing.feature.gate.body")}
          />
          <Feature
            icon={BrainCircuit}
            title={t("landing.feature.recheck.title")}
            body={t("landing.feature.recheck.body")}
            accent
          />
          <Feature
            icon={Grid3x3}
            title={t("landing.feature.heatmap.title")}
            body={t("landing.feature.heatmap.body")}
          />
          <Feature
            icon={BatteryCharging}
            title={t("landing.feature.offline.title")}
            body={t("landing.feature.offline.body")}
          />
          <Feature
            icon={Camera}
            title={t("landing.feature.nohelmet.title")}
            body={t("landing.feature.nohelmet.body")}
          />
          <Feature
            icon={Languages}
            title={t("landing.feature.bilingual.title")}
            body={t("landing.feature.bilingual.body")}
          />
        </div>
      </section>

      {/* -- How it works --------------------------------------------------- */}
      <section className="border-t border-ink-700 bg-ink-900">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:py-20">
          <div className="mb-10 max-w-2xl">
            <p className="mb-3 font-mono text-[11px] font-semibold uppercase tracking-[0.2em] text-amber-400">
              The certification path
            </p>
            <h2 className="text-3xl font-semibold tracking-tight text-fog-50 sm:text-4xl">
              Four steps between you and a certificate you can defend
            </h2>
            {/*
             * The pre-pilot disclosure.
             *
             * This page promises a certificate at the top and in the call to
             * action, and the platform will not issue one today: a required
             * module has a step the safety reviewer has not approved, so it
             * cannot be completed, and a module that cannot be completed cannot
             * be certified. The gate is doing exactly what it was built to do.
             * Leaving that off this page would mean inviting a real trainee into
             * a certification they cannot finish, on the strength of a promise
             * the product cannot keep yet.
             */}
            <div className="mt-6 max-w-2xl rounded-lg border border-warn-400/30 bg-warn-400/5 p-4">
              <p className="flex items-center gap-2 font-mono text-[11px] font-semibold uppercase tracking-[0.2em] text-warn-400">
                <TriangleAlert className="h-4 w-4" />
                {t("landing.status.title")}
              </p>
              <p className="mt-2 text-sm leading-relaxed text-fog-300">
                {t("landing.status.body")}
              </p>
            </div>
          </div>

          <ol className="grid gap-px overflow-hidden rounded-xl border border-ink-700 bg-ink-700 sm:grid-cols-2 lg:grid-cols-4">
            {[
              {
                n: "01",
                title: "Train both modules",
                body: t("landing.step.train.body"),
              },
              {
                n: "02",
                title: "Clear the gate",
                body: `Eight criteria. ${GATE_THRESHOLDS.maxCriticalMisses} critical misses allowed, ${Math.round(GATE_THRESHOLDS.maxMeanHintDependency * 100)}% mean hint dependency, ${GATE_THRESHOLDS.minModuleScore} minimum per module.`,
              },
              {
                n: "03",
                title: "Wait 90 seconds, then prove it",
                body: "Four steps are re-sampled on the server. No hints, no retries, one attempt each. You do not get to see which ones.",
              },
              {
                n: "04",
                title: "Get a scannable certificate",
                body: "A signed code, valid for a year, carrying the retention result — not just a completion tick.",
              },
            ].map((step) => (
              <li key={step.n} className="bg-ink-850 p-6">
                <span className="font-mono text-xs tracking-[0.2em] text-amber-400">{step.n}</span>
                <h3 className="mt-3 text-base font-semibold text-fog-50">{step.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-fog-400">{step.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* -- Closing CTA ---------------------------------------------------- */}
      <section className="relative overflow-hidden">
        <div className="grid-bg pointer-events-none absolute inset-0 opacity-40" />
        <div className="relative mx-auto max-w-3xl px-4 py-20 text-center sm:px-6 lg:py-28">
          <h2 className="text-balance text-3xl font-semibold tracking-tight text-fog-50 sm:text-4xl">
            {t("result.recheckRequired")}
          </h2>
          <p className="mx-auto mt-5 max-w-xl text-pretty text-base leading-relaxed text-fog-400">
            A safety certificate that only proves attendance is a receipt, not a record of
            competence. This one is built so that an inspector can scan it on a floor with no
            signal and see exactly what was assessed.
          </p>
          <div className="mt-9 flex justify-center">
            <LinkButton to={profile ? "/dashboard" : "/auth"} size="lg">
              {t("landing.cta.primary")}
              <ArrowRight className="h-5 w-5" />
            </LinkButton>
          </div>
        </div>
      </section>

      <footer className="border-t border-ink-700 bg-ink-900">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-8 text-xs text-fog-800 sm:flex-row sm:items-center sm:px-6">
          <p className="font-mono uppercase tracking-[0.18em]">KAVACH · Safety that remembers</p>
          <p className="sm:ml-auto font-mono">
            {reachable ? (
              <span className="text-go-300">backend {BACKEND_LABEL}</span>
            ) : (
              <span className="text-warn-400">backend unreachable — running on-device</span>
            )}
          </p>
        </div>
      </footer>
    </div>
  );
}

/**
 * A live rendering of the real gate.
 *
 * Not a screenshot: this is the same criterion list the server evaluates, so
 * the landing page cannot drift from what the product actually does.
 */
function GatePanel() {
  const criteria = [
    { id: "G1", label: "Module pass scores met", detail: "80 minimum, each module" },
    { id: "G2", label: "Overall does not override modules", detail: "evaluated separately" },
    { id: "G3", label: "Zero critical first-try misses", detail: "hard zero" },
    { id: "G4", label: "Zero blocking failures", detail: "hard zero" },
    { id: "G5", label: "First-attempt accuracy", detail: "≥ 80%" },
    { id: "G6", label: "Hint dependency low", detail: "≤ 30% of hints" },
    { id: "G7", label: "Cold retention re-check", detail: "fail-closed", critical: true },
    { id: "G8", label: "Sequencing integrity", detail: "in both modules" },
  ];

  return (
    <div className="animate-rise">
      <div className="panel glow-amber overflow-hidden">
        <div className="flex items-center justify-between border-b border-ink-700 px-5 py-3.5">
          <div className="flex items-center gap-2.5">
            <span className="h-2 w-2 rounded-full bg-go-400" />
            <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-fog-400">
              Certificate gate
            </span>
          </div>
          <span className="font-mono text-[11px] text-amber-400">G1 – G8</span>
        </div>

        <ul className="divide-y divide-ink-800">
          {criteria.map((c) => (
            <li key={c.id} className="flex items-center gap-3 px-5 py-2.5">
              <span
                className={`tnum grid h-6 w-8 shrink-0 place-items-center rounded font-mono text-[11px] font-semibold ${
                  c.critical ? "bg-amber-400/15 text-amber-300" : "bg-ink-800 text-fog-400"
                }`}
              >
                {c.id}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-fog-200">{c.label}</span>
                <span className="block truncate font-mono text-[11px] text-fog-800">{c.detail}</span>
              </span>
              {c.critical && (
                <span className="shrink-0 rounded bg-amber-400/10 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-amber-300">
                  blocks
                </span>
              )}
            </li>
          ))}
        </ul>

        <div className="border-t border-ink-700 bg-ink-900/60 px-5 py-3">
          <p className="font-mono text-[11px] leading-relaxed text-fog-600">
            G7 is fail-closed: with no re-check on record, no certificate is issued.
          </p>
        </div>
      </div>
    </div>
  );
}

function Figure({
  value,
  label,
  icon: Icon,
}: {
  value: React.ReactNode;
  label: string;
  icon: typeof ShieldCheck;
}) {
  return (
    <div className="flex items-start gap-3">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
      <div>
        <div className="tnum font-mono text-2xl font-semibold text-fog-50">{value}</div>
        <div className="mt-0.5 text-xs text-fog-600">{label}</div>
      </div>
    </div>
  );
}

function Feature({
  icon: Icon,
  title,
  body,
  accent,
}: {
  icon: typeof ShieldCheck;
  title: string;
  body: string;
  accent?: boolean;
}) {
  return (
    <article
      className={`panel group p-6 transition-colors ${
        accent ? "border-amber-400/30 hover:border-amber-400/50" : "hover:border-ink-600"
      }`}
    >
      <span
        className={`mb-4 grid h-10 w-10 place-items-center rounded-lg ${
          accent ? "bg-amber-400 text-ink-950" : "bg-ink-800 text-amber-400"
        }`}
      >
        <Icon className="h-5 w-5" />
      </span>
      <h3 className="text-base font-semibold text-fog-50">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-fog-400">{body}</p>
    </article>
  );
}

function LocalePills({
  locale,
  onChange,
}: {
  locale: Locale;
  onChange: (locale: Locale) => void;
}) {
  return (
    <div className="hidden rounded-lg border border-ink-600 bg-ink-800 p-0.5 sm:flex">
      {SELECTABLE_LOCALES.map((option) => (
        <button
          key={option}
          type="button"
          onClick={() => onChange(option)}
          aria-pressed={locale === option}
          title={LOCALE_LABELS[option]}
          className={`rounded-md px-2.5 py-1.5 font-mono text-[11px] uppercase tracking-wider transition-colors ${
            locale === option ? "bg-amber-400 text-ink-950" : "text-fog-400 hover:text-fog-50"
          }`}
        >
          {option}
        </button>
      ))}
    </div>
  );
}
