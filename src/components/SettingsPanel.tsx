import { useState } from 'react';
import { motion } from 'motion/react';
import { X, Check, Eye, Loader2 } from 'lucide-react';
import { JarvisSettings } from '../hooks/use-settings';
import { CLASSIC_DEFAULT_MODEL, FAST_MODEL, LiveEngine, NEWEST_MODEL } from '../lib/live-models';

interface Props {
  settings: JarvisSettings;
  onSave: (next: JarvisSettings) => Promise<void>;
  onTestVision: (question: string) => Promise<string>;
  onOpenKeys: () => void;
  onClose: () => void;
}

const FIELD_CLASS =
  'w-full bg-black/60 border border-white/20 rounded px-3 py-2 text-[11px] font-mono text-white/90 ' +
  'placeholder:text-white/25 focus:outline-none focus:border-white/60 transition-colors';

const LABEL_CLASS = 'text-[9px] text-white/50 tracking-widest font-display uppercase mb-1.5 block';

// Voices offered by the Gemini Live API. Charon is the deepest male voice and
// carries the British butler register best; Orus is the nearest alternative.
const VOICES = ['Charon', 'Orus', 'Fenrir', 'Puck', 'Kore', 'Aoede', 'Leda', 'Zephyr'];

const ENGINES: Array<{ id: LiveEngine; title: string; model: string; note: string }> = [
  { id: 'newest', title: '3.8 LIVE', model: NEWEST_MODEL, note: 'Newest and quickest. Recommended.' },
  { id: 'fast', title: '3.1 FLASH', model: FAST_MODEL, note: 'Quick replies; web lookups take a few seconds.' },
  { id: 'classic', title: '2.5', model: CLASSIC_DEFAULT_MODEL, note: 'Built-in Google Search, slower replies.' }
];

export default function SettingsPanel({ settings, onSave, onTestVision, onOpenKeys, onClose }: Props) {
  const [draft, setDraft] = useState<JarvisSettings>(settings);
  const [isSaved, setIsSaved] = useState(false);
  const [vision, setVision] = useState<{ ok: boolean; text: string } | null>(null);
  const [testingVision, setTestingVision] = useState(false);
  const hasKey = Boolean(settings.geminiKey);

  // Save first, so the test uses the model currently typed in rather than the
  // one that was saved earlier.
  const testVision = async () => {
    setTestingVision(true);
    setVision(null);
    try {
      await onSave(draft);
      const answer = await onTestVision('What is on this screen?');
      setVision({ ok: true, text: answer });
    } catch (e: any) {
      setVision({ ok: false, text: e?.message || 'Failed' });
    } finally {
      setTestingVision(false);
    }
  };

  const update = <K extends keyof JarvisSettings>(key: K, value: JarvisSettings[K]) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
    setIsSaved(false);
  };

  const handleSave = async () => {
    await onSave({ ...draft, homeCity: draft.homeCity.trim() });
    setIsSaved(true);
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.96, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.15 }}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg max-h-[88vh] overflow-y-auto custom-scrollbar border border-white/20 bg-black/90 rounded-lg shadow-[0_0_40px_rgba(255,255,255,0.08)] p-6"
      >
        <div className="flex justify-between items-center border-b border-white/20 pb-2 mb-5">
          <span className="text-[10px] text-white/70 tracking-widest font-display uppercase">
            SYS // CONFIGURATION
          </span>
          <button onClick={onClose} aria-label="Close settings" className="text-white/40 hover:text-white transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-5">
          <div className={`rounded border px-3 py-2.5 text-[10px] font-mono leading-relaxed ${hasKey ? 'border-white/15 text-white/50' : 'border-amber-400/40 text-amber-200/80 bg-amber-400/5'}`}>
            {hasKey ? 'Your API keys live in the KEYS tab.' : 'Add your Gemini API key in the KEYS tab to start.'}{' '}
            <button onClick={onOpenKeys} className="underline underline-offset-2 hover:text-white">Open Keys</button>
          </div>

          <div>
            <label className={LABEL_CLASS}>Voice Engine</label>
            <div role="radiogroup" aria-label="Voice engine" className="grid grid-cols-3 gap-2">
              {ENGINES.map((engine) => {
                const selected = draft.liveEngine === engine.id;
                return (
                  <button
                    key={engine.id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => update('liveEngine', engine.id)}
                    className={`text-left rounded border px-3 py-2 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/70 ${
                      selected ? 'border-white/70 bg-white/10' : 'border-white/20 hover:border-white/40'
                    }`}
                  >
                    <span className={`block text-[10px] tracking-widest font-display ${selected ? 'text-white' : 'text-white/60'}`}>
                      {engine.title}
                    </span>
                    <span className="block text-[9px] font-mono text-white/30 mt-1 leading-snug">{engine.note}</span>
                  </button>
                );
              })}
            </div>
            <p className="text-[9px] text-white/30 font-mono mt-1.5">
              If the chosen engine will not start, J.A.R.V.I.S. moves down the list by himself: 3.8, then 3.1, then 2.5.
            </p>
          </div>

          <div>
            <label className={LABEL_CLASS}>Voice</label>
            <select
              value={draft.voiceName}
              onChange={(e) => update('voiceName', e.target.value)}
              className={FIELD_CLASS}
            >
              {VOICES.map((v) => (
                <option key={v} value={v} className="bg-black">
                  {v}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className={LABEL_CLASS}>Home City — optional, for the HUD weather</label>
            <input
              value={draft.homeCity}
              onChange={(e) => update('homeCity', e.target.value)}
              placeholder="London"
              className={FIELD_CLASS}
              spellCheck={false}
            />
          </div>

          <div className="border-t border-white/10 pt-5">
            <label className={LABEL_CLASS}>3.8 Model</label>
            <input
              value={draft.newestModel}
              onChange={(e) => update('newestModel', e.target.value)}
              className={FIELD_CLASS}
              spellCheck={false}
            />
            <p className="text-[9px] text-white/30 font-mono mt-1.5">
              Change only if Google renames it. If it will not start, he moves to 3.1 by himself.
            </p>
          </div>

          <div>
            <label className={LABEL_CLASS}>2.5 Model</label>
            <input
              value={draft.liveModel}
              onChange={(e) => update('liveModel', e.target.value)}
              className={FIELD_CLASS}
              spellCheck={false}
            />
            <p className="text-[9px] text-white/30 font-mono mt-1.5">
              Used by the 2.5 engine, and for web lookups on 3.8 and 3.1. Must be a native-audio Live model.
            </p>
          </div>

          <div>
            <label className={LABEL_CLASS}>Vision &amp; Memory Model — reads the screen, distils facts</label>
            <div className="flex gap-2">
              <input
                value={draft.extractModel}
                onChange={(e) => update('extractModel', e.target.value)}
                className={FIELD_CLASS}
                spellCheck={false}
              />
              <button
                onClick={testVision}
                disabled={testingVision || !hasKey}
                title={hasKey ? 'Screenshot this screen and describe it' : 'Add your Gemini key in the Keys tab first'}
                className="shrink-0 px-3 border border-white/30 rounded text-[10px] tracking-widest font-display uppercase text-white/70 hover:text-white hover:bg-white/10 transition-colors disabled:opacity-40 flex items-center gap-2"
              >
                {testingVision ? <Loader2 className="w-3 h-3 animate-spin" /> : <Eye className="w-3 h-3" />}
                Test
              </button>
            </div>
            {vision && (
              <pre
                className={`text-[9px] font-mono mt-2 p-2.5 rounded border max-h-28 overflow-y-auto custom-scrollbar whitespace-pre-wrap break-words ${
                  vision.ok
                    ? 'border-emerald-400/30 bg-emerald-400/5 text-emerald-100/80'
                    : 'border-red-400/30 bg-red-400/5 text-red-200/80'
                }`}
              >
                {vision.text}
              </pre>
            )}
          </div>
        </div>

        <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-white/20">
          <button
            onClick={onClose}
            className="px-4 py-2 text-[10px] tracking-widest font-display uppercase text-white/50 hover:text-white transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="px-5 py-2 text-[10px] tracking-widest font-display uppercase border border-white/40 rounded text-white hover:bg-white/10 transition-colors flex items-center gap-2"
          >
            {isSaved ? (
              <>
                <Check className="w-3 h-3" /> Saved
              </>
            ) : (
              'Save'
            )}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
