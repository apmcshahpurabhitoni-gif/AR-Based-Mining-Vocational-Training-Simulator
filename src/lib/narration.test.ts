/**
 * Narration, proven without a browser.
 *
 * The engine is injected precisely so this file can exist. Every branch that
 * differs between handsets — no Hindi voice, no synthesis at all, a browser that
 * refuses before the first gesture, a voice list that arrives late, an engine
 * that forgets `onend` — is a branch a real device will take and a test can
 * hold still.
 *
 * The behavioural claims worth protecting are not "it calls speak()". They are:
 * a step change cancels the previous instruction rather than queueing it, a
 * device with no Hindi voice says so instead of substituting another language,
 * and muting is remembered.
 */

import { describe, expect, mock, test } from "bun:test";
import {
  pickVoice,
  speak,
  speechLangFor,
  stopSpeaking,
  wasHeard,
  type NarrationOutcome,
  type SpeechEngine,
  type UtteranceLike,
  type VoiceLike,
} from "./narration";
import { readMuted, writeMuted } from "./use-narration";

/** A recording double. Every call is captured so a test can assert on it. */
function fakeEngine(initialVoices: VoiceLike[] = []) {
  const calls: { speak: UtteranceLike[]; cancel: number } = { speak: [], cancel: 0 };
  let voices = initialVoices;
  let listeners: Array<() => void> = [];
  const engine: SpeechEngine = {
    getVoices: () => voices,
    speak: (utterance) => {
      calls.speak.push(utterance);
    },
    cancel: () => {
      calls.cancel += 1;
    },
    onVoicesChanged: (handler) => {
      listeners.push(handler);
      return () => {
        listeners = listeners.filter((l) => l !== handler);
      };
    },
  };
  return {
    engine,
    calls,
    setVoices: (next: VoiceLike[]) => {
      voices = next;
      for (const listener of listeners) listener();
    },
    get listenerCount() {
      return listeners.length;
    },
  };
}

const utterance = (text: string): UtteranceLike => ({
  text,
  lang: "",
  voice: null,
  rate: 1,
  pitch: 1,
});

const HI_VOICE: VoiceLike = { name: "Google हिन्दी", lang: "hi-IN", default: true };
const EN_VOICE: VoiceLike = { name: "Google US English", lang: "en-US", default: true };

describe("language selection", () => {
  test("asks for a regional tag, not a bare language", () => {
    // A bare "hi" on a handset with no Hindi pack gets answered by an English
    // voice, which reads a Hindi safety instruction in English at speed.
    expect(speechLangFor("hi")).toBe("hi-IN");
    expect(speechLangFor("en")).toBe("en-IN");
    expect(speechLangFor("sat")).toBe("sat-IN");
    expect(speechLangFor("xx")).toBe("xx-IN");
  });

  test("prefers an exact tag, then the base language, then a default", () => {
    expect(
      pickVoice([{ name: "a", lang: "hi" }, { name: "b", lang: "hi-IN" }], "hi-IN")?.name,
    ).toBe("b");
    // Case-insensitively exact, and an exact tag still beats a bare language:
    // `hi-IN` is the voice that was actually installed for Hindi.
    expect(
      pickVoice([{ name: "a", lang: "HI-in" }, { name: "b", lang: "hi-IN" }], "hi-IN")?.name,
    ).toBe("a");
    expect(
      pickVoice([{ name: "bare", lang: "HI" }, { name: "exact", lang: "hi-IN" }], "hi-IN")?.name,
    ).toBe("exact");
    expect(pickVoice([{ name: "plain", lang: "hi" }], "hi-IN")?.name).toBe("plain");
    expect(
      pickVoice(
        [
          { name: "other", lang: "hi-IN" },
          { name: "marked", lang: "hi-IN", default: true },
        ],
        "hi-IN",
      )?.name,
    ).toBe("marked");
  });

  test("returns null rather than borrowing a voice from another language", () => {
    // Reading a Hindi safety instruction aloud in Tamil because it was the only
    // voice installed would be worse than saying nothing.
    expect(pickVoice([EN_VOICE], "hi-IN")).toBeNull();
  });
});

describe("speaking a step instruction", () => {
  test("speaks in the trainee's language with the matched voice", async () => {
    const fake = fakeEngine([EN_VOICE, HI_VOICE]);
    const result = await speak("सही बुझावा चुनो", {
      locale: "hi",
      engine: fake.engine,
      createUtterance: utterance,
      endFallbackMs: 5,
    });
    expect(result.outcome).toBe("spoken" as NarrationOutcome);
    const spoken = fake.calls.speak[0]!;
    expect(spoken.text).toBe("सही बुझावा चुनो");
    expect(spoken.lang).toBe("hi-IN");
    expect(spoken.voice?.name).toBe("Google हिन्दी");
    expect(spoken.rate).toBeLessThan(1);
  });

  test("cancels before speaking, so a step change cannot queue an instruction", async () => {
    // A trainee moving briskly hears step one's instruction while looking at
    // step three — the words belong to the wrong step, which is worse than
    // silence because it is confidently wrong.
    const fake = fakeEngine([HI_VOICE]);
    const opts = { locale: "hi", engine: fake.engine, createUtterance: utterance, endFallbackMs: 5 };
    await speak("पहला", opts);
    await speak("दूसरा", opts);
    expect(fake.calls.cancel).toBeGreaterThanOrEqual(2);
    expect(fake.calls.speak.map((u) => u.text)).toEqual(["पहला", "दूसरा"]);
  });

  test("reports no-voice instead of speaking in another language", async () => {
    const fake = fakeEngine([EN_VOICE]);
    const result = await speak("Withdraw from the hazardous area", {
      locale: "hi",
      engine: fake.engine,
      createUtterance: utterance,
      endFallbackMs: 5,
    });
    expect(result.outcome).toBe("no-voice");
    expect(result.voice).toBeNull();
    expect(fake.calls.speak).toHaveLength(0);
  });

  test("says muted without touching the engine", async () => {
    const fake = fakeEngine([HI_VOICE]);
    const result = await speak("कुछ भी", {
      locale: "hi",
      muted: true,
      engine: fake.engine,
      createUtterance: utterance,
      endFallbackMs: 5,
    });
    expect(result.outcome).toBe("muted");
    expect(fake.calls.speak).toHaveLength(0);
    expect(fake.calls.cancel).toBe(0);
  });

  test("says empty rather than reading a blank instruction", async () => {
    const fake = fakeEngine([HI_VOICE]);
    const result = await speak("   ", {
      locale: "en",
      engine: fake.engine,
      createUtterance: utterance,
      endFallbackMs: 5,
    });
    expect(result.outcome).toBe("empty");
    expect(fake.calls.speak).toHaveLength(0);
  });

  test("reports a browser that refuses before the first gesture", async () => {
    const fake = fakeEngine([HI_VOICE]);
    const result = await speak("सही बुझावा चुनो", {
      locale: "hi",
      engine: fake.engine,
      endFallbackMs: 5,
      createUtterance: () => {
        const u = utterance("सही बुझावा चुनो");
        // The browser answers with not-allowed rather than throwing.
        queueMicrotask(() => u.onerror?.({ error: "not-allowed" }));
        return u;
      },
    });
    expect(result.outcome).toBe("blocked");
    expect(wasHeard(result.outcome)).toBe(false);
  });

  test("reports a synthesis call that throws as unsupported", async () => {
    const fake = fakeEngine([EN_VOICE]);
    const result = await speak("hello", {
      locale: "en",
      engine: {
        ...fake.engine,
        speak: () => {
          throw new Error("no engine");
        },
      },
      createUtterance: utterance,
      endFallbackMs: 5,
    });
    expect(result.outcome).toBe("unsupported");
  });

  test("resolves even when the engine never fires onend", async () => {
    // Android can drop a cancelled utterance without an event, and a promise
    // that never settles leaves the trainee's toggle stuck mid-sentence.
    const fake = fakeEngine([EN_VOICE]);
    const result = await speak("A long enough instruction to be read aloud", {
      locale: "en",
      engine: fake.engine,
      createUtterance: utterance,
      endFallbackMs: 5,
    });
    expect(result.outcome).toBe("spoken");
  });

  test("unsubscribes from the voice event once voices arrive", async () => {
    // Leaving a listener attached to a document-long event target is a leak per
    // step, and a trainee runs through twelve.
    const fake = fakeEngine([]);
    const pending = speak("निकलो", {
      locale: "hi",
      engine: fake.engine,
      createUtterance: utterance,
      voiceTimeoutMs: 500,
      endFallbackMs: 5,
    });
    expect(fake.listenerCount).toBe(1);
    fake.setVoices([HI_VOICE]);
    const result = await pending;
    expect(result.outcome).toBe("spoken");
    expect(fake.listenerCount).toBe(0);
  });

  test("gives up on a device that never reports its voices", async () => {
    const fake = fakeEngine([]);
    const result = await speak("निकलो", {
      locale: "hi",
      engine: fake.engine,
      createUtterance: utterance,
      voiceTimeoutMs: 30,
    });
    expect(result.outcome).toBe("no-voice");
    expect(fake.listenerCount).toBe(0);
  });
});

describe("stopping", () => {
  test("cancels, and tolerates an engine that throws", () => {
    const fake = fakeEngine([HI_VOICE]);
    stopSpeaking(fake.engine);
    expect(fake.calls.cancel).toBe(1);

    const throwing: SpeechEngine = {
      ...fake.engine,
      cancel: mock(() => {
        throw new Error("nope");
      }),
    };
    expect(() => stopSpeaking(throwing)).not.toThrow();
    expect(() => stopSpeaking(null)).not.toThrow();
  });
});

describe("the mute preference", () => {
  const store = new Map<string, string>();
  const original = (globalThis as { localStorage?: Storage }).localStorage;

  /** A localStorage that can be made to throw, which is what private mode does. */
  const stub = (throwing = false): void => {
    (globalThis as { localStorage?: Storage }).localStorage = {
      getItem: (k: string) => {
        if (throwing) throw new Error("denied");
        return store.get(k) ?? null;
      },
      setItem: (k: string, v: string) => {
        if (throwing) throw new Error("denied");
        store.set(k, v);
      },
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
      key: () => null,
      length: 0,
    } as unknown as Storage;
  };

  test("narration is on by default, because the trainee who needs it cannot read the text", () => {
    store.clear();
    stub();
    expect(readMuted()).toBe(false);
  });

  test("a muted trainee stays muted on the next step and the next session", () => {
    store.clear();
    stub();
    // Asked again on every step would be a small way of saying the app was not
    // listening the first time.
    expect(readMuted()).toBe(false);
    store.set("kavach.narration.muted", "1");
    expect(readMuted()).toBe(true);
  });

  test("falls back to on when storage refuses, rather than failing the render", () => {
    stub(true);
    expect(readMuted()).toBe(false);
    expect(() => writeMuted(true)).not.toThrow();
  });

  test("restores the environment it borrowed", () => {
    if (original === undefined) delete (globalThis as { localStorage?: Storage }).localStorage;
    else (globalThis as { localStorage?: Storage }).localStorage = original;
  });
});
