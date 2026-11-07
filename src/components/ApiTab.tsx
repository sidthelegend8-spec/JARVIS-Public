import { useState } from 'react';
import { motion } from 'motion/react';
import { Plus, Trash2, Pencil, Loader2, Play } from 'lucide-react';
import { ApiToolConfig, ApiProviderInfo } from '../hooks/use-apis';
import Toggle from './Toggle';

interface Props {
  tools: ApiToolConfig[];
  providers: ApiProviderInfo[];
  enabledCount: number;
  onSave: (tool: ApiToolConfig) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
  onSetEnabled: (id: string, enabled: boolean) => Promise<void>;
  onTest: (
    provider: string,
    apiKey: string,
    args: Record<string, string>
  ) => Promise<{ isError: boolean; text: string; status: number }>;
}

const FIELD =
  'w-full bg-black/60 border border-white/20 rounded px-3 py-2 text-[11px] font-mono text-white/90 ' +
  'placeholder:text-white/25 focus:outline-none focus:border-white/60 transition-colors';

const LABEL = 'text-[9px] text-white/50 tracking-widest font-display uppercase mb-1.5 block';

interface Draft {
  id?: string;
  provider: string;
  name: string;
  apiKey: string;
}

export default function ApiTab({
  tools,
  providers,
  enabledCount,
  onSave,
  onRemove,
  onSetEnabled,
  onTest
}: Props) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [testArgs, setTestArgs] = useState<Record<string, string>>({});
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [testing, setTesting] = useState(false);

  const selected = providers.find((p) => p.id === draft?.provider);
  const providerOf = (id: string) => providers.find((p) => p.id === id);

  const openDraft = (tool?: ApiToolConfig) => {
    setDraft(
      tool
        ? { id: tool.id, provider: tool.provider, name: tool.name, apiKey: tool.apiKey || '' }
        : { provider: providers[0]?.id || '', name: providers[0]?.label.split(' —')[0] || '', apiKey: '' }
    );
    setTestArgs({});
    setTestResult(null);
  };

  const closeDraft = () => {
    setDraft(null);
    setTestResult(null);
  };

  const pickProvider = (id: string) => {
    const provider = providerOf(id);
    setDraft((d) =>
      d ? { ...d, provider: id, name: provider ? provider.label.split(' —')[0] : d.name } : d
    );
    setTestArgs({});
    setTestResult(null);
  };

  const runTest = async () => {
    if (!draft) return;
    setTesting(true);
    setTestResult(null);
    try {
      const result = await onTest(draft.provider, draft.apiKey, testArgs);
      setTestResult({ ok: !result.isError, text: result.text });
    } catch (e: any) {
      setTestResult({ ok: false, text: e?.message || 'Request failed' });
    } finally {
      setTesting(false);
    }
  };

  const canSave =
    draft && draft.provider && draft.name.trim() && (!selected?.requiresKey || draft.apiKey.trim());

  const save = async () => {
    if (!draft || !canSave) return;
    await onSave({
      id: draft.id || `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      provider: draft.provider,
      name: draft.name.trim(),
      apiKey: draft.apiKey.trim() || undefined,
      enabled: true
    });
    closeDraft();
  };

  return (
    <div className="w-full max-w-3xl h-full max-h-[70vh] px-4 flex flex-col">
      <div className="border border-white/20 bg-black/50 backdrop-blur-sm rounded-lg shadow-[0_0_15px_rgba(255,255,255,0.05)] flex flex-col overflow-hidden h-full">
        <div className="text-[10px] text-white/70 tracking-widest px-4 py-3 border-b border-white/20 font-display flex justify-between items-center shrink-0">
          <span>SYS // API_LINKS</span>
          <div className="flex items-center gap-4">
            <span className="text-white/40">
              {tools.length} {tools.length === 1 ? 'API' : 'APIS'} · {enabledCount} ACTIVE
            </span>
            <button
              onClick={() => (draft ? closeDraft() : openDraft())}
              title={draft ? 'Close' : 'Connect an API'}
              className="text-white/50 hover:text-white transition-colors"
            >
              <Plus className={`w-3.5 h-3.5 transition-transform ${draft ? 'rotate-45' : ''}`} />
            </button>
          </div>
        </div>

        {draft && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="border-b border-white/20 bg-black/40 px-4 py-4 space-y-3 shrink-0"
          >
            <div>
              <label className={LABEL}>Service</label>
              <select
                value={draft.provider}
                onChange={(e) => pickProvider(e.target.value)}
                className={FIELD}
                disabled={Boolean(draft.id)}
              >
                {providers.map((p) => (
                  <option key={p.id} value={p.id} className="bg-black">
                    {p.label}
                  </option>
                ))}
              </select>
              {selected && (
                <p className="text-[9px] text-white/30 font-mono mt-1.5 leading-relaxed">
                  {selected.description}
                </p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={LABEL}>Name</label>
                <input
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  placeholder="web search"
                  className={FIELD}
                  spellCheck={false}
                />
              </div>
              <div>
                <label className={LABEL}>
                  API Key {selected && !selected.requiresKey && '— not needed'}
                </label>
                <input
                  type="password"
                  value={draft.apiKey}
                  onChange={(e) => setDraft({ ...draft, apiKey: e.target.value })}
                  placeholder={selected?.requiresKey ? selected.keyHint || 'your key' : 'none required'}
                  disabled={selected ? !selected.requiresKey : false}
                  className={`${FIELD} disabled:opacity-40`}
                  spellCheck={false}
                />
              </div>
            </div>

            {selected && selected.params.length > 0 && (
              <div className="flex items-end gap-2 border-t border-white/10 pt-3">
                {selected.params.map((param) => (
                  <div key={param} className="flex-1">
                    <label className={LABEL}>{param}</label>
                    <input
                      value={testArgs[param] || ''}
                      onChange={(e) => setTestArgs({ ...testArgs, [param]: e.target.value })}
                      placeholder="test value"
                      className={FIELD}
                    />
                  </div>
                ))}
                <button
                  onClick={runTest}
                  disabled={testing}
                  className="px-4 py-2 text-[10px] tracking-widest font-display uppercase border border-white/30 rounded text-white/70 hover:text-white hover:bg-white/10 transition-colors disabled:opacity-40 flex items-center gap-2 shrink-0"
                >
                  {testing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
                  Test
                </button>
              </div>
            )}

            {testResult && (
              <pre
                className={`text-[9px] font-mono p-2.5 rounded border max-h-28 overflow-y-auto custom-scrollbar whitespace-pre-wrap break-words ${
                  testResult.ok
                    ? 'border-emerald-400/30 bg-emerald-400/5 text-emerald-100/80'
                    : 'border-red-400/30 bg-red-400/5 text-red-200/80'
                }`}
              >
                {testResult.text}
              </pre>
            )}

            <div className="flex justify-end gap-3 pt-1">
              <button
                onClick={closeDraft}
                className="px-4 py-2 text-[10px] tracking-widest font-display uppercase text-white/50 hover:text-white transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={save}
                disabled={!canSave}
                className="px-5 py-2 text-[10px] tracking-widest font-display uppercase border border-white/40 rounded text-white hover:bg-white/10 transition-colors disabled:opacity-40"
              >
                Save
              </button>
            </div>
          </motion.div>
        )}

        <div className="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-3">
          {tools.length === 0 && !draft && (
            <div className="text-white/30 italic text-[10px] font-mono text-center py-12">
              No APIs connected. Use + to add one.
            </div>
          )}

          {tools.map((tool) => {
            const provider = providerOf(tool.provider);
            return (
              <div
                key={tool.id}
                className={`border border-white/15 rounded bg-black/40 transition-opacity ${tool.enabled ? '' : 'opacity-50'}`}
              >
                <div className="flex items-center gap-3 px-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="text-[11px] font-mono text-white/90 truncate">{tool.name}</div>
                    <div className="text-[9px] font-mono text-white/35 truncate">
                      {provider?.label || tool.provider}
                    </div>
                  </div>

                  <div
                    className={`text-[9px] tracking-widest font-display shrink-0 ${tool.enabled ? 'text-emerald-400' : 'text-white/30'}`}
                  >
                    {tool.enabled ? 'ACTIVE' : 'DISABLED'}
                  </div>

                  <Toggle checked={tool.enabled} onChange={(next) => onSetEnabled(tool.id, next)} />

                  <button
                    onClick={() => openDraft(tool)}
                    title="Edit"
                    className="text-white/40 hover:text-white transition-colors shrink-0"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => onRemove(tool.id)}
                    title="Delete"
                    className="text-white/40 hover:text-red-400 transition-colors shrink-0"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        <div className="border-t border-white/20 px-4 py-2.5 text-[9px] font-mono text-white/30 shrink-0">
          Active APIs are offered to J.A.R.V.I.S. on the next connection. Reconnect the mic to pick up changes.
        </div>
      </div>
    </div>
  );
}
