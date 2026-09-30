/**
 * Offline store.
 *
 * The trainee's device is the system of record until there is a network. Every
 * attempt event is written here FIRST, before any network call is attempted
 * (docs/04-data-model.md §5). Nothing in the training flow is allowed to block
 * on connectivity, because the places this is used have none.
 *
 * Dexie is used rather than localStorage because the queue needs indexed
 * queries by session and by upload state, and because localStorage is
 * synchronous and size-capped — the wrong tool for telemetry.
 */

import Dexie, { type Table } from "dexie";
import type { AttemptEvent } from "./types";

/** An attempt event waiting to be uploaded. */
export interface QueuedEvent extends AttemptEvent {
  /** Convex session id, filled in once the session has been opened. */
  serverSessionId?: string;
  /** false = never uploaded, true = acknowledged by the server. */
  uploaded: boolean;
  attempts: number;
  lastError?: string;
  queuedAt: number;
}

export interface LocalSession {
  /** Client-generated id; the server reconciles on this. */
  clientSessionId: string;
  moduleCode: string;
  moduleVersion: string;
  locale: string;
  startedAt: number;
  completedAt?: number;
  /** Local score, so the UI is useful with no server at all. */
  localScore?: number;
  serverScore?: number;
  synced: boolean;
}

class KavachDB extends Dexie {
  queue!: Table<QueuedEvent, string>;
  sessions!: Table<LocalSession, string>;

  constructor() {
    super("kavach");
    this.version(1).stores({
      // Primary key is eventId — the same idempotency key the server uses, so
      // a replay after a reconnect is a no-op on both sides.
      queue: "&eventId, sessionId, uploaded, queuedAt",
      sessions: "&clientSessionId, moduleCode, startedAt",
    });
  }
}

export const db = new KavachDB();

/**
 * Queue an attempt event.
 *
 * `put` rather than `add`: if the same event is queued twice (a double-tap, a
 * React strict-mode double effect) the second write collapses onto the first
 * instead of throwing.
 */
export async function enqueue(event: AttemptEvent): Promise<void> {
  await db.queue.put({
    ...event,
    uploaded: false,
    attempts: 0,
    queuedAt: Date.now(),
  });
}

export async function pendingCount(): Promise<number> {
  return db.queue.where("uploaded").equals(0).count();
}

export async function pendingEvents(limit = 200): Promise<QueuedEvent[]> {
  return db.queue.where("uploaded").equals(0).sortBy("queuedAt").then((rows) => rows.slice(0, limit));
}

/**
 * Mark a batch as uploaded.
 *
 * Only rows the server actually acknowledged are cleared. A partial success
 * leaves the rest queued, which is what makes the whole thing safe to retry
 * without ever double-counting.
 */
export async function markUploaded(eventIds: string[]): Promise<void> {
  if (eventIds.length === 0) return;
  await db.transaction("rw", db.queue, async () => {
    for (const id of eventIds) {
      await db.queue.update(id, { uploaded: true, attempts: 0, lastError: undefined });
    }
  });
}

export async function markFailed(eventIds: string[], error: string): Promise<void> {
  if (eventIds.length === 0) return;
  await db.transaction("rw", db.queue, async () => {
    for (const id of eventIds) {
      const row = await db.queue.get(id);
      if (row) {
        await db.queue.update(id, { attempts: row.attempts + 1, lastError: error });
      }
    }
  });
}

export async function saveLocalSession(session: LocalSession): Promise<void> {
  await db.sessions.put(session);
}

export async function getLocalSession(clientSessionId: string): Promise<LocalSession | undefined> {
  return db.sessions.get(clientSessionId);
}

export async function localSessions(): Promise<LocalSession[]> {
  const rows = await db.sessions.orderBy("startedAt").reverse().toArray();
  return rows;
}

/**
 * The most recent run per module, as raw attempt events.
 *
 * Read from the same `queue` table the sync engine uses, and deliberately
 * *including* rows already marked uploaded: a synced attempt is still the
 * trainee's evidence of how they performed, and dropping it the moment it
 * reaches the server would make the local report flicker with connectivity
 * rather than with training. The server recomputes authoritatively from its
 * own copy — this is a local read, not a second source of truth.
 *
 * Only the LATEST session per module. A retake must not blend into the run
 * before it: `scoreModule` groups attempts by step id, so two runs' rows for
 * the same step would merge into one history and the trainee's most recent,
 * honest attempt would be averaged against an older one. That is the exact
 * thing the product promises never to do — "the gate always evaluates the
 * latest honest attempt".
 */
export async function localEventsByModule(): Promise<Map<string, AttemptEvent[]>> {
  const [rows, sessions] = await Promise.all([db.queue.toArray(), localSessions()]);

  // Newest session per module, by start time. `sessions` is already sorted
  // newest-first, so the first match wins.
  const latest = new Map<string, string>();
  for (const session of sessions) {
    if (!latest.has(session.moduleCode)) latest.set(session.moduleCode, session.clientSessionId);
  }

  // Fall back to the events themselves when no session row survives — a
  // half-written run must still show what it recorded rather than nothing.
  const latestByEventTs = new Map<string, { sessionId: string; ts: number }>();
  for (const row of rows) {
    const seen = latestByEventTs.get(row.moduleCode);
    if (!seen || row.clientTs > seen.ts) {
      latestByEventTs.set(row.moduleCode, { sessionId: row.sessionId, ts: row.clientTs });
    }
  }
  for (const [moduleCode, entry] of latestByEventTs) {
    if (!latest.has(moduleCode)) latest.set(moduleCode, entry.sessionId);
  }

  const grouped = new Map<string, AttemptEvent[]>();
  for (const row of rows) {
    if (latest.get(row.moduleCode) !== row.sessionId) continue;
    const bucket = grouped.get(row.moduleCode);
    if (bucket) bucket.push(row);
    else grouped.set(row.moduleCode, [row]);
  }
  for (const bucket of grouped.values()) {
    bucket.sort((a, b) => a.clientTs - b.clientTs || a.eventId.localeCompare(b.eventId));
  }
  return grouped;
}

/** Wipe everything. Used by sign-out, which must not leave telemetry behind. */
export async function clearLocalData(): Promise<void> {
  await db.transaction("rw", [db.queue, db.sessions], async () => {
    await db.queue.clear();
    await db.sessions.clear();
  });
}

/** Stable per-device identifier, so sessions can be reconciled after reinstall. */
export function deviceId(): string {
  const KEY = "kavach.deviceId";
  try {
    const existing = localStorage.getItem(KEY);
    if (existing) return existing;
    const fresh =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `dev-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
    localStorage.setItem(KEY, fresh);
    return fresh;
  } catch {
    // Private mode with storage disabled: fall back to an in-memory id. The
    // session still works; it just cannot be reconciled across reloads.
    return "ephemeral-device";
  }
}
