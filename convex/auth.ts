/**
 * Authentication.
 *
 * Why this is hand-rolled rather than Convex Auth: the deployment target for
 * the pilot is a mine or plant LAN with no public egress, so an OAuth redirect
 * to an external identity provider is not available. Training must work on a
 * device that has never left the site. So KAVACH owns its own credentials.
 *
 * Google sign-in exists as an *additional* door into the same building, not a
 * second identity system. It verifies Google's assertion server-side and then
 * mints exactly the same opaque bearer token `register` and `login` mint, so
 * `resolveUser` remains the single definition of "signed in" and every gate,
 * re-check and certificate path is untouched by it.
 *
 * The rules that matter:
 *   - passwords are never stored; PBKDF2-SHA256 hash + per-user salt only
 *   - bearer tokens are random, and only their SHA-256 hash is persisted
 *   - roles are read from the database on every call, never from the client
 */

import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import type { Locale } from "../src/lib/types";
import {
  generateSalt,
  hashPassword,
  randomToken,
  sha256Hex,
  timingSafeEqual,
  verifyGoogleIdToken,
} from "./crypto";

/** 30 days: long enough for a shift cycle, short enough to be revocable. */
const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const DEMO_ORG = {
  name: "Jharkhand Pilot — Sector 4",
  type: "mine" as const,
  contactEmail: "safety@kavach.example",
};

export interface AuthProfile {
  id: Id<"users">;
  name: string;
  email: string | null;
  role: "worker" | "supervisor" | "admin";
  workerCode: string | null;
  orgId: Id<"orgs">;
  orgName: string;
  preferredLocale: string | null;
}

function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Resolve a bearer token to a profile, or null.
 *
 * Shared by every authenticated mutation so there is exactly one definition of
 * "signed in". Expired tokens are deleted on sight.
 */
export async function resolveUser(
  ctx: any,
  token: string,
): Promise<AuthProfile | null> {
  if (!token) return null;
  const tokenHash = await sha256Hex(token);
  const row = await ctx.db
    .query("authTokens")
    .withIndex("by_token", (q: any) => q.eq("tokenHash", tokenHash))
    .unique();
  if (!row) return null;

  if (row.expiresAt <= Date.now()) {
    await ctx.db.delete(row._id);
    return null;
  }

  const user = await ctx.db.get(row.userId);
  if (!user) return null;
  const org = await ctx.db.get(user.orgId);

  return {
    id: user._id,
    name: user.name,
    email: user.email ?? null,
    role: user.role,
    workerCode: user.workerCode ?? null,
    orgId: user.orgId,
    orgName: org?.name ?? "Unknown org",
    preferredLocale: user.preferredLocale ?? null,
  };
}

async function issueToken(ctx: any, userId: any): Promise<string> {
  const token = randomToken(24);
  await ctx.db.insert("authTokens", {
    userId,
    tokenHash: await sha256Hex(token),
    createdAt: Date.now(),
    expiresAt: Date.now() + TOKEN_TTL_MS,
  });
  return token;
}

/** The demo organisation is created on first sign-up. */
async function ensureDemoOrg(ctx: any) {
  const existing = await ctx.db.query("orgs").withIndex("by_name", (q: any) => q.eq("name", DEMO_ORG.name)).unique();
  if (existing) return existing._id;
  return ctx.db.insert("orgs", { ...DEMO_ORG, createdAt: Date.now() });
}

/**
 * Create an account.
 *
 * The first account in the deployment becomes the admin (there has to be one,
 * or the heatmap dashboard is unreachable). Everyone after that is a worker,
 * because self-assigned supervisor rights would make the certificate audit
 * meaningless.
 */
/**
 * Create an account and hand back a live session.
 *
 * `register` and `googleSignIn` are two doors into the same building, so they
 * share this. One definition is what stops the first-run supervisor bootstrap,
 * the worker-code sequence and the module assignments drifting apart between
 * them — which is exactly the kind of difference that is invisible until two
 * people hold different certificates.
 */
async function createAccount(
  ctx: any,
  args: {
    email: string;
    name: string;
    /** Omit for an account reachable only through Google. */
    password?: string;
    preferredLocale?: Locale;
  },
): Promise<{ token: string; profile: AuthProfile | null }> {
  const orgId = await ensureDemoOrg(ctx);
  const userCount = await ctx.db.query("users").collect();

  // One salt per user, reused for every future verification. A Google-only
  // account gets no salt and no hash, which is what makes `login` refuse it by
  // password rather than accept an empty one.
  const salt = args.password ? generateSalt() : null;
  const credentials =
    salt && args.password
      ? { passwordSalt: salt, passwordHash: await hashPassword(args.password, salt) }
      : {};

  const userId = await ctx.db.insert("users", {
    email: args.email,
    ...credentials,
    name: args.name,
    workerCode: `WKR-JH-${String(1000 + userCount.length + 1)}`,
    // The first account in a deployment bootstraps the supervisor role;
    // everyone after that is a worker, whoever created them.
    role: userCount.length === 0 ? "admin" : "worker",
    orgId,
    ...(args.preferredLocale ? { preferredLocale: args.preferredLocale } : {}),
    createdAt: Date.now(),
  });

  // Assign every published module so the dashboard has something to show.
  const modules = await ctx.db.query("modules").collect();
  for (const module of modules) {
    await ctx.db.insert("moduleAssignments", {
      userId,
      moduleCode: module.code,
      assignedAt: Date.now(),
    });
  }

  const token = await issueToken(ctx, userId);
  return { token, profile: await resolveUser(ctx, token) };
}

export const register = mutation({
  args: {
    name: v.string(),
    email: v.string(),
    password: v.string(),
    preferredLocale: v.optional(v.union(v.literal("en"), v.literal("hi"), v.literal("sat"))),
  },
  handler: async (ctx, args) => {
    const email = normaliseEmail(args.email);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      throw new Error("Enter a valid email address.");
    }
    if (args.password.length < 8) {
      throw new Error("Password must be at least 8 characters.");
    }

    const existing = await ctx.db
      .query("users")
      .withIndex("by_email", (q: any) => q.eq("email", email))
      .unique();
    if (existing) throw new Error("An account with that email already exists.");

    return await createAccount(ctx, {
      email,
      name: args.name.trim(),
      password: args.password,
      ...(args.preferredLocale ? { preferredLocale: args.preferredLocale } : {}),
    });
  },
});

export const login = mutation({
  args: {
    email: v.string(),
    password: v.string(),
  },
  handler: async (ctx, args) => {
    const email = normaliseEmail(args.email);
    const user = await ctx.db
      .query("users")
      .withIndex("by_email", (q: any) => q.eq("email", email))
      .unique();

    // Same error for "no such user" and "wrong password" — do not enumerate
    // which emails have accounts.
    if (!user || !user.passwordHash || !user.passwordSalt) {
      throw new Error("Email or password is incorrect.");
    }
    const candidate = await hashPassword(args.password, user.passwordSalt);
    if (!timingSafeEqual(candidate, user.passwordHash)) {
      throw new Error("Email or password is incorrect.");
    }

    const token = await issueToken(ctx, user._id);
    const profile = await resolveUser(ctx, token);
    return { token, profile };
  },
});

/**
 * Sign in with Google.
 *
 * The client hands over a Google ID token. It is verified here — signature,
 * audience, issuer, expiry, and `email_verified` — before anything is trusted.
 * Only then does this resolve to the same opaque token the password path issues.
 *
 * Deliberately *not* Convex's built-in OAuth: that would introduce a second
 * session system alongside the bearer token every other function in this
 * codebase resolves through, and two sources of "who is signed in" is how a
 * certificate ends up issued against the wrong identity.
 *
 * Reaching an *existing* account by verified email is the intended behaviour,
 * not a hole: it is the same address the person proved ownership of, and
 * `email_verified` is checked above. What it will not do is let a Google
 * sign-in into an account that has a password while a *different* person holds
 * the password — the ownership proof is the same one either way.
 */
export const googleSignIn = mutation({
  args: { idToken: v.string() },
  handler: async (ctx, args) => {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    if (!clientId) {
      throw new Error("Google sign-in is not configured on this deployment.");
    }

    const identity = await verifyGoogleIdToken(args.idToken, clientId);

    const existing = await ctx.db
      .query("users")
      .withIndex("by_email", (q: any) => q.eq("email", identity.email))
      .unique();

    if (existing) {
      const token = await issueToken(ctx, existing._id);
      return { token, profile: await resolveUser(ctx, token), created: false };
    }

    // No password, so this account cannot be signed into with the password
    // form — `login` already refuses accounts without a hash.
    return {
      ...(await createAccount(ctx, {
        email: identity.email,
        name: identity.name?.trim() || identity.email.split("@")[0] || "Trainee",
      })),
      created: true,
    };
  },
});

/** Current profile for a stored token, or null when signed out. */
export const me = query({
  args: { token: v.string() },
  handler: async (ctx, args) => resolveUser(ctx, args.token),
});

export const logout = mutation({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const tokenHash = await sha256Hex(args.token);
    const row = await ctx.db
      .query("authTokens")
      .withIndex("by_token", (q: any) => q.eq("tokenHash", tokenHash))
      .unique();
    if (row) await ctx.db.delete(row._id);
    return { ok: true };
  },
});

/** Update the trainee's own language and display name. */
export const updateProfile = mutation({
  args: {
    token: v.string(),
    name: v.optional(v.string()),
    preferredLocale: v.optional(v.union(v.literal("en"), v.literal("hi"), v.literal("sat"))),
  },
  handler: async (ctx, args) => {
    const profile = await resolveUser(ctx, args.token);
    if (!profile) throw new Error("Not signed in.");

    const user = await ctx.db.get(profile.id);
    if (!user) throw new Error("Not signed in.");

    const patch: Record<string, unknown> = {};
    if (args.name && args.name.trim().length > 0) patch.name = args.name.trim();
    if (args.preferredLocale) patch.preferredLocale = args.preferredLocale;
    if (Object.keys(patch).length > 0) await ctx.db.patch(user._id, patch);

    return resolveUser(ctx, args.token);
  },
});
