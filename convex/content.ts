/**
 * Module content publication.
 *
 * C3: training content is data, not code. The manifests live in
 * `src/modules/*.json`, are validated by `bun run validate:content`, and are
 * pushed here so a device can fetch them once and then run offline.
 *
 * Publication is idempotent on (code, version): re-publishing an unchanged
 * manifest is a no-op, so this is safe to call on every deploy.
 */

import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { resolveUser } from "./auth";
import { MODULES } from "../src/lib/modules";
import type { ModuleManifest } from "../src/lib/types";

/**
 * Push every bundled manifest into the database.
 *
 * Runs as a plain mutation rather than an action so it participates in the
 * normal transaction; it is idempotent, so calling it repeatedly is cheap.
 */
export const publishModules = mutation({
  args: {},
  handler: async (ctx) => {
    const published: string[] = [];
    let skipped = 0;

    for (const manifest of Object.values(MODULES) as ModuleManifest[]) {
      const existing = await ctx.db
        .query("modules")
        .withIndex("by_code", (q: any) => q.eq("code", manifest.code))
        .unique();

      if (existing && existing.version === manifest.version) {
        skipped += 1;
        continue;
      }

      const doc = {
        code: manifest.code,
        domain: manifest.domain,
        title: manifest.title,
        version: manifest.version,
        estimatedMinutes: manifest.estimatedMinutes,
        passScore: manifest.passScore,
        manifest,
        published: true,
      };

      if (existing) await ctx.db.patch(existing._id, doc);
      else await ctx.db.insert("modules", { ...doc, createdAt: Date.now() });
      published.push(manifest.code);
    }

    return { published, skipped };
  },
});

/** Every published module manifest, for the client to bundle for offline use. */
export const listModules = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("modules")
      .filter((q: any) => q.eq(q.field("published"), true))
      .collect();

    return rows
      .map((r: any) => r.manifest as ModuleManifest)
      .sort((a: ModuleManifest, b: ModuleManifest) => a.code.localeCompare(b.code));
  },
});

/** A content fingerprint, used by the client to decide whether to re-fetch. */
export const contentVersion = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("modules").collect();
    const parts = rows
      .map((r: any) => `${r.code}@${r.version}`)
      .sort()
      .join("|");
    return { version: parts || "empty", count: rows.length };
  },
});

/** Modules assigned to the signed-in trainee. Falls back to all published. */
export const listMyAssignments = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const profile = await resolveUser(ctx, args.token);
    if (!profile) throw new Error("Not signed in.");

    const assignments = await ctx.db
      .query("moduleAssignments")
      .withIndex("by_user", (q: any) => q.eq("userId", profile.id))
      .collect();

    const all = await ctx.db
      .query("modules")
      .filter((q: any) => q.eq(q.field("published"), true))
      .collect();

    const assigned = assignments.length > 0 ? assignments.map((a: any) => a.moduleCode) : null;

    return all
      .map((r: any) => r.manifest as ModuleManifest)
      .filter((m: ModuleManifest) => !assigned || assigned.includes(m.code))
      .sort((a: ModuleManifest, b: ModuleManifest) => a.code.localeCompare(b.code));
  },
});

/** Headcount and readiness for the landing/dashboard demo figures. */
export const demoStats = query({
  args: {},
  handler: async (ctx) => {
    const users = await ctx.db.query("users").collect();
    const certificates = await ctx.db
      .query("certificates")
      .filter((q: any) => q.eq(q.field("revoked"), false))
      .collect();
    const modules = await ctx.db.query("modules").collect();

    const now = Date.now();
    return {
      trainees: users.length,
      certificatesIssued: certificates.length,
      activeCertificates: certificates.filter((c: any) => c.expiresAt > now).length,
      modules: modules.length,
      steps: modules.reduce((n: number, m: any) => n + (m.manifest?.steps?.length ?? 0), 0),
      criticalSteps: modules.reduce(
        (n: number, m: any) =>
          n + (m.manifest?.steps ?? []).filter((s: any) => s.critical).length,
        0,
      ),
    };
  },
});
