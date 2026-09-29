/**
 * Admin analytics: the step failure heatmap.
 *
 * The heatmap is the thing a safety manager actually uses. Every other AR
 * training platform gives them a completion rate. KAVACH can give them the
 * specific wrong answer their people keep choosing and the step it belongs to,
 * because attempts are stored at step level with a misconception tag rather
 * than aggregated into a session score (C8).
 *
 * Derived by recomputing from raw rows, not from stored aggregates — the same
 * reason the scoring rubric recomputes rather than persists.
 */

import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { resolveUser } from "./auth";
import type { ModuleManifest, Step, StepMetrics } from "../src/lib/types";
import { computeStepMetrics, groupAttemptsByStep } from "../src/lib/scoring";
import type { StepAttemptRecord } from "../src/lib/types";

/** Misconception tags are authored in content; this turns them into labels. */
const MISCONCEPTION_LABELS: Record<string, { en: string; hi: string }> = {
  water_on_electrical: {
    en: "Thinks water is safe on an electrical fire",
    hi: "मानता है कि बिजली की आग पर पानी सुरक्षित है",
  },
  wrong_fire_class: {
    en: "Confuses extinguisher types",
    hi: "बुझावा के प्रकारों में भ्रम",
  },
  return_to_work_fire: {
    en: "Re-enters a fire zone unbidden",
    hi: "आग की जगह बिना अनुमति लौटता है",
  },
  skip_accountability: {
    en: "Avoids the assembly point",
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
    en: "Misunderstands the buddy ratio",
    hi: "बडी अनुपात को समझ नहीं पाता",
  },
  supervisor_in_space: {
    en: "Wants the supervisor inside the space",
    hi: "सुपरवाइज़र को अंदर चाहता है",
  },
  surface_during_gas: {
    en: "Tries to reach the surface through the plume",
    hi: "धुआँ से होकर सतह तक निकलने की कोशिश",
  },
  delay_rescue: {
    en: "Delays reporting for help",
    hi: "मदद की सूचना में देली करता है",
  },
};

function label(tag: string, locale: "en" | "hi"): string {
  return MISCONCEPTION_LABELS[tag]?.[locale] ?? tag.replace(/_/g, " ");
}

export { label as misconceptionLabel, MISCONCEPTION_LABELS };

export const stepHeatmap = query({
  args: { token: v.string(), manifests: v.array(v.any()) },
  handler: async (ctx, args) => {
    const profile = await resolveUser(ctx, args.token);
    if (!profile) throw new Error("Not signed in.");
    // Role is read from the database, never from the client.
    if (profile.role !== "admin" && profile.role !== "supervisor") {
      throw new Error("Supervisor access required.");
    }

    const manifests = args.manifests as ModuleManifest[];
    const users = await ctx.db
      .query("users")
      .withIndex("by_org", (q: any) => q.eq("orgId", profile.orgId))
      .collect();

    // `attempts` is indexed by (userId, moduleCode), so the org's telemetry is
    // gathered by fanning out across its trainees. Org sizes in the pilot are
    // tens, not thousands; a dedicated rollup is a post-pilot concern.
    const unique: any[] = [];
    for (const user of users) {
      const rows = await ctx.db
        .query("attempts")
        .withIndex("by_user_module", (q: any) => q.eq("userId", user._id))
        .collect();
      unique.push(...rows);
    }

    const byUserModule = new Map<string, any[]>();
    for (const row of unique) {
      const key = `${row.userId}|${row.moduleCode}|${row.moduleVersion}`;
      const bucket = byUserModule.get(key) ?? [];
      bucket.push(row);
      byUserModule.set(key, bucket);
    }

    const cellMap = new Map<
      string,
      {
        moduleCode: string;
        stepId: string;
        critical: boolean;
        kind: string;
        instruction: Step["instruction"];
        attempts: number;
        misses: number;
        firstTryMisses: number;
        trainees: number;
        wrongTrainees: number;
        hintDependency: number;
        misconceptionCounts: Record<string, number>;
      }
    >();

    for (const manifest of manifests) {
      for (const step of manifest.steps) {
        cellMap.set(step.id, {
          moduleCode: manifest.code,
          stepId: step.id,
          critical: step.critical,
          kind: step.kind,
          instruction: step.instruction,
          attempts: 0,
          misses: 0,
          firstTryMisses: 0,
          trainees: 0,
          wrongTrainees: 0,
          hintDependency: 0,
          misconceptionCounts: {},
        });
      }
    }

    const perTraineeMiss = new Map<string, Set<string>>();

    for (const [key, attemptRows] of byUserModule) {
      const [userId, moduleCode, moduleVersion] = key.split("|");
      if (!userId || !moduleCode || !moduleVersion) continue;
      const manifest = manifests.find((m) => m.code === moduleCode);
      if (!manifest) continue;
      // Only score against the manifest version the trainee actually saw.
      const versionManifest: ModuleManifest = { ...manifest, version: moduleVersion };

      const records: StepAttemptRecord[] = attemptRows.map((row: any) => {
        const step = versionManifest.steps.find((s: Step) => s.id === row.stepId);
        return {
          eventId: row.eventId,
          sessionId: String(row.sessionId),
          moduleCode: row.moduleCode,
          moduleVersion: row.moduleVersion,
          stepId: row.stepId,
          stepSeq: row.stepSeq,
          critical: row.critical,
          outcome: row.outcome,
          attemptIndex: row.attemptIndex,
          elapsedMs: row.elapsedMs,
          hintUsed: row.hintUsed,
          selfRecovered: row.selfRecovered,
          prompted: row.prompted,
          orderViolation: row.orderViolation,
          ...(row.failureKind ? { failureKind: row.failureKind } : {}),
          ...(row.misconception ? { misconception: row.misconception } : {}),
          offline: row.offline,
          clientTs: row.clientTs,
          locale: row.locale,
          maxHints: step ? Math.max(1, step.maxHints ?? step.hints.length) : 1,
          expectedMs: step ? (step.expectedMs ?? step.action?.expectedMs ?? 0) : 0,
          weight: step?.weight ?? 1,
        };
      });

      const grouped = groupAttemptsByStep(versionManifest, records);

      for (const step of versionManifest.steps) {
        const cell = cellMap.get(step.id);
        if (!cell) continue;
        const stepRecords = grouped.get(step.id) ?? [];
        if (stepRecords.length === 0) continue;

        const metrics: StepMetrics = computeStepMetrics(step, stepRecords);
        cell.attempts += stepRecords.length;
        cell.misses += stepRecords.filter((r) => r.outcome === "fail").length;
        cell.firstTryMisses += metrics.criticalMiss || metrics.firstAttemptAccuracy === 0 ? 1 : 0;
        cell.trainees += 1;
        if (metrics.firstAttemptAccuracy < 1) {
          cell.wrongTrainees += 1;
          const set = perTraineeMiss.get(step.id) ?? new Set<string>();
          set.add(userId!);
          perTraineeMiss.set(step.id, set);
        }
        cell.hintDependency += metrics.hintDependency;
        for (const r of stepRecords) {
          if (r.outcome === "fail" && r.misconception) {
            cell.misconceptionCounts[r.misconception] =
              (cell.misconceptionCounts[r.misconception] ?? 0) + 1;
          }
        }
      }
    }

    const cells = [...cellMap.values()].map((cell) => ({
      ...cell,
      failRate: cell.attempts > 0 ? cell.misses / cell.attempts : 0,
      firstTryMissRate: cell.trainees > 0 ? cell.wrongTrainees / cell.trainees : 0,
      meanHintDependency: cell.trainees > 0 ? cell.hintDependency / cell.trainees : 0,
      misconceptions: Object.entries(cell.misconceptionCounts)
        .map(([tag, count]) => ({ tag, count }))
        .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag)),
    }));

    const certificates = await ctx.db
      .query("certificates")
      .withIndex("by_org", (q: any) => q.eq("orgId", profile.orgId))
      .collect();

    const assessments = await ctx.db
      .query("assessments")
      .collect();

    return {
      cells,
      summary: {
        trainees: users.length,
        workers: users.filter((u: any) => u.role === "worker").length,
        supervisors: users.filter((u: any) => u.role === "supervisor").length,
        attempts: unique.length,
        certificates: certificates.filter((c: any) => !c.revoked).length,
        gatePassRate:
          assessments.length > 0
            ? assessments.filter((a: any) => a.gatePassed).length / assessments.length
            : 0,
        recheckFailRate:
          assessments.length > 0
            ? assessments.filter((a: any) => !a.recheckPassed).length / assessments.length
            : 0,
      },
    };
  },
});

/** Per-trainee roster with their gate standing, for the supervisor view. */
export const roster = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const profile = await resolveUser(ctx, args.token);
    if (!profile) throw new Error("Not signed in.");
    if (profile.role !== "admin" && profile.role !== "supervisor") {
      throw new Error("Supervisor access required.");
    }

    const users = await ctx.db
      .query("users")
      .withIndex("by_org", (q: any) => q.eq("orgId", profile.orgId))
      .collect();

    const certificates = await ctx.db
      .query("certificates")
      .withIndex("by_org", (q: any) => q.eq("orgId", profile.orgId))
      .collect();

    return users.map((u: any) => {
      const cert = certificates.find((c: any) => c.userId === u._id && !c.revoked);
      return {
        id: u._id,
        name: u.name,
        workerCode: u.workerCode ?? null,
        role: u.role,
        createdAt: u.createdAt,
        certificateCode: cert?.code ?? null,
        certified: Boolean(cert && cert.expiresAt > Date.now()),
      };
    });
  },
});

/** Revoke a certificate. Auditable, and never silent. */
export const revokeCertificate = mutation({
  args: { token: v.string(), code: v.string(), reason: v.string() },
  handler: async (ctx, args) => {
    const profile = await resolveUser(ctx, args.token);
    if (!profile) throw new Error("Not signed in.");
    if (profile.role !== "admin") throw new Error("Admin access required.");

    const row = await ctx.db
      .query("certificates")
      .withIndex("by_code", (q: any) => q.eq("code", args.code.trim().toUpperCase()))
      .unique();
    if (!row) throw new Error("Certificate not found.");
    if (row.orgId !== profile.orgId) throw new Error("Not your organisation.");

    await ctx.db.patch(row._id, {
      revoked: true,
      revokedAt: Date.now(),
      revokedReason: args.reason.trim() || "Revoked by administrator",
    });
    return { ok: true, code: row.code };
  },
});
