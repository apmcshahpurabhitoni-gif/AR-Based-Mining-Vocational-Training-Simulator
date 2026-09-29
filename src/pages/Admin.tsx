/**
 * Safety dashboard (supervisor / admin).
 *
 * The step failure heatmap is the only reason anyone buys this product after
 * the trainees do. A completion rate tells a safety manager nothing actionable;
 * "38% of your people reach for water on an energised electrical fire, and it
 * is the single thing standing between them and a certificate" tells them which
 * conversation to have on Monday.
 *
 * Every cell is recomputed from raw attempt rows on the server. Nothing here is
 * a stored aggregate, which means fixing a weighting bug is a recomputation
 * rather than a migration.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { clsx } from "clsx";
import {
  Award,
  BrainCircuit,
  Flame,
  RefreshCw,
  ShieldAlert,
  TriangleAlert,
  Users,
} from "lucide-react";
import { useSession, useT } from "../lib/session";
import { Button, Chip, EmptyState, Meter, Panel, SectionLabel } from "../components/ui";
import { fetchHeatmap, fetchRoster, bundledManifests } from "../lib/api";
import { MODULES } from "../lib/modules";
import type { Localised } from "../lib/types";

interface HeatmapCell {
  moduleCode: string;
  stepId: string;
  critical: boolean;
  kind: string;
  instruction: Localised;
  attempts: number;
  misses: number;
  trainees: number;
  wrongTrainees: number;
  failRate: number;
  firstTryMissRate: number;
  meanHintDependency: number;
  misconceptions: Array<{ tag: string; count: number }>;
}

interface HeatmapResponse {
  cells: HeatmapCell[];
  summary: {
    trainees: number;
    workers: number;
    supervisors: number;
    attempts: number;
    certificates: number;
    gatePassRate: number;
    recheckFailRate: number;
  };
}

interface RosterRow {
  id: string;
  name: string;
  workerCode: string | null;
  role: string;
  certified: boolean;
  certificateCode: string | null;
}

/** Misconception tags -> plain-language labels, mirrored from convex/admin.ts. */
const MISCONCEPTIONS: Record<string, Localised> = {
  water_on_electrical: {
    en: "Reaches for water on an electrical fire",
    hi: "बिजली की आग पर पानी लेता है",
  },
  wrong_fire_class: {
    en: "Confuses which extinguisher goes with which fire",
    hi: "गलत बुझावा चुनता है",
  },
  return_to_work_fire: {
    en: "Re-enters a fire zone without authority",
    hi: "बिना अनुमति आग की जगह लौटता है",
  },
  skip_accountability: {
    en: "Avoids the assembly point so nobody counts them",
    hi: "जमाव स्थल से बचता है",
  },
  no_gas_protection: {
    en: "Believes a dust mask protects against gas",
    hi: "मानता है कि डस्ट मास्क गैस से बचाता है",
  },
  underestimate_gas: {
    en: "Treats a small leak as harmless",
    hi: "छोटे रिसाव को हानिरहित मानता है",
  },
  hand_protection_only: {
    en: "Protects hands but not lungs",
    hi: "हाथ बचाता है, फेफड़े नहीं",
  },
  solo_entry: {
    en: "Would enter a confined space alone",
    hi: "बंद जगह में अकेले प्रवेश करेगा",
  },
  wrong_buddy_ratio: {
    en: "Thinks three people in is safer than two",
    hi: "तीन लोग अंदर सुरक्षित समझता है",
  },
  supervisor_in_space: {
    en: "Wants the supervisor inside the space too",
    hi: "सुपरवाइज़र को भी अंदर चाहता है",
  },
  surface_during_gas: {
    en: "Tries to reach the surface through the gas plume",
    hi: "गैस के रास्ते से सतह तक निकलने की कोशिश",
  },
  delay_rescue: {
    en: "Delays reporting for help",
    hi: "मदद की सूचना में देली करता है",
  },
};

export function Admin() {
  const t = useT();
  const { token, profile, locale } = useSession();
  const manifests = useMemo(() => bundledManifests(), []);

  const [data, setData] = useState<HeatmapResponse | null>(null);
  const [roster, setRoster] = useState<RosterRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!token) {
      setLoading(false);
      return;
    }
    const [heatmap, rosterResult] = await Promise.all([
      fetchHeatmap(token, manifests),
      fetchRoster(token),
    ]);

    if (heatmap.ok) setData(heatmap.value as unknown as HeatmapResponse);
    else setError(heatmap.error);

    if (rosterResult.ok) setRoster(rosterResult.value as unknown as RosterRow[]);
    setLoading(false);
  }, [token, manifests]);

  useEffect(() => {
    void load();
  }, [load]);

  // The heatmap is more than a list — it is a ranked list. Rank by how many
  // distinct trainees got the step wrong on the first try, because that is the
  // number a manager can act on.
  const ranked = useMemo(() => {
    if (!data) return [];
    return [...data.cells]
      .filter((c) => c.attempts > 0)
      .sort(
        (a, b) =>
          b.wrongTrainees - a.wrongTrainees ||
          b.failRate - a.failRate ||
          a.stepId.localeCompare(b.stepId),
      );
  }, [data]);

  const topMisconceptions = useMemo(() => {
    if (!data) return [];
    const totals = new Map<string, number>();
    for (const cell of data.cells) {
      for (const m of cell.misconceptions) {
        totals.set(m.tag, (totals.get(m.tag) ?? 0) + m.count);
      }
    }
    return [...totals.entries()]
      .map(([tag, count]) => ({ tag, count, label: MISCONCEPTIONS[tag] }))
      .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
      .slice(0, 6);
  }, [data]);

  if (profile && profile.role === "worker") {
    return (
      <EmptyState
        title="restricted"
        body="The safety dashboard is available to supervisors and administrators."
      />
    );
  }

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-amber-400">
            {profile?.orgName}
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-fog-50">
            {t("admin.title")}
          </h1>
          <p className="mt-2 max-w-xl text-sm text-fog-400">{t("admin.subtitle")}</p>
        </div>
        <Button variant="secondary" size="sm" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={loading ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
          Refresh
        </Button>
      </header>

      {error && (
        <Panel className="border-warn-400/30">
          <p className="flex items-center gap-2 text-sm text-warn-400">
            <TriangleAlert className="h-4 w-4" />
            {error}
          </p>
        </Panel>
      )}

      {!data && loading && (
        <div className="panel grid-bg-fine grid h-48 place-items-center">
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-fog-600">loading…</p>
        </div>
      )}

      {data && data.summary.attempts === 0 && (
        <EmptyState title={t("admin.noData")} body={<>Run a module on the trainee account and this fills in.</>} />
      )}

      {data && data.summary.attempts > 0 && (
        <>
          {/* -- Summary ------------------------------------------------- */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <SummaryTile
              icon={Users}
              label="Trainees"
              value={data.summary.trainees}
              detail={`${data.summary.workers} workers · ${data.summary.supervisors} supervisors`}
            />
            <SummaryTile
              icon={Award}
              label="Certificates held"
              value={data.summary.certificates}
              detail={`${Math.round(data.summary.gatePassRate * 100)}% of assessments cleared the gate`}
            />
            <SummaryTile
              icon={ShieldAlert}
              label="Re-check failures"
              value={`${Math.round(data.summary.recheckFailRate * 100)}%`}
              detail="trained well, did not retain"
              tone={data.summary.recheckFailRate > 0.2 ? "halt" : "neutral"}
            />
            <SummaryTile
              icon={BrainCircuit}
              label="Attempt rows"
              value={data.summary.attempts}
              detail="step-level, append-only"
            />
          </div>

          {/* -- Misconceptions ------------------------------------------ */}
          {topMisconceptions.length > 0 && (
            <section>
              <SectionLabel>{t("admin.misconceptions")}</SectionLabel>
              <Panel className="p-0">
                <ul className="divide-y divide-ink-800">
                  {topMisconceptions.map((m, i) => (
                    <li key={m.tag} className="flex items-center gap-4 px-5 py-3.5 sm:px-6">
                      <span
                        className={clsx(
                          "tnum grid h-7 w-7 shrink-0 place-items-center rounded font-mono text-xs font-bold",
                          i === 0 ? "bg-halt-400/15 text-halt-300" : "bg-ink-800 text-fog-400",
                        )}
                      >
                        {i + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-fog-100">
                          {m.label ? m.label[locale === "sat" ? "en" : locale] : m.tag}
                        </p>
                        <p className="font-mono text-[11px] text-fog-800">{m.tag}</p>
                      </div>
                      <span className="tnum shrink-0 font-mono text-lg font-semibold text-fog-50">
                        {m.count}
                      </span>
                    </li>
                  ))}
                </ul>
              </Panel>
            </section>
          )}

          {/* -- Heatmap -------------------------------------------------- */}
          <section>
            <SectionLabel>{t("admin.heatmap")}</SectionLabel>
            <Panel className="p-0">
              <div className="grid grid-cols-3 gap-px border-b border-ink-700 bg-ink-700 font-mono text-[10px] uppercase tracking-wider text-fog-800 sm:grid-cols-[2.2fr_1fr_1fr_1.4fr]">
                <span className="bg-ink-850 px-5 py-2.5">Step</span>
                <span className="bg-ink-850 px-3 py-2.5 text-right">{t("admin.failRate")}</span>
                <span className="hidden bg-ink-850 px-3 py-2.5 text-right sm:block">
                  {t("admin.firstTryMiss")}
                </span>
                <span className="bg-ink-850 px-5 py-2.5">Reading</span>
              </div>

              <ul className="divide-y divide-ink-800">
                {ranked.map((cell) => (
                  <HeatmapRow key={cell.stepId} cell={cell} locale={locale} />
                ))}
              </ul>
            </Panel>
          </section>

          {/* -- Roster ---------------------------------------------------- */}
          <section>
            <SectionLabel>{t("admin.roster")}</SectionLabel>
            <Panel className="p-0">
              <ul className="divide-y divide-ink-800">
                {roster.map((person) => (
                  <li key={person.id} className="flex items-center gap-4 px-5 py-3.5">
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-ink-800 font-mono text-xs font-semibold text-amber-300">
                      {person.name.slice(0, 2).toUpperCase()}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-fog-100">{person.name}</p>
                      <p className="font-mono text-[11px] text-fog-800">
                        {person.workerCode} · {person.role}
                      </p>
                    </div>
                    {person.certified ? (
                      <Chip tone="go">
                        <Award className="h-3 w-3" />
                        certified
                      </Chip>
                    ) : (
                      <Chip tone="neutral">not certified</Chip>
                    )}
                  </li>
                ))}
              </ul>
            </Panel>
          </section>
        </>
      )}
    </div>
  );
}

function HeatmapRow({
  cell,
  locale,
}: {
  cell: HeatmapCell;
  locale: "en" | "hi" | "sat";
}) {
  const key = locale === "sat" ? "en" : locale;
  // Colour is a gradient, never the only signal: every row also carries the
  // numeric rate and, for critical steps, an explicit label.
  const tone =
    cell.firstTryMissRate >= 0.34
      ? "halt"
      : cell.firstTryMissRate >= 0.15
        ? "warn"
        : "go";

  return (
    <li className="grid grid-cols-3 items-center gap-3 px-5 py-3.5 sm:grid-cols-[2.2fr_1fr_1fr_1.4fr]">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="tnum font-mono text-[11px] text-fog-800">{cell.stepId}</span>
          {cell.critical && (
            <span className="rounded bg-halt-400/15 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-halt-300">
              critical
            </span>
          )}
          <span className="font-mono text-[10px] uppercase tracking-wider text-fog-800">
            {cell.kind}
          </span>
        </div>
        <p className="mt-0.5 truncate text-sm text-fog-200">
          {cell.instruction[key] ?? cell.instruction.en}
        </p>
      </div>

      <div className="text-right">
        <span
          className={clsx(
            "tnum font-mono text-sm font-semibold",
            tone === "halt" ? "text-halt-300" : tone === "warn" ? "text-warn-400" : "text-go-300",
          )}
        >
          {Math.round(cell.failRate * 100)}%
        </span>
        <Meter
          value={cell.failRate}
          tone={tone === "halt" ? "halt" : tone === "warn" ? "warn" : "go"}
          className="mt-1.5"
        />
      </div>

      <div className="hidden text-right sm:block">
        <span className="tnum font-mono text-sm text-fog-200">
          {cell.wrongTrainees}/{cell.trainees}
        </span>
        <p className="font-mono text-[10px] text-fog-800">trainees</p>
      </div>

      <div className="hidden min-w-0 sm:block">
        {cell.misconceptions[0] ? (
          <>
            <p className="truncate text-xs text-fog-300">
              {MISCONCEPTIONS[cell.misconceptions[0].tag]?.[key] ??
                cell.misconceptions[0].tag.replace(/_/g, " ")}
            </p>
            <p className="font-mono text-[10px] text-fog-800">
              ×{cell.misconceptions[0].count} · hints {Math.round(cell.meanHintDependency * 100)}%
            </p>
          </>
        ) : (
          <p className="text-xs text-fog-800">—</p>
        )}
      </div>
    </li>
  );
}

function SummaryTile({
  icon: Icon,
  label,
  value,
  detail,
  tone = "neutral",
}: {
  icon: typeof Flame;
  label: string;
  value: string | number;
  detail: string;
  tone?: "neutral" | "halt";
}) {
  return (
    <Panel className="p-5">
      <div className="flex items-center gap-2.5">
        <Icon className="h-4 w-4 text-amber-400" />
        <p className="font-mono text-[11px] uppercase tracking-wider text-fog-600">{label}</p>
      </div>
      <p
        className={clsx(
          "tnum mt-2.5 font-mono text-3xl font-semibold",
          tone === "halt" ? "text-halt-300" : "text-fog-50",
        )}
      >
        {value}
      </p>
      <p className="mt-1 text-xs leading-snug text-fog-600">{detail}</p>
    </Panel>
  );
}
