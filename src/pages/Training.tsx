/**
 * The module runner.
 *
 * This screen is a thin shell over `runnerReduce`. It renders whatever step the
 * state machine says is current and dispatches taps back into it. No scoring
 * logic lives here — that is the whole reason the reducer is pure and tested.
 *
 * Three rendering modes ship (docs/05-ar-technical-spec.md §2/§3), plus the 3D
 * training room, which docs/11 §C makes the primary development surface:
 *
 *   L1 marker  — a printed marker found in the camera feed, with the object
 *                drawn on it. The production presentation path. Needs printed
 *                markers and a camera, so it is offered only on the steps whose
 *                objects actually have one.
 *   L2 reticle — a live camera feed behind the targets, tapped in view. Needs
 *                a camera and nothing else prepared.
 *   L3 guided  — no camera. Targets are laid out as labelled affordances.
 *
 * Every one of them falls back rather than failing: marker and reticle fall back
 * to guided on denial, absence, or error, so the demo cannot be blocked by a
 * permissions prompt or a missing sheet of printed markers.
 */

import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { clsx } from "clsx";
import {
  ArrowRight,
  Camera,
  CameraOff,
  Check,
  Eye,
  Hand,
  ScanLine,
  Lightbulb,
  RotateCcw,
  TriangleAlert,
  X,
} from "lucide-react";
import type { RoomObject } from "../lib/room";
import { objectsForStep } from "../lib/room";
import { SHIPPED_MODES, type ShippedARMode } from "../lib/ar";
import { hasARTarget } from "../lib/ar/targets";
import { distractorsFor, markerLabel } from "../lib/markers";

// Lazy so three.js is fetched only when a room is actually opened. The landing
// page, the dashboard and the re-check never pay for it.
const WalkRoom = lazy(() =>
  import("../components/Scene3D").then((m) => ({ default: m.Scene3D })),
);

// Lazy, and for a heavier reason than the room: MindAR pulls in TensorFlow.js
// and a detector model. A trainee on a metered phone who never opens the AR view
// must not download any of it.
const ARView = lazy(() =>
  import("../lib/ar/SceneAR").then((m) => ({ default: m.SceneAR })),
);
import { useSession, useT } from "../lib/session";
import { Button, Chip } from "../components/ui";
import {
  createRunnerState,
  currentRuntime,
  currentStep,
  hintsRemaining,
  nextHint,
  progress,
  runnerReduce,
  toStepRecords,
  type RunnerAction,
  type RunnerEnv,
  type RunnerState,
} from "../lib/runner";
import { type ARMode } from "../lib/ar";
import { requireModule } from "../lib/modules";
import { scoreModule } from "../lib/scoring";
import { deviceId, getLocalSession } from "../lib/db";
import { completeSession, startSession } from "../lib/api";
import { flushSession, openSession, recordEvent, rememberSession } from "../lib/sync";
import type {
  AttemptEvent,
  Localised,
  ModuleManifest,
  RecheckSample,
  Step,
} from "../lib/types";

/** First-attempt grades, as the re-check evaluator consumes them. */
export type RunOutcome = {
  stepId: string;
  moduleCode: string;
  critical: boolean;
  reason: string;
  outcome: "pass" | "fail";
};

export interface TrainingProps {
  /** Supplied directly by the re-check; otherwise read from the route. */
  manifest?: ModuleManifest;
  phase?: "training" | "recheck";
  /** Server-chosen sample, used only for the `reason` tag on re-check results. */
  sample?: RecheckSample[];
  /** Called once, with first-attempt grades, when the run completes. */
  onComplete?: (outcomes: RunOutcome[], events: AttemptEvent[]) => void;
}

export function Training({ manifest: manifestProp, phase = "training", sample, onComplete }: TrainingProps) {
  const { moduleCode = "FIRE" } = useParams();
  const { token, locale, backendReachable } = useSession();
  const t = useT();
  const navigate = useNavigate();

  const manifest = useMemo(
    () => manifestProp ?? requireModule(moduleCode),
    [manifestProp, moduleCode],
  );

  // -- Runner state -------------------------------------------------------
  const sessionIdRef = useRef(`local-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`);
  const envRef = useRef<RunnerEnv>({
    now: Date.now(),
    offline: typeof navigator !== "undefined" && !navigator.onLine,
    newEventId: () =>
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `e-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
  });

  const [state, setState] = useState<RunnerState>(() =>
    createRunnerState(manifest, {
      sessionId: sessionIdRef.current,
      locale,
      phase,
      arMode: "guided",
      now: Date.now(),
    }),
  );

  // Rebuild when the manifest shape changes (re-check narrows the step list).
  useEffect(() => {
    setState((prev) =>
      prev.moduleVersion === manifest.version && prev.moduleCode === manifest.code
        ? prev
        : createRunnerState(manifest, {
            sessionId: sessionIdRef.current,
            locale,
            phase,
            arMode: prev.arMode,
            now: Date.now(),
          }),
    );
  }, [manifest, locale, phase]);

  const step = currentStep(state, manifest);
  const runtime = currentRuntime(state, manifest);

  // -- Sync ---------------------------------------------------------------
  useEffect(() => {
    if (phase !== "training") return;
    void rememberSession({
      clientSessionId: sessionIdRef.current,
      moduleCode: manifest.code,
      moduleVersion: manifest.version,
      locale,
      startedAt: Date.now(),
      synced: false,
    });
    void openSession(token, manifest, sessionIdRef.current, locale, deviceId());
  }, [manifest, locale, phase, token]);

  // Persist every event the moment it is produced. Local first, always.
  const seenEvents = useRef(0);
  useEffect(() => {
    if (state.events.length === seenEvents.current) return;
    const fresh = state.events.slice(seenEvents.current);
    seenEvents.current = state.events.length;
    for (const event of fresh) void recordEvent(event);
  }, [state.events]);

  // -- Completion ---------------------------------------------------------
  const completedOnce = useRef(false);
  useEffect(() => {
    if (!state.complete || completedOnce.current) return;
    completedOnce.current = true;

    // First-attempt grades, in manifest order. The `reason` comes from the
    // server's sample so the recorded re-check can be audited against it.
    const outcomes: RunOutcome[] = manifest.steps.map((step) => {
      const fromSample = sample?.find((s) => s.stepId === step.id);
      return {
        stepId: step.id,
        moduleCode: step.moduleCode,
        critical: step.critical,
        reason: fromSample?.reason ?? "module-spread",
        outcome: state.outcomes[step.id] === true ? "pass" : "fail",
      };
    });
    onComplete?.(outcomes, state.events);

    void (async () => {
      const localScore = scoreModule(manifest, toStepRecords(state, manifest)).score;
      await rememberSession({
        clientSessionId: sessionIdRef.current,
        moduleCode: manifest.code,
        moduleVersion: manifest.version,
        locale,
        startedAt: Date.now(),
        completedAt: Date.now(),
        localScore,
        synced: false,
      });

      if (token) {
        const flushed = await flushSession(token, sessionIdRef.current, [manifest]);
        const local = await getLocalSession(sessionIdRef.current);
        if (local && flushed.lastSyncedAt) {
          const server = await startSession(token, {
            moduleCode: manifest.code,
            moduleVersion: manifest.version,
            locale,
            deviceId: deviceId(),
            clientSessionId: sessionIdRef.current,
          });
          if (server.ok) {
            await completeSession(token, {
              sessionId: server.value.sessionId,
              manifest,
            });
            await rememberSession({
              ...local,
              synced: true,
            });
          }
        }
      }

      if (phase === "training") navigate("/result", { replace: true });
    })();
    // `onComplete` drives the re-check flow; navigation is only for training.
  }, [state.complete, state, manifest, token, locale, phase, navigate, onComplete, sample]);

  const dispatch = useCallback(
    (action: RunnerAction) => {
      setState((prev) => runnerReduce(prev, action, envRef.current, manifest));
    },
    [manifest],
  );

  const setMode = useCallback(
    (mode: ARMode) => {
      setState((prev) => runnerReduce(prev, { type: "setArMode", mode }, envRef.current, manifest));
    },
    [manifest],
  );

  // -- Rendering ----------------------------------------------------------
  if (!step) {
    return (
      <div className="panel p-8 text-center">
        <p className="text-fog-400">This run has already finished.</p>
        <Button className="mt-4" onClick={() => navigate("/dashboard")}>
          {t("result.backToDashboard")}
        </Button>
      </div>
    );
  }

  const p = progress(state, manifest);
  const remaining = hintsRemaining(state, step);
  const hint = nextHint(state, manifest);
  // Same rule as `Interaction`: a resolved step stops accepting taps, so the
  // scene cannot be used to change an answer that has already been recorded.
  const locked = Boolean(currentRuntime(state, { steps: [step] } as ModuleManifest)?.resolved);

  // The 3D room is the current primary training surface — docs/11 §C and
  // docs/15 Phase 1/4. It is also a way out: on a shared or low-end handset
  // the 2D scene may simply be the more usable surface. It is lazily imported,
  // so nothing that does not open a room pays for three.js.
  const [walk3d, setWalk3d] = useState(true);

  /**
   * One dispatcher for every 3D-ish surface.
   *
   * The AR view and the 3D room both call this, and it is the only place either
   * of them touches the runner. They dispatch the same semantic actions the card
   * list dispatches, so `runner.ts`, `scoring.ts` and `gate.ts` cannot tell which
   * surface answered — docs/11 §2. Neither surface ever sees a score.
   */
  const handleSelect = useCallback(
    (id: string) => {
      if (step.kind === "decide") dispatch({ type: "choose", choiceId: id });
      else if (step.kind === "act") dispatch({ type: "perform", elementId: id });
      else dispatch({ type: "tapTarget", targetId: id });
    },
    [step.kind, dispatch],
  );

  /**
   * Whether L1 can present *this* step.
   *
   * Needs an `observe` step (a search task — decide and act steps compare and
   * order options on screen) and at least one object with a printed marker.
   */
  const arAvailable = useMemo(
    () => step.kind === "observe" && hasARTarget((step.targets ?? []).map((t) => t.id)),
    [step],
  );

  // Every step kind gets a room. docs/12 and docs/13 both require all six
  // steps of a module to be representable in the 3D training environment, so
  // this builds three different rooms out of the one manifest contract. The
  // rules live in lib/room.ts, where a test can prove the claim rather than a
  // browser being asked to.
  const walkObjects = useMemo<RoomObject[]>(
    () => objectsForStep(step, manifest.code, locale, runtime?.actionCursor ?? 0),
    [step, locale, manifest.code, runtime?.actionCursor],
  );

  // L1 is the production presentation path (docs/05 §3), so where it can run it
  // does, and the 3D room becomes the fallback rather than the default.
  const showAR = state.arMode === "marker" && arAvailable;

  return (
    <div className="space-y-6">
      {/* -- Header ------------------------------------------------------ */}
      <header className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Chip tone={phase === "recheck" ? "warn" : "amber"}>
              {phase === "recheck" ? t("recheck.title") : manifest.code}
            </Chip>
            {step.critical && <Chip tone="halt">{t("common.critical")}</Chip>}
          </div>
          <h1 className="mt-2 truncate text-xl font-semibold text-fog-50">
            {phase === "training" && (
              <span className="font-mono text-sm font-normal text-fog-600">
                {t("training.step")} {p.index}/{p.total}
              </span>
            )}
          </h1>
        </div>

        {/* The room is the default on observe steps, so it also has to be a way
            out: on a shared or low-end handset the 2D scene may simply be the
            more usable surface. */}
        {walkObjects.length > 0 && (
          <button
            type="button"
            onClick={() => setWalk3d((v) => !v)}
            aria-pressed={walk3d}
            className="rounded border border-ink-700 px-3 py-1.5 font-mono text-[11px] uppercase tracking-widest text-fog-400 transition-colors hover:border-amber-500 hover:text-amber-300"
          >
            {walk3d ? "2d scene" : "3d room"}
          </button>
        )}

        <ModeSwitch
          mode={state.arMode}
          onChange={setMode}
          // Offered only where it can actually work. Showing "marker" on a step
          // with nothing printed to track would be a button that opens onto a
          // camera looking for an object this step does not have.
          markerAvailable={arAvailable}
        />
      </header>

      {/* -- Progress ----------------------------------------------------- */}
      <div className="flex items-center gap-3">
        <div className="flex flex-1 gap-1" role="presentation">
          {manifest.steps.map((s, i) => {
            const done = state.outcomes[s.id] === true;
            const failed = state.outcomes[s.id] === false;
            const active = i === state.cursor;
            return (
              <span
                key={s.id}
                className={clsx(
                  "h-1.5 flex-1 rounded-full transition-colors",
                  done
                    ? "bg-go-400"
                    : failed
                      ? "bg-halt-400"
                      : active
                        ? "bg-amber-400"
                        : "bg-ink-700",
                )}
              />
            );
          })}
        </div>
        {runtime && runtime.attemptIndex > 0 && (
          <Chip tone="warn">
            <RotateCcw className="h-3 w-3" />
            attempt {runtime.attemptIndex + 1}
          </Chip>
        )}
      </div>

      {/*
       * A step awaiting the qualified safety reviewer replaces the whole
       * training surface — scene, options, hints, everything.
       *
       * Not a disabled version of the normal screen. There is no answer to
       * give, so nothing is rendered that could be tapped, and because the step
       * can never be resolved the runner never advances past it and the module
       * can never be completed. A trainee who reaches this sees the reason in
       * their own language instead of a screen that quietly accepts anything.
       */}
      {step.pendingSafetyReview ? (
        <div className="panel border-warn-400/40 p-8 text-center">
          <p className="mx-auto flex w-fit items-center gap-2 font-mono text-[11px] uppercase tracking-widest text-warn-400">
            <TriangleAlert className="h-4 w-4" />
            {t("training.pendingReview.title")}
          </p>
          <p className="mx-auto mt-4 max-w-2xl text-lg leading-snug text-fog-100">
            {localise(step.instruction, locale)}
          </p>
          <p className="mx-auto mt-4 max-w-2xl text-sm leading-relaxed text-fog-400">
            {t("training.pendingReview.body")}
          </p>
          <p className="mt-6 font-mono text-[11px] uppercase tracking-wider text-fog-700">
            {t("training.pendingReview.hold")}
          </p>
        </div>
      ) : (
        <>
      {/* -- Scene ------------------------------------------------------- */}
      <div className="panel overflow-hidden">
        {showAR ? (
          <div className="relative h-[62vh] min-h-[24rem] max-h-[46rem]">
            <Suspense
              fallback={
                <div className="grid h-full place-items-center font-mono text-[11px] uppercase tracking-widest text-fog-700">
                  starting camera
                </div>
              }
            >
              <ARView
                objects={walkObjects}
                selectedId={runtime?.satisfiedTargets?.[0] ?? null}
                onSelect={handleSelect}
                // Camera refused or tracking could not start. The reticle is the
                // nearest thing that still uses the camera; from there the
                // existing fallback chain reaches the 3D room and the 2D scene.
                onFallback={() => setMode("reticle")}
              />
            </Suspense>
          </div>
        ) : walk3d ? (
          <div className="relative h-[62vh] min-h-[24rem] max-h-[46rem]">
            <Suspense
              fallback={
                <div className="grid h-full place-items-center font-mono text-[11px] uppercase tracking-widest text-fog-700">
                  loading 3d room
                </div>
              }
            >
              <WalkRoom
                objects={walkObjects}
                selectedId={runtime?.satisfiedTargets?.[0] ?? null}
                onSelect={handleSelect}
                onFallback={() => setWalk3d(false)}
              />
            </Suspense>
          </div>
        ) : (
          <Scene
            step={step}
            locale={locale}
            // The 2D surface has no marker mode. If marker was selected but this
            // step has nothing printed to track, the reticle is the camera
            // presentation that still works here.
            arMode={state.arMode === "marker" ? "reticle" : state.arMode}
            locked={locked}
            onDispatch={dispatch}
            onFallback={() => setMode("guided")}
          />
        )}

        <div className="border-t border-ink-700 p-5 sm:p-6">
          <p className="text-lg font-medium leading-snug text-fog-50">
            {localise(step.instruction, locale)}
          </p>
          <p className="mt-1.5 font-mono text-[11px] uppercase tracking-wider text-fog-800">
            {step.kind === "observe"
              ? t("training.tapTarget")
              : step.kind === "decide"
                ? t("training.chooseOne")
                : t("training.tapInOrder")}
          </p>
        </div>
      </div>

      {/* -- Interaction -------------------------------------------------- */}
      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="space-y-4">
          <Interaction
            step={step}
            state={state}
            locale={locale}
            moduleCode={manifest.code}
            onDispatch={dispatch}
          />
        </div>

        <aside className="space-y-4">
          {phase === "training" && (
            <div className="panel p-5">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-wider text-fog-600">
                  <Lightbulb className="h-3.5 w-3.5" />
                  {t("training.hint")}
                </span>
                <span className="font-mono text-[11px] text-fog-800">
                  {remaining > 0 ? `${remaining} ${t("training.hintsLeft")}` : t("training.noHints")}
                </span>
              </div>

              {hint ? (
                <p className="mt-3 text-sm leading-relaxed text-amber-200">{hint}</p>
              ) : (
                <p className="mt-3 text-sm text-fog-800">
                  Hints are logged. Using them lowers your certification score.
                </p>
              )}

              <Button
                variant="secondary"
                size="sm"
                className="mt-4 w-full"
                disabled={!hint || runtime?.resolved}
                onClick={() => dispatch({ type: "hint" })}
              >
                <Lightbulb className="h-4 w-4" />
                {t("training.hint")}
              </Button>
            </div>
          )}

          {phase === "recheck" && (
            <div className="panel border-warn-400/30 p-5">
              <p className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-wider text-warn-400">
                <TriangleAlert className="h-3.5 w-3.5" />
                one attempt each
              </p>
              <p className="mt-3 text-sm leading-relaxed text-fog-400">
                {t("recheck.subtitle")}
              </p>
            </div>
          )}

          {!backendReachable && (
            <div className="panel border-warn-400/30 p-5">
              <p className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-wider text-warn-400">
                <CameraOff className="h-3.5 w-3.5" />
                offline
              </p>
              <p className="mt-2 text-sm text-fog-400">{t("training.queueSaved")}</p>
            </div>
          )}
        </aside>
      </div>
        </>
      )}

      {/* -- Feedback ---------------------------------------------------- */}
      {runtime?.resolved && <Feedback runtime={runtime} step={step} onContinue={() => dispatch({ type: "continue" })} t={t} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Scene: the camera feed behind the targets
// ---------------------------------------------------------------------------

function Scene({
  step,
  locale,
  arMode,
  locked,
  onDispatch,
  onFallback,
}: {
  step: Step;
  locale: "en" | "hi" | "sat";
  arMode: "reticle" | "guided";
  locked: boolean;
  onDispatch: (action: RunnerAction) => void;
  onFallback: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [cameraState, setCameraState] = useState<"idle" | "live" | "failed">("idle");

  useEffect(() => {
    if (arMode !== "reticle") {
      setCameraState("idle");
      return;
    }
    let cancelled = false;
    let stream: MediaStream | null = null;

    void (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => undefined);
        }
        setCameraState("live");
      } catch {
        // Denied, absent, or in use. Guided mode needs nothing, so falling
        // back is always better than showing a dead frame.
        if (!cancelled) {
          setCameraState("failed");
          onFallback();
        }
      }
    })();

    return () => {
      cancelled = true;
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [arMode, onFallback]);

  if (step.kind === "decide") {
    return (
      <div className="grid-bg-fine relative grid h-44 place-items-center sm:h-56">
        <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-fog-800">
          decision point
        </span>
      </div>
    );
  }

  return (
    <div className="relative h-56 overflow-hidden bg-ink-950 sm:h-72">
      {arMode === "reticle" && cameraState !== "failed" && (
        <video
          ref={videoRef}
          playsInline
          muted
          className="absolute inset-0 h-full w-full object-cover opacity-45 grayscale"
        />
      )}

      {/* Reticle reticles / guided hotspots, at the coordinates the manifest
          declares. Content authors place these; the runner never guesses.

          These are the real tap targets, not decoration. A trainee is looking
          at this box and reaching for the thing in it, so the thing in it has
          to answer — otherwise the cards below look like the only way in and
          the scene reads as decoration the app forgot to wire up. */}
      <div className="absolute inset-0">
        {(step.targets ?? []).map((target) => (
          <TargetMarker
            key={target.id}
            x={target.position.x}
            y={target.position.y}
            label={localise(target.label, locale)}
            mode={arMode}
            locked={locked}
            onTap={() => onDispatch({ type: "tapTarget", targetId: target.id })}
          />
        ))}
      </div>

      {arMode === "guided" && (
        <div className="absolute bottom-3 left-3 flex items-center gap-1.5 rounded-md bg-ink-950/80 px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-fog-600">
          <Hand className="h-3 w-3" />
          guided · no camera
        </div>
      )}
    </div>
  );
}

function TargetMarker({
  x,
  y,
  label,
  mode,
  locked,
  onTap,
}: {
  x: number;
  y: number;
  label: string;
  mode: "reticle" | "guided";
  locked: boolean;
  onTap: () => void;
}) {
  return (
    <button
      type="button"
      disabled={locked}
      onClick={onTap}
      aria-label={label}
      className={clsx(
        // `group` so the ring swells when the pointer is anywhere on the
        // marker, label included — the whole thing is the hit area.
        "group absolute -translate-x-1/2 -translate-y-1/2 text-center",
        locked ? "cursor-not-allowed opacity-50" : "cursor-pointer",
      )}
      style={{ left: `${x * 100}%`, top: `${y * 100}%` }}
    >
      <span className="relative inline-block">
        {mode === "reticle" && (
          <span className="absolute -inset-3 rounded-full border border-amber-400/40 animate-sweep" />
        )}
        <span
          className={clsx(
            "grid place-items-center rounded-full border-2 font-mono text-[10px] font-bold transition-transform",
            mode === "reticle"
              ? "h-10 w-10 border-amber-400 bg-amber-400/20 text-amber-200"
              : "h-8 w-8 border-fog-500 bg-ink-800 text-fog-300",
            !locked && "group-hover:scale-110 active:scale-95",
          )}
        >
          {mode === "reticle" ? "◎" : "·"}
        </span>
      </span>
      <span
        className={clsx(
          "mt-2 block max-w-[10rem] truncate text-xs",
          locked ? "text-fog-600" : "text-fog-300 underline decoration-dotted underline-offset-4",
        )}
      >
        {label}
      </span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Interaction surfaces, one per step kind
// ---------------------------------------------------------------------------

function Interaction({
  step,
  state,
  locale,
  moduleCode,
  onDispatch,
}: {
  step: Step;
  state: RunnerState;
  locale: "en" | "hi" | "sat";
  moduleCode: string;
  onDispatch: (action: RunnerAction) => void;
}) {
  const locked = Boolean(currentRuntime(state, { steps: [step] } as ModuleManifest)?.resolved);

  if (step.kind === "decide") {
    return (
      <div className="grid gap-3 sm:grid-cols-2">
        {(step.choices ?? []).map((choice) => (
          <button
            key={choice.id}
            type="button"
            disabled={locked}
            onClick={() => onDispatch({ type: "choose", choiceId: choice.id })}
            className={clsx(
              "panel group flex min-h-24 flex-col items-start justify-between p-5 text-left transition-all",
              locked
                ? "cursor-not-allowed opacity-50"
                : "hover:border-amber-400/50 hover:bg-ink-800 active:scale-[0.99]",
            )}
          >
            <span className="text-base font-medium leading-snug text-fog-50">
              {localise(choice.label, locale)}
            </span>
            <span className="mt-3 font-mono text-[10px] uppercase tracking-wider text-fog-800">
              {choice.id}
            </span>
          </button>
        ))}
      </div>
    );
  }

  if (step.kind === "observe") {
    return (
      <div className="grid gap-3 sm:grid-cols-2">
        {(step.targets ?? []).map((target) => (
          <button
            key={target.id}
            type="button"
            disabled={locked}
            onClick={() => onDispatch({ type: "tapTarget", targetId: target.id })}
            className={clsx(
              "panel flex items-center gap-3 p-5 text-left transition-all",
              locked
                ? "cursor-not-allowed opacity-50"
                : "hover:border-amber-400/50 hover:bg-ink-800",
            )}
          >
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-ink-800 text-amber-400">
              <Eye className="h-4 w-4" />
            </span>
            <span>
              <span className="block text-sm font-medium text-fog-50">
                {localise(target.label, locale)}
              </span>
              <span className="block font-mono text-[10px] uppercase tracking-wider text-fog-800">
                {target.id}
              </span>
            </span>
          </button>
        ))}
        {/* Distractors. Tapping one is a graded miss, exactly like picking the
            wrong extinguisher — the consequence teaches, the attempt records.
            Same-module only: a gas room that offered a fire hose reel would
            grade a gas consequence against an object from the wrong module. */}
        {distractorsFor(
          moduleCode,
          (step.targets ?? []).map((tg) => tg.id),
        ).map(
          (d) => (
            <button
              key={d}
              type="button"
              disabled={locked}
              onClick={() => onDispatch({ type: "tapTarget", targetId: d })}
              className={clsx(
                "panel flex items-center gap-3 border-dashed p-5 text-left transition-all",
                locked ? "cursor-not-allowed opacity-40" : "hover:border-halt-400/40 hover:bg-ink-800",
              )}
            >
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-ink-800 text-fog-600">
                <X className="h-4 w-4" />
              </span>
              <span>
                <span className="block text-sm text-fog-400">{d}</span>
                <span className="block font-mono text-[10px] uppercase tracking-wider text-fog-800">
                  not this one
                </span>
              </span>
            </button>
          ),
        )}
      </div>
    );
  }

  const elements = step.action?.elements ?? [];
  const done = currentRuntime(state, { steps: [step] } as ModuleManifest)?.actionCursor ?? 0;

  return (
    <div>
      <ol className="grid gap-2 sm:grid-cols-2">
        {elements.map((element, index) => {
          const reached = index < done;
          const next = index === done;
          return (
            <li key={element}>
              <button
                type="button"
                disabled={locked || !next}
                onClick={() => onDispatch({ type: "perform", elementId: element })}
                className={clsx(
                  "panel flex w-full items-center gap-3 p-4 text-left transition-all",
                  reached && "border-go-400/40 bg-go-400/5",
                  next && !locked && "border-amber-400/50 hover:bg-ink-800",
                  (!next || locked) && !reached && "cursor-not-allowed opacity-45",
                )}
              >
                <span
                  className={clsx(
                    "tnum grid h-7 w-7 shrink-0 place-items-center rounded-full font-mono text-xs font-bold",
                    reached ? "bg-go-400 text-ink-950" : "bg-ink-800 text-fog-400",
                  )}
                >
                  {reached ? <Check className="h-4 w-4" /> : index + 1}
                </span>
                <span className="text-sm font-medium text-fog-100">{element}</span>
              </button>
            </li>
          );
        })}
      </ol>
      <p className="mt-3 font-mono text-[11px] text-fog-800">
        Order matters. An out-of-sequence action fails the attempt and is recorded
        against sequencing integrity.
      </p>
    </div>
  );
}

/**
 * The marker vocabulary, from docs/05 §3. These are the only object ids this
 * project has ever committed to, and each belongs to one module.
 *
 * The set they replaced (`fire-hose-reel`, `switchboard`, `dust-extractor`,
 * `conveyor-drive`) appeared nowhere in any manifest, in any doc, or in any
 * spec — it existed only in this file, and every one of those ids was wired
 * straight into the grading path, so a miss recorded a real safety consequence
 * against an object that does not exist in the module being trained.
 */


// ---------------------------------------------------------------------------
// Feedback
// ---------------------------------------------------------------------------

function Feedback({
  runtime,
  step,
  onContinue,
  t,
}: {
  runtime: NonNullable<ReturnType<typeof currentRuntime>>;
  step: Step;
  onContinue: () => void;
  t: (key: Parameters<typeof import("../lib/i18n").ui>[0]) => string;
}) {
  const passed = runtime.passed;
  const blocking = !passed && step.failure.blocksCertificate;

  return (
    <div
      className={clsx(
        "animate-rise panel overflow-hidden",
        passed ? "border-go-400/40" : blocking ? "border-halt-400/50" : "border-warn-400/40",
      )}
      role="status"
      aria-live="polite"
    >
      {blocking && <div className="hazard-tape h-1 w-full opacity-80" aria-hidden="true" />}

      <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-start sm:justify-between sm:p-6">
        <div className="flex gap-3.5">
          <span
            className={clsx(
              "mt-0.5 grid h-10 w-10 shrink-0 place-items-center rounded-lg",
              passed ? "bg-go-400/15 text-go-300" : "bg-halt-400/15 text-halt-300",
            )}
          >
            {passed ? <Check className="h-5 w-5" strokeWidth={2.6} /> : <TriangleAlert className="h-5 w-5" />}
          </span>
          <div className="min-w-0">
            <p
              className={clsx(
                "font-mono text-[11px] uppercase tracking-[0.18em]",
                passed ? "text-go-300" : "text-halt-300",
              )}
            >
              {passed ? t("training.pass") : t("training.fail")}
              {step.critical && !passed && ` · ${t("common.critical")}`}
            </p>
            <p className="mt-1.5 text-pretty text-sm leading-relaxed text-fog-200">
              {runtime.feedback}
            </p>
            {blocking && (
              <p className="mt-2.5 flex items-center gap-2 text-xs text-halt-300">
                <TriangleAlert className="h-3.5 w-3.5" />
                This failure blocks certification regardless of your overall score.
              </p>
            )}
          </div>
        </div>

        <Button onClick={onContinue} className="shrink-0 sm:ml-6">
          {passed || !step.failure.requiresRetry ? t("common.continue") : t("common.retry")}
          <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function localise(value: Localised, locale: "en" | "hi" | "sat"): string {
  if (locale === "sat") return value.sat ?? value.en;
  return value[locale] || value.en;
}

/**
 * The AR-mode feature flag, surfaced.
 *
 * Read from `SHIPPED_MODES` rather than a literal list, so this control cannot
 * offer a level the build does not implement — dropping `"marker"` from that
 * array removes the button, with no change here.
 */
function ModeSwitch({
  mode,
  onChange,
  markerAvailable,
}: {
  mode: ShippedARMode;
  onChange: (mode: ARMode) => void;
  markerAvailable: boolean;
}) {
  const t = useT();
  return (
    <div className="flex rounded-lg border border-ink-600 bg-ink-800 p-0.5">
      {SHIPPED_MODES.map((option) => {
        const disabled = option === "marker" && !markerAvailable;
        const label =
          option === "marker"
            ? t("training.modeMarker")
            : option === "reticle"
              ? t("training.modeReticle")
              : t("training.modeGuided");
        return (
          <button
            key={option}
            type="button"
            disabled={disabled}
            onClick={() => onChange(option)}
            aria-pressed={mode === option}
            title={disabled ? "No printed marker for this step" : label}
            className={clsx(
              "flex items-center gap-1.5 rounded-md px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider transition-colors",
              disabled
                ? "cursor-not-allowed text-fog-800"
                : mode === option
                  ? "bg-amber-400 text-ink-950"
                  : "text-fog-400 hover:text-fog-50",
            )}
          >
            {option === "marker" ? (
              <ScanLine className="h-3.5 w-3.5" />
            ) : option === "reticle" ? (
              <Camera className="h-3.5 w-3.5" />
            ) : (
              <Hand className="h-3.5 w-3.5" />
            )}
            {option}
          </button>
        );
      })}
    </div>
  );
}

function RecheckBooting() {
  return (
    <div className="panel grid-bg-fine grid h-64 place-items-center">
      <p className="font-mono text-xs uppercase tracking-[0.2em] text-fog-600">
        selecting your sample…
      </p>
    </div>
  );
}

export { RecheckBooting };
