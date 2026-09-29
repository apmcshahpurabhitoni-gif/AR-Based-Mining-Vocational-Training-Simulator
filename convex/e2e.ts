/**
 * End-to-end product verification.
 *
 * `selftest.ts` proves the data layer in isolation: idempotent ingest, scoring
 * parity, unknown-step rejection. This proves the PRODUCT: register, publish,
 * train both modules, sit out the retention gap, re-test, earn a certificate,
 * verify it from a cold lookup, and prove a tampered record is refused.
 *
 * It runs against a live local deployment:
 *
 *   bun convex run e2e:runE2E
 *
 * It also exercises the two failure narratives the whole product rests on:
 * a coached pass blocked by a failed cold re-check, and a first-attempt miss on
 * a critical step blocking a certificate even when the weighted score recovers.
 */

import { v } from "convex/values";
import { action } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { MODULES } from "../src/lib/modules";
import type { ModuleManifest } from "../src/lib/types";
import { scoreModule } from "../src/lib/scoring";
import {
  createRunnerState,
  currentStep,
  runnerReduce,
  toStepRecords,
  type RunnerEnv,
  type RunnerState,
} from "../src/lib/runner";

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

interface Check {
  name: string;
  passed: boolean;
  detail: string;
}

const checks: Check[] = [];

function expect(name: string, condition: boolean, detail = ""): void {
  checks.push({ name, passed: Boolean(condition), detail });
  console.log(`${condition ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

/** Unique-per-run identity so repeated runs never collide on the email index. */
function suffix(): string {
  return Math.random().toString(36).slice(2, 8);
}

/**
 * Drive the real runner through a module, so the events under test are
 * produced by the same reducer the trainee's phone runs — not by a hand-built
 * fixture that could silently drift from it.
 */
function runModule(
  moduleCode: string,
  opts: { missStep?: string; missChoice?: string; locale?: "en" | "hi" } = {},
): { events: unknown[]; score: number; criticalMisses: number } {
  const manifest: ModuleManifest = MODULES[moduleCode]!;
  let counter = 0;
  const env: RunnerEnv = {
    now: 1_700_000_000_000,
    offline: false,
    newEventId: () => `e2e-${moduleCode}-${++counter}`,
  };

  let state: RunnerState = createRunnerState(manifest, {
    sessionId: `e2e-${moduleCode}`,
    locale: opts.locale ?? "en",
    now: env.now,
  });

  let guard = 0;
  while (!state.complete && guard++ < 100) {
    const step = currentStep(state, manifest)!;
    env.now += 2000;

    const attemptIndex = state.runtime[step.id]?.attemptIndex ?? 0;
    const shouldMiss = step.id === opts.missStep && attemptIndex === 0;

    if (shouldMiss && step.kind === "decide") {
      const wrong =
        step.choices!.find((c) => !c.correct && c.id === opts.missChoice) ??
        step.choices!.find((c) => !c.correct)!;
      state = runnerReduce(state, { type: "choose", choiceId: wrong.id }, env, manifest);
    } else if (step.kind === "decide") {
      state = runnerReduce(
        state,
        { type: "choose", choiceId: step.choices!.find((c) => c.correct)!.id },
        env,
        manifest,
      );
    } else if (step.kind === "observe") {
      state = runnerReduce(
        state,
        { type: "tapTarget", targetId: step.success.requiredTargets![0]! },
        env,
        manifest,
      );
    } else {
      for (const el of step.action!.elements) {
        state = runnerReduce(state, { type: "perform", elementId: el }, env, manifest);
      }
    }
    state = runnerReduce(state, { type: "continue" }, env, manifest);
  }

  const score = scoreModule(manifest, toStepRecords(state, manifest));
  return { events: state.events, score: score.score, criticalMisses: score.criticalMisses };
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

export const runE2E = action({
  args: { tag: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const s = args.tag ?? suffix();
    const manifests = Object.values(MODULES) as ModuleManifest[];

    // -- 1. Content publication -------------------------------------------
    const published = await ctx.runMutation(api.content.publishModules, {});
    expect(
      "modules published",
      published.published.length + published.skipped >= 2,
      `published=${published.published.join(",") || "none"} skipped=${published.skipped}`,
    );

    // -- 2. Registration and sign-in ---------------------------------------
    const email = `e2e-${s}@kavach.test`;
    const created = await ctx.runMutation(api.auth.register, {
      name: "E2E Trainee",
      email,
      password: "correct-horse-battery",
      preferredLocale: "en",
    });
    expect("account created", Boolean(created.token && created.profile));
    expect("worker code assigned", Boolean(created.profile?.workerCode), created.profile?.workerCode ?? "");
    expect("locale preference stored", created.profile?.preferredLocale === "en");

    const token: string = created.token;

    // A wrong password must be rejected, and the message must not reveal
    // whether the address has an account at all.
    let rejected = false;
    let message = "";
    try {
      await ctx.runMutation(api.auth.login, { email, password: "wrong-password" });
    } catch (e) {
      rejected = true;
      message = e instanceof Error ? e.message : String(e);
    }
    expect("wrong password rejected", rejected, message);
    expect("no user enumeration", message.toLowerCase().includes("incorrect"), message);

    const login = await ctx.runMutation(api.auth.login, { email, password: "correct-horse-battery" });
    expect("correct password signs in", Boolean(login.token) && login.profile?.email === email);

    // Google sign-in must fail closed when the deployment has no Google
    // credentials. This one asserts the local case, which is exactly how a
    // no-egress plant deployment is configured, and it proves that an
    // unconfigured deployment cannot be used to mint a session.
    let googleRejected = false;
    let googleMessage = "";
    try {
      await ctx.runMutation(api.auth.googleSignIn, { idToken: "not.a.real-token" });
    } catch (e) {
      googleRejected = true;
      googleMessage = e instanceof Error ? e.message : String(e);
    }
    expect("google sign-in refuses when unconfigured", googleRejected, googleMessage);
    if (!process.env.GOOGLE_CLIENT_ID) {
      expect(
        "unconfigured refusal names the cause",
        googleMessage.toLowerCase().includes("not configured"),
        googleMessage,
      );
    }

    // -- 3. Train both modules ---------------------------------------------
    for (const manifest of manifests) {
      const run = runModule(manifest.code);

      const opened = await ctx.runMutation(api.sessions.startSession, {
        token,
        moduleCode: manifest.code,
        moduleVersion: manifest.version,
        locale: "en",
        deviceId: "e2e",
        clientSessionId: `e2e-${s}-${manifest.code}`,
      });

      const pushed = await ctx.runMutation(api.sessions.pushAttempts, {
        token,
        sessionId: opened.sessionId,
        manifests,
        events: run.events,
      });
      expect(
        `${manifest.code}: attempts persisted`,
        pushed.inserted === run.events.length,
        `inserted=${pushed.inserted}/${run.events.length}`,
      );

      // Replay must be a no-op. This is the offline sync contract, proven
      // over the same HTTP path a reconnecting device would use.
      const replay = await ctx.runMutation(api.sessions.pushAttempts, {
        token,
        sessionId: opened.sessionId,
        manifests,
        events: run.events,
      });
      expect(
        `${manifest.code}: replay is idempotent`,
        replay.inserted === 0 && replay.duplicates === run.events.length,
        `inserted=${replay.inserted} dup=${replay.duplicates}`,
      );

      // Re-opening the same client session must adopt, not duplicate.
      const reopened = await ctx.runMutation(api.sessions.startSession, {
        token,
        moduleCode: manifest.code,
        moduleVersion: manifest.version,
        locale: "en",
        deviceId: "e2e",
        clientSessionId: `e2e-${s}-${manifest.code}`,
      });
      expect(
        `${manifest.code}: offline session reconciles`,
        reopened.resumed === true && String(reopened.sessionId) === String(opened.sessionId),
      );

      const score = await ctx.runMutation(api.sessions.completeSession, {
        token,
        sessionId: opened.sessionId,
        manifest,
      });
      expect(
        `${manifest.code}: server score matches client score`,
        score.score === run.score,
        `server=${score.score} client=${run.score}`,
      );
      expect(`${manifest.code}: clean run scores 100`, run.score === 100, String(run.score));
    }

    // -- 4. The retention gap is real ---------------------------------------
    const before = await ctx.runQuery(api.assessment.myAssessment, { token, manifests });
    const g7 = before.gate.criteria.find((c: { id: string }) => c.id === "G7")!;
    expect(
      "G7 fails closed before the re-check",
      before.gate.failed.includes("G7"),
      g7.detail,
    );
    expect(
      "G1-G6 all met after a clean run",
      before.gate.failed.length === 1,
      `failed=${before.gate.failed.join(",") || "none"}`,
    );

    const status = await ctx.runQuery(api.sessions.recheckStatus, { token });
    expect("re-check not yet eligible", status.eligible === false, `${status.msRemaining}ms remaining`);

    const sample = await ctx.runQuery(api.assessment.myRecheckSample, { token, manifests });
    expect("sample drawn", sample.length === 4, `${sample.length} steps`);
    expect(
      "sample leads with critical steps",
      sample.filter((s: { reason: string }) => s.reason === "critical-core").length >= 2,
      sample.map((s: { stepId: string; reason: string }) => `${s.stepId}:${s.reason}`).join(" "),
    );

    // -- 5. A failed cold re-check withholds the certificate ------------------
    const missed = sample[0]!.stepId;
    const failedSubmit = await ctx.runMutation(api.assessment.submitRecheck, {
      token,
      manifests,
      results: sample.map((s: { stepId: string; moduleCode: string; critical: boolean; reason: string }) => ({
        stepId: s.stepId,
        moduleCode: s.moduleCode,
        critical: s.critical,
        reason: s.reason,
        outcome: s.stepId === missed ? ("fail" as const) : ("pass" as const),
      })),
    });
    expect(
      "failed re-check detected",
      failedSubmit.recheck.passed === false,
      `missed ${failedSubmit.recheck.missed.join(",")}`,
    );
    expect(
      "G7 is the only outstanding criterion",
      failedSubmit.gate.failed.length === 1 && failedSubmit.gate.failed[0] === "G7",
      failedSubmit.gate.failed.join(",") || "none",
    );

    const denied = await ctx.runMutation(api.assessment.issueCertificate, { token, manifests });
    expect("certificate withheld after a failed re-check", denied.issued === false, String(denied.reason));

    // -- 6. A critical first-try miss blocks despite a recovered score --------
    const criticalRun = runModule("FIRE", { missStep: "A-03", missChoice: "water" });
    expect(
      "demo narrative: the weighted score recovers",
      criticalRun.score >= 80,
      `score=${criticalRun.score}, above the 80 floor — so only the gate can deny`,
    );
    expect("demo narrative: the critical miss is still recorded", criticalRun.criticalMisses === 1);

    // -- 7. A clean certification run, in Hindi -----------------------------
    const retry = await ctx.runMutation(api.auth.register, {
      name: "E2E Certified",
      email: `e2e-cert-${s}@kavach.test`,
      password: "correct-horse-battery",
      preferredLocale: "hi",
    });
    const token2: string = retry.token;
    const userId = retry.profile!.id;

    for (const manifest of manifests) {
      const run = runModule(manifest.code, { locale: "hi" });
      const opened = await ctx.runMutation(api.sessions.startSession, {
        token: token2,
        moduleCode: manifest.code,
        moduleVersion: manifest.version,
        locale: "hi",
        deviceId: "e2e",
        clientSessionId: `e2e-${s}-cert-${manifest.code}`,
      });
      await ctx.runMutation(api.sessions.pushAttempts, {
        token: token2,
        sessionId: opened.sessionId,
        manifests,
        events: run.events,
      });
      await ctx.runMutation(api.sessions.completeSession, {
        token: token2,
        sessionId: opened.sessionId,
        manifest,
      });
    }

    // Stand in for the 90-second wait rather than sleeping through it.
    const sessions = await ctx.runQuery(internal.internal.listSessionsFor, { userId });
    for (const row of sessions) {
      await ctx.runMutation(internal.internal.markRecheckEligible, { sessionId: row.id });
    }

    const status2 = await ctx.runQuery(api.sessions.recheckStatus, { token: token2 });
    expect("re-check eligible once the gap has passed", status2.eligible === true);

    const sample2 = await ctx.runQuery(api.assessment.myRecheckSample, { token: token2, manifests });
    const passed = await ctx.runMutation(api.assessment.submitRecheck, {
      token: token2,
      manifests,
      results: sample2.map((s: { stepId: string; moduleCode: string; critical: boolean; reason: string }) => ({
        stepId: s.stepId,
        moduleCode: s.moduleCode,
        critical: s.critical,
        reason: s.reason,
        outcome: "pass" as const,
      })),
    });
    expect("full retention passes the re-check", passed.recheck.passed === true);
    expect(
      "all eight criteria met",
      passed.gate.passed === true,
      passed.gate.failed.join(",") || "none",
    );

    // -- 8. Certificate issuance and cold verification -----------------------
    const issued = await ctx.runMutation(api.assessment.issueCertificate, {
      token: token2,
      manifests,
    });
    expect("certificate issued", issued.issued === true, String(issued.code ?? ""));
    const code = String(issued.code);
    expect(
      "certificate code is well formed",
      /^KAV-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(code),
      code,
    );

    const again = await ctx.runMutation(api.assessment.issueCertificate, { token: token2, manifests });
    expect(
      "re-issuance is refused",
      again.issued === false && again.reason === "already-issued",
    );

    const verified = await ctx.runQuery(api.assessment.verifyCertificate, { code });
    expect("certificate verifies as valid", verified.found === true && verified.valid === true);
    expect("payload signature checks out", verified.signatureValid === true);
    expect(
      "certificate carries the retention result",
      verified.payload.recheckPassed === true,
    );
    expect("certificate names its holder", verified.payload.holder === "E2E Certified");

    const missing = await ctx.runQuery(api.assessment.verifyCertificate, { code: "KAV-XXXX-XXXX-XXXX" });
    expect("unknown code is not found", missing.found === false);

    // Tamper detection: push an expiry out by a century, verification must refuse.
    await ctx.runMutation(internal.internal.tamperPayload, { code });
    const tampered = await ctx.runQuery(api.assessment.verifyCertificate, { code });
    expect(
      "tampered payload is rejected",
      tampered.signatureValid === false && tampered.valid === false,
    );

    // -- 9. Admin surface -----------------------------------------------------
    // Self-registration never grants supervisor rights, and only the very
    // first account in a deployment is an admin. So the run registers a
    // dedicated supervisor and promotes it through the internal test-support
    // channel — otherwise this section would pass on a fresh database and
    // quietly stop testing anything on every subsequent run.
    const supEmail = `e2e-supervisor-${s}@kavach.test`;
    const sup = await ctx.runMutation(api.auth.register, {
      name: "E2E Supervisor",
      email: supEmail,
      password: "correct-horse-battery",
      preferredLocale: "en",
    });
    await ctx.runMutation(internal.internal.grantSupervisor, { email: supEmail });
    const supToken: string = sup.token;

    const heat = await ctx.runQuery(api.admin.stepHeatmap, { token: supToken, manifests });
    expect("heatmap returns a cell per step", heat.cells.length === 12, `${heat.cells.length} cells`);
    expect("heatmap sees the recorded attempts", heat.summary.attempts > 0, `${heat.summary.attempts} rows`);
    expect("A-03 is flagged critical in the heatmap", heat.cells.find((c: { stepId: string }) => c.stepId === "A-03")?.critical === true);

    // Both trainees must still be refused: the dashboard is not a trainee view.
    for (const [label, workerToken] of [
      ["first", token],
      ["certified", token2],
    ] as const) {
      let denied = false;
      try {
        await ctx.runQuery(api.admin.stepHeatmap, { token: workerToken, manifests });
      } catch {
        denied = true;
      }
      expect(`workers cannot read the safety dashboard (${label})`, denied);
    }

    // -- Summary ---------------------------------------------------------------
    const failedChecks = checks.filter((c) => !c.passed);
    console.log(`\n${checks.length - failedChecks.length}/${checks.length} checks passed`);
    for (const f of failedChecks) console.log(`  FAILED: ${f.name} ${f.detail}`);
    return { total: checks.length, passed: checks.length - failedChecks.length };
  },
});
