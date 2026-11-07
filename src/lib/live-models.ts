/**
 * The voice engines, newest first. Each one falls back to the next if it will
 * not open a session (a model withdrawn, or not available on this key):
 *
 *   Gemini 3.8 Live  ->  Gemini 3.1 Flash Live  ->  Gemini 2.5 native audio
 *
 * 3.x engines send the microphone as `audio` and look things up through the
 * web_search tool (web-search.ts), because some keys are refused Google Search
 * inside a 3.x session. 2.5 takes the older `media` field and has Google
 * Search built in. 3.8 runs tools in the background unless they are marked
 * BLOCKING, and he would answer before the result arrived, so they are.
 */

export type LiveEngine = 'newest' | 'fast' | 'classic';

export const NEWEST_MODEL = 'gemini-3.8-live';
export const FAST_MODEL = 'gemini-3.1-flash-live-preview';
export const CLASSIC_DEFAULT_MODEL = 'gemini-2.5-flash-native-audio-preview-12-2025';

export const ENGINE_LABEL: Record<LiveEngine, string> = {
  newest: 'Gemini 3.8 Live',
  fast: 'Gemini 3.1 Flash Live',
  classic: 'Gemini 2.5'
};

export interface LiveProfile {
  engine: LiveEngine;
  model: string;
  /** How microphone audio goes over the wire. */
  micField: 'media' | 'audio';
  /** Google's built-in Search tool in the session. */
  builtInSearch: boolean;
  /** A web_search tool answered through a short 2.5 session. */
  searchHelper: boolean;
  /** Tools are declared BLOCKING, so he waits for their results before speaking. */
  blockingTools: boolean;
  /** Engine to retry with when this one will not open a session. */
  fallback: LiveEngine | null;
}

export function liveProfile(engine: LiveEngine, classicModel: string, newestModel: string = NEWEST_MODEL): LiveProfile {
  if (engine === 'newest') {
    return { engine, model: newestModel || NEWEST_MODEL, micField: 'audio', builtInSearch: false, searchHelper: true,
             blockingTools: true, fallback: 'fast' };
  }
  if (engine === 'fast') {
    return { engine, model: FAST_MODEL, micField: 'audio', builtInSearch: false, searchHelper: true,
             blockingTools: false, fallback: 'classic' };
  }
  return {
    engine: 'classic',
    model: classicModel || CLASSIC_DEFAULT_MODEL,
    micField: 'media',
    builtInSearch: true,
    searchHelper: false,
    blockingTools: false,
    fallback: null
  };
}

/** The engines tried, in order, starting from the chosen one. */
export function engineChain(start: LiveEngine): LiveEngine[] {
  const chain: LiveEngine[] = [];
  let engine: LiveEngine | null = start;
  while (engine && !chain.includes(engine)) {
    chain.push(engine);
    engine = liveProfile(engine, '').fallback;
  }
  return chain;
}

/** The sendRealtimeInput argument for one chunk of 16 kHz microphone audio. */
export function realtimeAudio(profile: LiveProfile, base64: string) {
  const blob = { mimeType: 'audio/pcm;rate=16000', data: base64 };
  return profile.micField === 'audio' ? { audio: blob } : { media: blob };
}
