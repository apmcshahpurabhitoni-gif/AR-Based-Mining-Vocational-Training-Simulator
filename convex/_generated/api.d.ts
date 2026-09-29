/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as admin from "../admin.js";
import type * as assessment from "../assessment.js";
import type * as attempts from "../attempts.js";
import type * as auth from "../auth.js";
import type * as content from "../content.js";
import type * as crypto from "../crypto.js";
import type * as e2e from "../e2e.js";
import type * as internal_ from "../internal.js";
import type * as selftest from "../selftest.js";
import type * as sessions from "../sessions.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  admin: typeof admin;
  assessment: typeof assessment;
  attempts: typeof attempts;
  auth: typeof auth;
  content: typeof content;
  crypto: typeof crypto;
  e2e: typeof e2e;
  internal: typeof internal_;
  selftest: typeof selftest;
  sessions: typeof sessions;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
