/**
 * React binding for narration.
 *
 * All the decision-making is in `lib/narration.ts`, where it is provable without
 * a browser. This is the glue: read the preference, speak on step entry, cancel
 * on the way out, and keep the outcome where the UI can explain it.
 *
 * The preference is persisted because a trainee who mutes narration once has
 * answered the question, and being asked again on every step is a small way of
 * saying the app was not listening the first time. It is read defensively,
 * like every other localStorage read in this project, because private browsing
 * throws rather than returning null.
 *
 * The effect keys on the step id rather than the step object. `step` is rebuilt
 * on every render of the training page, so keying on it would re-speak the
 * instruction on every render — the trainee would hear the same sentence again
 * the moment they looked at the hint panel.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  browserEngine,
  browserUtteranceFactory,
  speak,
  stopSpeaking,
  type NarrationOutcome,
} from "./narration";
import type { Localised } from "./types";

const MUTED_KEY = "kavach.narration.muted";

/**
 * Read the stored preference, defaulting to on.
 *
 * On by default, because the trainee who needs it most is the one who cannot
 * read the text — and defaulting to off would make the feature invisible to
 * exactly the person it exists for. A control they can find and turn off is
 * better than a setting they have to go looking for.
 */
export function readMuted(): boolean {
  try {
    return localStorage.getItem(MUTED_KEY) === "1";
  } catch {
    return false;
  }
}

/** Persist the preference. Exported so the tests can hold storage that throws. */
export function writeMuted(next: boolean): void {
  try {
    localStorage.setItem(MUTED_KEY, next ? "1" : "0");
  } catch {
    // A preference that cannot be stored is a preference for this session.
  }
}

export interface Narration {
  /** The trainee's preference, and the setter that persists it. */
  muted: boolean;
  setMuted: (next: boolean) => void;
  /**
   * What happened for the most recent instruction, or `null` before the first
   * one. Anything other than `"spoken"` is worth showing.
   */
  outcome: NarrationOutcome | null;
  /** Speak now — used after a tap, which is the gesture a blocked browser wants. */
  retry: () => void;
}

export function useNarration(
  stepId: string,
  instruction: Localised | undefined,
  locale: string,
  /** Off on surfaces where an instruction is not being presented. */
  enabled = true,
): Narration {
  const [muted, setMutedState] = useState<boolean>(readMuted);
  const [outcome, setOutcome] = useState<NarrationOutcome | null>(null);
  // A counter rather than a boolean, so asking twice speaks twice. Retrying after
  // a blocked browser is the whole point of the retry path.
  const [attempt, setAttempt] = useState(0);
  const engineRef = useRef(browserEngine());
  const factoryRef = useRef(browserUtteranceFactory());
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const setMuted = useCallback((next: boolean) => {
    setMutedState(next);
    writeMuted(next);
    if (next) stopSpeaking(engineRef.current);
  }, []);

  useEffect(() => {
    const engine = engineRef.current;
    const createUtterance = factoryRef.current;
    if (!enabled) {
      stopSpeaking(engine);
      setOutcome(null);
      return;
    }
    // Nothing to read, or nothing to read it with: report it rather than
    // pretending. `unsupported` is the honest answer on a browser without
    // synthesis, and the UI turns it into a line the trainee can read.
    if (!engine || !createUtterance) {
      setOutcome("unsupported");
      return;
    }
    const text = instruction?.[locale as "en"] ?? instruction?.en;
    if (!text) {
      setOutcome("empty");
      return;
    }

    let cancelled = false;
    void speak(text, { locale, muted, engine, createUtterance }).then((result) => {
      if (!cancelled && aliveRef.current) setOutcome(result.outcome);
    });

    return () => {
      // Leaving the step stops the sentence. Without this an instruction keeps
      // reading while the trainee is on the next one, and the words on their
      // lips belong to a step they have already answered.
      cancelled = true;
      stopSpeaking(engine);
    };
  }, [stepId, locale, muted, enabled, instruction?.en, instruction?.hi, attempt]);

  const retry = useCallback(() => {
    setAttempt((n) => n + 1);
  }, []);

  return { muted, setMuted, outcome, retry };
}
