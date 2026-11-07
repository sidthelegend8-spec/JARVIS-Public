import { useEffect, useState } from 'react';
import { Check, Eye, EyeOff, KeyRound, Loader2, ExternalLink } from 'lucide-react';
import { GoogleGenAI } from '@google/genai';
import { JarvisSettings } from '../hooks/use-settings';
import type { ApiProviderInfo, ApiToolConfig } from '../hooks/use-apis';

interface Props {
  settings: JarvisSettings;
  onSave: (next: JarvisSettings) => Promise<void>;
  apiTools: ApiToolConfig[];
  apiProviders: ApiProviderInfo[];
  onSaveApiTool: (tool: ApiToolConfig) => Promise<void>;
}

const FIELD =
  'flex-1 min-w-0 bg-black/60 border border-white/20 rounded px-3 py-2 text-[11px] font-mono text-white/90 ' +
  'placeholder:text-white/25 focus:outline-none focus:border-white/60 transition-colors';
const BUTTON =
  'shrink-0 px-3 py-2 border border-white/30 rounded text-[10px] tracking-widest font-display uppercase text-white/70 ' +
  'hover:text-white hover:bg-white/10 transition-colors disabled:opacity-40 flex items-center gap-2';
const LABEL = 'text-[9px] text-white/50 tracking-widest font-display uppercase mb-1.5 flex items-center gap-2';

type Status = { ok: boolean; text: string } | null;

/** "AIza...f3Qk": enough to tell keys apart, never the key itself. */
export function masked(key: string): string {
  const k = key.trim();
  if (!k) return 'not set';
  return k.length <= 8 ? '••••' : `${k.slice(0, 4)}…${k.slice(-4)}`;
}

function KeyField({
  label, value, placeholder, required, help, onSave, onTest
}: {
  label: string;
  value: string;
  placeholder: string;
  required?: boolean;
  help: React.ReactNode;
  onSave: (key: string) => Promise<void>;
  onTest?: (key: string) => Promise<string>;
}) {
  const [draft, setDraft] = useState(value);
  const [shown, setShown] = useState(false);
  const [status, setStatus] = useState<Status>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => setDraft(value), [value]);
  const changed = draft.trim() !== value.trim();

  const save = async () => {
    setBusy(true);
    setStatus(null);
    try {
      await onSave(draft.trim());
      setStatus({ ok: true, text: draft.trim() ? 'Saved.' : 'Removed.' });
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    if (!onTest) return;
    setBusy(true);
    setStatus(null);
    try {
      setStatus({ ok: true, text: await onTest(draft.trim()) });
    } catch (e: any) {
      setStatus({ ok: false, text: e?.message || 'That key did not work.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="border border-white/15 rounded-lg bg-black/40 px-4 py-4">
      <div className={LABEL}>
        <KeyRound className="w-3 h-3" aria-hidden="true" />
        {label}
        <span className={required ? 'text-amber-300/80' : 'text-white/30'}>{required ? 'required' : 'optional'}</span>
        <span className="ml-auto font-mono normal-case tracking-normal text-white/40">{masked(value)}</span>
      </div>
      <div className="flex gap-2">
        <input
          type={shown ? 'text' : 'password'}
          value={draft}
          onChange={(e) => { setDraft(e.target.value); setStatus(null); }}
          placeholder={placeholder}
          className={FIELD}
          spellCheck={false}
          autoComplete="off"
          aria-label={label}
        />
        <button onClick={() => setShown(!shown)} className={BUTTON} aria-label={shown ? 'Hide key' : 'Show key'}>
          {shown ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
        </button>
        {onTest && (
          <button onClick={test} disabled={busy || !draft.trim()} className={BUTTON}>
            {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : null}Test
          </button>
        )}
        <button onClick={save} disabled={busy || !changed} className={BUTTON}>
          <Check className="w-3 h-3" />Save
        </button>
      </div>
      {status && (
        <p role="status" className={`text-[10px] font-mono mt-2 ${status.ok ? 'text-emerald-300/90' : 'text-red-300/90'}`}>
          {status.text}
        </p>
      )}
      <div className="text-[9px] text-white/35 font-mono mt-2 leading-relaxed">{help}</div>
    </div>
  );
}

async function testGeminiKey(key: string): Promise<string> {
  const ai = new GoogleGenAI({ apiKey: key });
  const pager = await ai.models.list({ config: { pageSize: 50 } });
  const names = pager.page.map((m: any) => String(m.name || ''));
  const live = names.some((n) => n.includes('live') || n.includes('native-audio'));
  return `This key works${live ? ', and it can use the Live voice models' : ''}. Save it to use it.`;
}

async function testMem0Key(key: string): Promise<string> {
  const res = await fetch('/api/mem0/ping', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ apiKey: key })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'mem0 did not accept that key.');
  return 'This key works. Save it to use it.';
}

export default function KeysTab({ settings, onSave, apiTools, apiProviders, onSaveApiTool }: Props) {
  const keyed = apiTools.filter((tool) => apiProviders.find((p) => p.id === tool.provider)?.requiresKey !== false);

  return (
    <div className="w-full max-w-3xl h-full max-h-[70vh] px-4 flex flex-col">
      <div className="border border-white/20 bg-black/50 backdrop-blur-sm rounded-lg shadow-[0_0_15px_rgba(255,255,255,0.05)] flex flex-col overflow-hidden h-full">
        <div className="text-[10px] text-white/70 tracking-widest px-4 py-3 border-b border-white/20 font-display flex justify-between items-center shrink-0">
          <span>SYS // KEYS</span>
          <span className="text-white/40">{settings.geminiKey ? 'GEMINI READY' : 'GEMINI KEY NEEDED'}</span>
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar px-4 py-4 space-y-4">
          <KeyField
            label="Gemini API Key"
            value={settings.geminiKey}
            placeholder="Paste your Gemini key"
            required
            onSave={(key) => onSave({ ...settings, geminiKey: key })}
            onTest={testGeminiKey}
            help={
              <>
                Powers the voice, screen reading, memory and research. Free from Google AI Studio:{' '}
                <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-white inline-flex items-center gap-1">
                  aistudio.google.com/apikey <ExternalLink className="w-2.5 h-2.5" aria-hidden="true" />
                </a>
              </>
            }
          />

          <KeyField
            label="mem0 API Key"
            value={settings.mem0Key}
            placeholder="m0-... (leave blank for local memory only)"
            onSave={(key) => onSave({ ...settings, mem0Key: key })}
            onTest={testMem0Key}
            help="Adds cloud recall on top of the local memory. Memory works without it."
          />

          <div className="border border-white/15 rounded-lg bg-black/40 px-4 py-4">
            <div className={LABEL}>
              <KeyRound className="w-3 h-3" aria-hidden="true" />
              Connected API keys
              <span className="ml-auto font-mono normal-case tracking-normal text-white/40">{keyed.length}</span>
            </div>
            {keyed.length === 0 ? (
              <p className="text-[10px] text-white/40 font-mono leading-relaxed">
                Services you connect in the API tab (weather, web search and so on) keep their keys here too.
              </p>
            ) : (
              <div className="space-y-3">
                {keyed.map((tool) => {
                  const provider = apiProviders.find((p) => p.id === tool.provider);
                  return (
                    <KeyField
                      key={tool.id}
                      label={`${tool.name}${provider ? ` · ${provider.label}` : ''}`}
                      value={tool.apiKey || ''}
                      placeholder={provider?.keyHint || 'API key'}
                      onSave={(key) => onSaveApiTool({ ...tool, apiKey: key })}
                      help="Used only for this connection's requests."
                    />
                  );
                })}
              </div>
            )}
          </div>

          <p className="text-[9px] text-white/35 font-mono leading-relaxed">
            Keys are saved only on this PC, in your Windows profile folder (%APPDATA%\JARVIS-Public), and are sent only to
            their own service. Nothing is built into the app: every user brings their own.
          </p>
        </div>
      </div>
    </div>
  );
}
