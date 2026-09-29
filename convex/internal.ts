/**
 * Test-support mutations.
 *
 * These exist so the end-to-end run can (a) stand in for the 90-second
 * retention wait instead of sleeping through it, and (b) prove that an altered
 * certificate payload fails verification. All of them are `internal*`, so no
 * browser can reach them — they are not part of the product surface.
 *
 * Anything that exists purely for a test says so, right here.
 */

import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { RECHECK_MIN_DELAY_MS } from "../src/lib/gate";

/** Completed sessions for a user, so the e2e run can find their ids. */
export const listSessionsFor = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("sessions")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();

    return rows.map((s) => ({
      id: s._id,
      moduleCode: s.moduleCode,
      completedAt: s.completedAt ?? null,
      recheckEligibleAt: s.recheckEligibleAt ?? null,
    }));
  },
});

/**
 * Grant supervisor rights to one named account, so the e2e run can reach the
 * safety dashboard.
 *
 * Self-registration deliberately never grants this: only the first account in a
 * deployment is an admin, because self-assigned supervisor rights would make
 * the certificate audit meaningless. A test that depends on "am I the first
 * user?" passes once and then silently stops exercising the dashboard on every
 * later run, which is worse than not testing it at all.
 */
export const grantSupervisor = internalMutation({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", args.email.trim().toLowerCase()))
      .unique();
    if (!user) throw new Error("No such account.");

    await ctx.db.patch(user._id, { role: "supervisor" });
    return { ok: true, role: "supervisor" as const };
  },
});

/**
 * Backdate a session's re-check eligibility so the e2e run does not have to
 * wait out the real 90 seconds. Production eligibility is never altered.
 */
export const markRecheckEligible = internalMutation({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.sessionId, {
      recheckEligibleAt: Date.now() - RECHECK_MIN_DELAY_MS,
    });
    return { ok: true };
  },
});

/**
 * Alter a certificate payload after issuance, to prove verification notices.
 *
 * This is the attack the signature exists to catch: someone with database
 * access pushes an expiry date out by fifty years. Verification must refuse
 * the record rather than report it as valid.
 */
export const tamperPayload = internalMutation({
  args: { code: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("certificates")
      .withIndex("by_code", (q) => q.eq("code", args.code))
      .unique();
    if (!row) throw new Error("Certificate not found.");

    await ctx.db.patch(row._id, {
      payload: {
        ...row.payload,
        expiresAt: Date.now() + 100 * 365 * 24 * 60 * 60 * 1000,
      },
    });
    return { ok: true };
  },
});
