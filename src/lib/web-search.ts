import { GoogleGenAI, Modality } from '@google/genai';

/**
 * Looking something up for the Fast engine.
 *
 * On this plan Google's built-in Search is refused to Gemini 3.x and to every
 * text model; only the Classic native-audio model may use it. So a lookup
 * opens a short Classic session with Search, asks the question, and reads
 * back the transcript of its spoken answer. Measured on 2026-10-19: 4.4-5.4 s.
 */

const TIMEOUT_MS = 15_000;
// The answer's words arrive about as fast as they would be spoken; a sentence
// end followed by this much quiet is the end of a short factual answer.
const QUIET_AFTER_SENTENCE_MS = 700;

const INSTRUCTION =
  'Use Google Search to answer. Reply with the bare facts in at most 25 words. ' +
  'No greeting, no preamble. Give numbers, names and dates exactly.';

export function searchWeb(apiKey: string, classicModel: string, query: string): Promise<string> {
  return new Promise((resolve, reject) => {
    let answer = '';
    let session: any = null;
    let settled = false;
    let quiet: ReturnType<typeof setTimeout> | undefined;

    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(quiet);
      try {
        session?.close?.();
      } catch {
        /* already closed */
      }
      if (answer.trim()) resolve(answer.trim());
      else reject(error ?? new Error('the search returned nothing'));
    };
    const timer = setTimeout(() => finish(new Error('the search took too long')), TIMEOUT_MS);

    new GoogleGenAI({ apiKey }).live
      .connect({
        model: classicModel,
        config: {
          responseModalities: [Modality.AUDIO],
          outputAudioTranscription: {},
          tools: [{ googleSearch: {} }],
          systemInstruction: { parts: [{ text: INSTRUCTION }] }
        },
        callbacks: {
          onmessage: (message: any) => {
            const text = message.serverContent?.outputTranscription?.text;
            if (text) {
              answer += text;
              clearTimeout(quiet);
              if (/[.!?]\s*$/.test(answer)) quiet = setTimeout(() => finish(), QUIET_AFTER_SENTENCE_MS);
            }
            if (message.serverContent?.turnComplete) finish();
          },
          onerror: (e: any) => finish(new Error(e?.message || 'search session error')),
          onclose: () => finish()
        }
      } as any)
      .then((s: any) => {
        session = s;
        s.sendClientContent({ turns: [{ role: 'user', parts: [{ text: query }] }], turnComplete: true });
      })
      .catch((e: any) => finish(new Error(e?.message || 'could not open a search session')));
  });
}
