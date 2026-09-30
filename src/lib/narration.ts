/**
 * Narration: read the step's instruction aloud.
 *
 * ---------------------------------------------------------------------------
 * Why this exists
 * ---------------------------------------------------------------------------
 *
 * `docs/12` and `docs/13` both list "Hindi/Santali safety language" in their
 * review gates, and the demo script used to promise a trainee that "instruction
 * arrives in AUDIO — they don't read, they listen". Nothing implemented that:
 * `narrationKey` has been a manifest field since the first commit and no line of
 * code ever read it. A trainee who cannot read Hindi well is not a hypothetical
 * in a Jharkhand mine, and the one remedy the platform had was a sentence on a
 * screen.
 *
 * `speechSynthesis` is the only option here that meets the constraints. There is
 * no audio asset pipeline (docs/04: "nothing downloaded, nothing scraped,
 * nothing licensed from a vendor"), and there is no room for one: a 1.68 MB
 * `.mind` file is already the largest thing shipped, and a Hindi narration set
 * for twelve steps would dwarf it while needing a voice actor and a recording
 * booth. The platform's own TTS is on the handset, speaks the language the
 * trainee already has, and works with the network down — which is the whole
 * design constraint this project is built around.
 *
 * ---------------------------------------------------------------------------
 * What this module deliberately does not do
 * ---------------------------------------------------------------------------
 *
 * It speaks the instruction and nothing else. It never narrates a consequence,
 * never narrates a hint, and never synthesises safety wording that is not
 * already in the manifest. If the text is wrong in Hindi, this makes it wrong
 * out loud — which is an argument for the language review in docs/12, not
 * against audio.
 *
 * Every failure is a first-class outcome rather than a silent no-op. A trainee
 * whose phone has no Hindi voice must be able to see that, because a control
 * that looks present and does nothing is worse than no control: it is the demo
 * script's original lie in miniature.
 *
 * ---------------------------------------------------------------------------
 * Testability
 * ---------------------------------------------------------------------------
 *
 * The engine is injected. The browser engine wraps `window.speechSynthesis`,
 * and the tests pass a recording double, so every branch — no voice, muted,
 * unsupported, blocked, late voice load, cancellation — is provable without a
 * browser, which is the only kind of evidence docs/15 accepts.
 */

/** A voice, as far as this module cares. */
export interface VoiceLike {
  name: string;
  /** BCP-47, e.g. `hi-IN`. Case varies by platform, which is why matching below is not case-sensitive. */
  lang: string;
  default?: boolean;
}

/**
 * The parts of `SpeechSynthesisUtterance` used here.
 *
 * Declared rather than imported so the tests can hand back a plain object. The
 * real engine returns genuine `SpeechSynthesisUtterance`s, which satisfy this.
 */
export interface UtteranceLike {
  text: string;
  lang: string;
  voice: VoiceLike | null;
  rate: number;
  pitch: number;
  onend?: (() => void) | null;
  onerror?: ((event: { error: string }) => void) | null;
}

/**
 * The parts of `SpeechSynthesis` used here.
 *
 * `onVoicesChanged` is a subscription rather than the raw event target because
 * `getVoices()` is famously empty on first call and only populates after a
 * `voiceschanged` event on several mobile browsers. That late load is the
 * difference between Hindi narration working and silently not working on half
 * the handsets in the pilot.
 */
export interface SpeechEngine {
  getVoices(): VoiceLike[];
  speak(utterance: UtteranceLike): void;
  cancel(): void;
  /** Subscribe to late voice loading. Returns an unsubscribe function. */
  onVoicesChanged(handler: () => void): () => void;
}

export interface UtteranceFactory {
  (text: string): UtteranceLike;
}

/** What happened when we tried to speak. Every path returns one of these. */
export type NarrationOutcome =
  /** Queued and read aloud. */
  | "spoken"
  /** The trainee turned narration off. */
  | "muted"
  /** The device has no voice for this language. */
  | "no-voice"
  /** No speech synthesis on this device at all. */
  | "unsupported"
  /** There was no instruction to read. */
  | "empty"
  /** The browser refused to speak until the page is interacted with. */
  | "blocked";

/** True when the outcome means "nothing was heard", so the UI can say so. */
export const wasHeard = (outcome: NarrationOutcome): boolean => outcome === "spoken";

/**
 * BCP-47 tag per app locale.
 *
 * Region matters for voice selection: Android ships `hi-IN` and some devices
 * also carry a bare `hi`, and a request for `hi` will happily be answered by an
 * English voice on a handset with no Hindi pack, which is how a Hindi trainee
 * ends up being read an English instruction at speed by an indifferent machine.
 */
export const SPEECH_LANG: Readonly<Record<string, string>> = {
  en: "en-IN",
  hi: "hi-IN",
  sat: "sat-IN",
};

export const speechLangFor = (locale: string): string => SPEECH_LANG[locale] ?? `${locale}-IN`;

/**
 * Pick a voice for a language.
 *
 * Exact tag first, then the base language, then the platform default for that
 * base. Returns `null` when nothing matches, and the caller reports `no-voice`
 * rather than falling back to some other language's voice — reading a Hindi
 * safety instruction aloud in Tamil because it was the only voice present would
 * be worse than silence.
 */
export function pickVoice(voices: readonly VoiceLike[], lang: string): VoiceLike | null {
  const want = lang.toLowerCase();
  const base = want.split("-")[0]!;
  const sameLang = voices.filter((v) => v.lang.toLowerCase().replace("_", "-") === want);
  if (sameLang.length > 0) {
    return sameLang.find((v) => v.default) ?? sameLang[0]!;
  }
  const sameBase = voices.filter((v) => v.lang.toLowerCase().split(/[-_]/)[0] === base);
  if (sameBase.length > 0) {
    return sameBase.find((v) => v.default) ?? sameBase[0]!;
  }
  return null;
}

/**
 * Slightly under default speed.
 *
 * A default-rate voice reads an instruction the way a newsreader reads a
 * headline, and the trainee is looking at objects in a dark bay rather than at
 * the sentence. This is playback rate, not content — it is a dial, not a
 * judgement, and it is the first thing to change if the safety reviewer says
 * otherwise.
 */
const RATE = 0.95;

export interface SpeakOptions {
  locale: string;
  muted?: boolean;
  engine: SpeechEngine;
  createUtterance: UtteranceFactory;
  /**
   * How long to wait for a late voice load before giving up, in ms.
   *
   * Bounded because a browser that never fires `voiceschanged` would otherwise
   * leave the trainee staring at a step with no narration and no explanation.
   */
  voiceTimeoutMs?: number;
  /**
   * Backstop for an engine that never fires `onend`, in ms.
   *
   * Defaults to an estimate from the text length. Exposed so tests can hold the
   * clock down — a suite that spends four seconds proving a timer works is a
   * suite people stop running.
   */
  endFallbackMs?: number;
}

export interface SpeakResult {
  outcome: NarrationOutcome;
  /** The voice used, or `null`. Present in the packet for debugging. */
  voice: string | null;
}

/**
 * Read one piece of text aloud.
 *
 * Always resolves; never throws. A device that cannot speak is a supported
 * device, and the caller gets `unsupported` or `no-voice` to show rather than an
 * exception on a step boundary.
 */
export async function speak(text: string, options: SpeakOptions): Promise<SpeakResult> {
  const { locale, muted, engine, createUtterance, voiceTimeoutMs = 1500 } = options;
  if (muted) return { outcome: "muted", voice: null };

  const trimmed = text.trim();
  if (trimmed === "") return { outcome: "empty", voice: null };

  const lang = speechLangFor(locale);

  // First attempt is synchronous: on most handsets the voice list is already
  // there, and waiting for an event that will not fire would add latency to
  // every single step.
  let voices = engine.getVoices();
  if (voices.length === 0) {
    voices = await waitForVoices(engine, voiceTimeoutMs);
  }

  const voice = pickVoice(voices, lang);
  if (!voice) return { outcome: "no-voice", voice: null };

  return new Promise<SpeakResult>((resolve) => {
    let settled = false;
    const settle = (outcome: NarrationOutcome): void => {
      if (settled) return;
      settled = true;
      resolve({ outcome, voice: voice.name });
    };

    // Cancel first, always. Without this, utterances queue: a trainee who moves
    // briskly through three steps hears step one's instruction while looking at
    // step three, which is worse than not narrating at all because the words
    // belong to the wrong step.
    try {
      engine.cancel();
    } catch {
      // A cancel that throws is not a reason to skip the instruction.
    }

    try {
      const utterance = createUtterance(trimmed);
      utterance.lang = lang;
      utterance.voice = voice;
      utterance.rate = RATE;
      utterance.pitch = 1;
      utterance.onend = () => settle("spoken");
      utterance.onerror = (event) => {
        // `not-allowed` is the browser refusing to speak before the page has
        // been interacted with. The next tap is a gesture, so it resolves
        // itself; the UI shows a prompt rather than pretending it is broken.
        settle(event.error === "not-allowed" ? "blocked" : "no-voice");
      };
      engine.speak(utterance);
    } catch {
      settle("unsupported");
      return;
    }

    // Some engines never fire `onend` — a cancelled utterance on Android can be
    // simply dropped. Without this the promise would never resolve and the
    // trainee's toggle would stay in a permanent "speaking" state.
    setTimeout(() => settle("spoken"), options.endFallbackMs ?? spokenGuessMs(trimmed));
  });
}

/** Resolve once voices arrive, or with an empty list when they never do. */
function waitForVoices(engine: SpeechEngine, timeoutMs: number): Promise<VoiceLike[]> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (voices: VoiceLike[]): void => {
      if (done) return;
      done = true;
      unsubscribe();
      resolve(voices);
    };
    const unsubscribe = engine.onVoicesChanged(() => finish(engine.getVoices()));
    setTimeout(() => finish(engine.getVoices()), timeoutMs);
  });
}

/**
 * How long to believe an utterance is still being read.
 *
 * Used only as a backstop for the `onend` that some engines forget to fire. A
 * generous 40 ms per character at the playback rate above, floored at a second:
 * long enough not to cut a real instruction off, short enough that a dropped
 * `onend` does not leave the UI stuck.
 */
function spokenGuessMs(text: string): number {
  return Math.max(1000, Math.round((text.length * 40) / RATE) + 500);
}

/**
 * The browser's speech synthesis, wrapped.
 *
 * Returns `null` where there is no `window` or no `speechSynthesis`, which is
 * the case in `bun test` and in any browser without support. Callers treat
 * `null` as `unsupported` rather than special-casing the environment.
 */
export function browserEngine(): SpeechEngine | null {
  if (typeof window === "undefined") return null;
  const synth = window.speechSynthesis;
  if (!synth) return null;
  return {
    getVoices: () => synth.getVoices() as unknown as VoiceLike[],
    speak: (utterance) => synth.speak(utterance as unknown as SpeechSynthesisUtterance),
    cancel: () => synth.cancel(),
    onVoicesChanged: (handler) => {
      synth.addEventListener("voiceschanged", handler);
      return () => synth.removeEventListener("voiceschanged", handler);
    },
  };
}

/** The browser's utterance constructor, or `null` where there is none. */
export function browserUtteranceFactory(): UtteranceFactory | null {
  if (typeof window === "undefined" || typeof SpeechSynthesisUtterance === "undefined") {
    return null;
  }
  return (text) => new SpeechSynthesisUtterance(text) as unknown as UtteranceLike;
}

/**
 * Stop whatever is being read.
 *
 * Called when a step changes without narration, and on unmount, so an
 * instruction cannot outlive the step it belongs to.
 */
export function stopSpeaking(engine: SpeechEngine | null): void {
  if (!engine) return;
  try {
    engine.cancel();
  } catch {
    // Nothing to do: a cancel failure means nothing is playing.
  }
}
