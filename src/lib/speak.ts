/**
 * Short spoken lines when there is no live Gemini session to speak them, using
 * Windows' own voices through the Web Speech API. Works offline.
 */

export interface VoiceLike {
  name: string;
  lang: string;
}

const isLang = (voice: VoiceLike, prefix: string) =>
  voice.lang.replace('_', '-').toLowerCase().startsWith(prefix);

/**
 * J.A.R.V.I.S. is British: George (Windows' UK male voice) when installed,
 * then any UK voice, then David (US male), then any English voice, then
 * whatever there is.
 */
export function pickVoice<V extends VoiceLike>(voices: V[]): V | null {
  const choices: Array<(v: V) => boolean> = [
    (v) => /george/i.test(v.name) && isLang(v, 'en-gb'),
    (v) => isLang(v, 'en-gb'),
    (v) => /david/i.test(v.name),
    (v) => isLang(v, 'en')
  ];
  for (const choose of choices) {
    const found = voices.find(choose);
    if (found) return found;
  }
  return voices[0] ?? null;
}

/** The voice list arrives asynchronously the first time it is asked for. */
function loadVoices(synth: SpeechSynthesis): Promise<SpeechSynthesisVoice[]> {
  const ready = synth.getVoices();
  if (ready.length > 0) return Promise.resolve(ready);
  return new Promise((resolve) => {
    const done = () => {
      synth.removeEventListener('voiceschanged', done);
      resolve(synth.getVoices());
    };
    synth.addEventListener('voiceschanged', done);
    // Some systems never fire the event; speak with the default voice then.
    window.setTimeout(done, 1500);
  });
}

export async function speak(text: string): Promise<void> {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
  const synth = window.speechSynthesis;
  const utterance = new SpeechSynthesisUtterance(text);
  const voice = pickVoice(await loadVoices(synth));
  if (voice) {
    utterance.voice = voice;
    utterance.lang = voice.lang;
  }
  utterance.rate = 0.95;
  utterance.pitch = 0.9;
  synth.speak(utterance);
}
