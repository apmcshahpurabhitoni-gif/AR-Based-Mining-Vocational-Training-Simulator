/**
 * Sync engine.
 *
 * The contract from docs/04-data-model.md §5, in one place:
 *
 *   1. events are written to the device first, always
 *   2. the server is told the `clientSessionId` and reconciles it
 *   3. events are uploaded in batches, idempotent on `eventId`
 *   4. only acknowledged events are cleared
 *
 * A trainee who trains for a week underground, reconnects once, and walks away
 * must end up with exactly the records they actually produced — no duplicates,
 * no gaps. That property is what the whole offline story rests on, and it is
 * why clearing is driven by the server's response rather than by optimism.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  enqueue,
  getLocalSession,
  markFailed,
  markUploaded,
  pendingCount,
  pendingEvents,
  saveLocalSession,
  type LocalSession,
} from "./db";
import { bundledManifests, completeSession, pushEvents, startSession } from "./api";
import type { AttemptEvent, ModuleManifest } from "./types";

export interface SyncState {
  pending: number;
  syncing: boolean;
  lastSyncedAt: number | null;
  lastError: string | null;
}

const INITIAL: SyncState = { pending: 0, syncing: false, lastSyncedAt: null, lastError: null };

/**
 * Record an attempt locally and try to flush.
 *
 * Never throws and never blocks. The UI calls this from the reducer's event
 * handler; if the network is gone the row sits in IndexedDB and the trainee
 * carries on.
 */
export async function recordEvent(event: AttemptEvent): Promise<void> {
  try {
    await enqueue(event);
  } catch {
    // A storage failure must not take the trainee out of their session. The
    // event is still in React state and will be reconciled on completion.
  }
}

/**
 * Open a session on the server and return its id.
 *
 * Returns null when offline. The caller keeps training and the id is resolved
 * later, because `clientSessionId` makes the session reconcilable either way.
 */
export async function openSession(
  token: string | null,
  manifest: ModuleManifest,
  clientSessionId: string,
  locale: string,
  device: string,
): Promise<string | null> {
  if (!token) return null;
  const result = await startSession(token, {
    moduleCode: manifest.code,
    moduleVersion: manifest.version,
    locale,
    deviceId: device,
    clientSessionId,
  });
  return result.ok ? result.value.sessionId : null;
}

/** Flush everything queued for one client session. */
export async function flushSession(
  token: string | null,
  clientSessionId: string,
  manifests: ModuleManifest[],
): Promise<SyncState> {
  if (!token) return INITIAL;

  try {
    const serverSessionId = await openSessionFromQueue(token, clientSessionId, manifests);
    if (!serverSessionId) return INITIAL;

    const rows = await pendingEvents(500);
    const mine = rows.filter((r) => r.sessionId === clientSessionId);
    if (mine.length === 0) return INITIAL;

    const result = await pushEvents(token, {
      sessionId: serverSessionId,
      manifests,
      events: mine.map(({ eventId, ...event }) => ({ ...event, eventId })),
    });

    if (!result.ok) {
      await markFailed(mine.map((r) => r.eventId), result.error);
      return { ...INITIAL, lastError: result.error };
    }

    // Everything we offered is accounted for, whether it was new or a replay.
    await markUploaded(mine.map((r) => r.eventId));
    return { pending: await pendingCount(), syncing: false, lastSyncedAt: Date.now(), lastError: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ...INITIAL, lastError: message };
  }
}

async function openSessionFromQueue(
  token: string,
  clientSessionId: string,
  manifests: ModuleManifest[],
): Promise<string | null> {
  if (manifests.length === 0) return null;

  // The module and locale come from the local session row, not from the
  // argument: the queue can hold events from more than one module.
  const local = await getLocalSession(clientSessionId);
  if (!local) return null;

  const result = await startSession(token, {
    moduleCode: local.moduleCode,
    moduleVersion: local.moduleVersion,
    locale: local.locale,
    deviceId: "web",
    clientSessionId,
  });
  return result.ok ? result.value.sessionId : null;
}

/**
 * Flush any session that has a server id but still has queued events.
 *
 * Used on reconnect, where the token already maps to a session from an
 * earlier visit.
 */
export async function flushPending(token: string | null): Promise<SyncState> {
  if (!token) return INITIAL;
  try {
    const rows = await pendingEvents(500);
    if (rows.length === 0) {
      return { pending: 0, syncing: false, lastSyncedAt: Date.now(), lastError: null };
    }
    // Flush one client session per call. The background loop calls this on an
    // interval, so a backlog drains over a few ticks rather than in one burst
    // that would time out on a mine's connection.
    const result = await flushSession(token, rows[0]!.sessionId, bundledManifests());
    return { ...result, pending: await pendingCount() };
  } catch {
    return INITIAL;
  }
}

/**
 * Live queue state for the connectivity chip in the app shell.
 *
 * Flushes on an interval and whenever the browser reports the network came
 * back. The interval is deliberately modest — this is a background nicety, not
 * the primary path, which is always "flush at the end of the session".
 */
export function useSyncQueue(token: string | null): SyncState & { flush: () => void } {
  const [state, setState] = useState<SyncState>(INITIAL);
  const inFlight = useRef(false);

  const refreshCount = useCallback(async () => {
    try {
      const pending = await pendingCount();
      setState((prev) => ({ ...prev, pending }));
    } catch {
      // non-fatal
    }
  }, []);

  const flush = useCallback(() => {
    if (!token || inFlight.current) return;
    inFlight.current = true;
    setState((prev) => ({ ...prev, syncing: true }));
    void flushPending(token)
      .then((next) => setState((prev) => ({ ...next, syncing: false })))
      .finally(() => {
        inFlight.current = false;
      });
  }, [token]);

  useEffect(() => {
    void refreshCount();
  }, [refreshCount]);

  useEffect(() => {
    const id = setInterval(() => {
      void refreshCount();
      flush();
    }, 20_000);
    return () => clearInterval(id);
  }, [flush, refreshCount]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onOnline = () => flush();
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [flush]);

  return { ...state, flush };
}

/** Persist the local mirror of a session. */
export function rememberSession(session: LocalSession): Promise<void> {
  return saveLocalSession(session).catch(() => undefined);
}
