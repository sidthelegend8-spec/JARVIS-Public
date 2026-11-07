import { useState } from 'react';
import { motion } from 'motion/react';
import { Plus, Trash2, RefreshCw, Loader2, ChevronDown, ChevronRight, Pencil, Check, Lock } from 'lucide-react';
import { McpServerConfig, McpServerState, McpTransport } from '../hooks/use-mcp';
import Toggle from './Toggle';

interface Props {
  servers: McpServerState[];
  toolCount: number;
  onAdd: (input: Omit<McpServerConfig, 'id' | 'enabled'>) => Promise<unknown>;
  onRemove: (id: string) => Promise<void>;
  onReconnect: (id: string) => Promise<unknown>;
  onSetEnabled: (id: string, enabled: boolean) => Promise<void>;
  onRename: (id: string, label: string) => Promise<void>;
}

const FIELD_CLASS =
  'w-full bg-black/60 border border-white/20 rounded px-3 py-2 text-[11px] font-mono text-white/90 ' +
  'placeholder:text-white/25 focus:outline-none focus:border-white/60 transition-colors';

const LABEL_CLASS = 'text-[9px] text-white/50 tracking-widest font-display uppercase mb-1.5 block';

const STATUS_STYLE: Record<McpServerState['status'], string> = {
  connected: 'text-emerald-400',
  connecting: 'text-white/50',
  error: 'text-red-400',
  disabled: 'text-white/30'
};

export default function McpTab({
  servers,
  toolCount,
  onAdd,
  onRemove,
  onReconnect,
  onSetEnabled,
  onRename
}: Props) {
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [draft, setDraft] = useState({
    label: '',
    url: '',
    transport: 'auto' as McpTransport,
    authHeader: '',
    authValue: ''
  });

  const submit = async () => {
    if (!draft.url.trim()) return;
    setBusy(true);
    try {
      await onAdd({
        label: draft.label.trim() || new URL(draft.url.trim()).host,
        url: draft.url.trim(),
        transport: draft.transport,
        authHeader: draft.authHeader.trim() || undefined,
        authValue: draft.authValue.trim() || undefined
      });
      setDraft({ label: '', url: '', transport: 'auto', authHeader: '', authValue: '' });
      setShowForm(false);
    } catch (e) {
      console.error('Failed to add MCP server', e);
    } finally {
      setBusy(false);
    }
  };

  const commitRename = async (id: string) => {
    await onRename(id, editValue);
    setEditingId(null);
  };

  return (
    <div className="w-full max-w-3xl h-full max-h-[70vh] px-4 flex flex-col">
      <div className="border border-white/20 bg-black/50 backdrop-blur-sm rounded-lg shadow-[0_0_15px_rgba(255,255,255,0.05)] flex flex-col overflow-hidden h-full">
        <div className="text-[10px] text-white/70 tracking-widest px-4 py-3 border-b border-white/20 font-display flex justify-between items-center shrink-0">
          <span>SYS // MCP_LINKS</span>
          <div className="flex items-center gap-4">
            <span className="text-white/40">
              {servers.length} {servers.length === 1 ? 'SERVER' : 'SERVERS'} · {toolCount} TOOLS
            </span>
            <button
              onClick={() => setShowForm((v) => !v)}
              title="Add server"
              className="text-white/50 hover:text-white transition-colors"
            >
              <Plus className={`w-3.5 h-3.5 transition-transform ${showForm ? 'rotate-45' : ''}`} />
            </button>
          </div>
        </div>

        {showForm && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            className="border-b border-white/20 bg-black/40 px-4 py-4 space-y-3 shrink-0"
          >
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2">
                <label className={LABEL_CLASS}>Server URL</label>
                <input
                  value={draft.url}
                  onChange={(e) => setDraft({ ...draft, url: e.target.value })}
                  placeholder="https://example.com/mcp"
                  className={FIELD_CLASS}
                  spellCheck={false}
                />
              </div>
              <div>
                <label className={LABEL_CLASS}>Transport</label>
                <select
                  value={draft.transport}
                  onChange={(e) => setDraft({ ...draft, transport: e.target.value as McpTransport })}
                  className={FIELD_CLASS}
                >
                  <option value="auto" className="bg-black">auto</option>
                  <option value="http" className="bg-black">streamable http</option>
                  <option value="sse" className="bg-black">sse</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className={LABEL_CLASS}>Name</label>
                <input
                  value={draft.label}
                  onChange={(e) => setDraft({ ...draft, label: e.target.value })}
                  placeholder="optional"
                  className={FIELD_CLASS}
                  spellCheck={false}
                />
              </div>
              <div>
                <label className={LABEL_CLASS}>Auth Header</label>
                <input
                  value={draft.authHeader}
                  onChange={(e) => setDraft({ ...draft, authHeader: e.target.value })}
                  placeholder="Authorization"
                  className={FIELD_CLASS}
                  spellCheck={false}
                />
              </div>
              <div>
                <label className={LABEL_CLASS}>Auth Value</label>
                <input
                  type="password"
                  value={draft.authValue}
                  onChange={(e) => setDraft({ ...draft, authValue: e.target.value })}
                  placeholder="Bearer ..."
                  className={FIELD_CLASS}
                  spellCheck={false}
                />
              </div>
            </div>

            <div className="flex justify-end">
              <button
                onClick={submit}
                disabled={busy || !draft.url.trim()}
                className="px-5 py-2 text-[10px] tracking-widest font-display uppercase border border-white/40 rounded text-white hover:bg-white/10 transition-colors disabled:opacity-40 flex items-center gap-2"
              >
                {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
                Connect
              </button>
            </div>
          </motion.div>
        )}

        <div className="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-3">
          {servers.length === 0 && (
            <div className="text-white/30 italic text-[10px] font-mono text-center py-12">
              No MCP servers linked. Use + to connect one.
            </div>
          )}

          {servers.map((server) => {
            const isOpen = expanded[server.id];
            const isDisabled = server.status === 'disabled';
            return (
              <div
                key={server.id}
                className={`border border-white/15 rounded bg-black/40 transition-opacity ${isDisabled ? 'opacity-50' : ''}`}
              >
                <div className="flex items-center gap-3 px-3 py-2.5">
                  <button
                    onClick={() => setExpanded((p) => ({ ...p, [server.id]: !p[server.id] }))}
                    className="text-white/40 hover:text-white transition-colors shrink-0"
                    title={isOpen ? 'Collapse' : 'Expand'}
                  >
                    {isOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                  </button>

                  <div className="min-w-0 flex-1">
                    {editingId === server.id ? (
                      <input
                        autoFocus
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onBlur={() => commitRename(server.id)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') commitRename(server.id);
                          if (e.key === 'Escape') setEditingId(null);
                        }}
                        className="w-full bg-black/60 border border-white/40 rounded px-2 py-1 text-[11px] font-mono text-white/90 focus:outline-none"
                        spellCheck={false}
                      />
                    ) : (
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] font-mono text-white/90 truncate">{server.label}</span>
                        <button
                          onClick={() => {
                            setEditingId(server.id);
                            setEditValue(server.label);
                          }}
                          title="Rename"
                          className="text-white/25 hover:text-white transition-colors shrink-0"
                        >
                          <Pencil className="w-3 h-3" />
                        </button>
                      </div>
                    )}
                    <div className="text-[9px] font-mono text-white/35 truncate">{server.url}</div>
                  </div>

                  <div className={`text-[9px] tracking-widest font-display shrink-0 ${STATUS_STYLE[server.status]}`}>
                    {server.status === 'connecting' ? 'LINKING' : server.status.toUpperCase()}
                    {server.status === 'connected' && ` · ${server.tools.length}`}
                  </div>

                  <Toggle
                    checked={!isDisabled}
                    onChange={(next) => onSetEnabled(server.id, next)}
                  />

                  <button
                    onClick={() => onReconnect(server.id)}
                    title="Reconnect"
                    disabled={isDisabled}
                    className="text-white/40 hover:text-white transition-colors shrink-0 disabled:opacity-30"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                  </button>
                  {server.builtin ? (
                    <span
                      title="Built in — starts with J.A.R.V.I.S. and cannot be removed"
                      className="text-white/20 shrink-0"
                    >
                      <Lock className="w-3.5 h-3.5" />
                    </span>
                  ) : (
                    <button
                      onClick={() => onRemove(server.id)}
                      title="Remove"
                      className="text-white/40 hover:text-red-400 transition-colors shrink-0"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                {server.status === 'error' && server.error && (
                  <div className="px-3 pb-2.5 text-[9px] font-mono text-red-400/80 break-words">
                    {server.error}
                  </div>
                )}

                {isOpen && server.tools.length > 0 && (
                  <div className="border-t border-white/10 px-3 py-2 space-y-1.5">
                    {server.tools.map((tool) => (
                      <div key={tool.qualifiedName} className="border-l-2 border-cyan-400/30 pl-2.5 py-1">
                        <div className="text-[10px] font-mono text-cyan-100/90">{tool.name}</div>
                        <div className="text-[9px] font-mono text-white/40 leading-relaxed">
                          {tool.description}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="border-t border-white/20 px-4 py-2.5 text-[9px] font-mono text-white/30 shrink-0">
          Linked tools are offered to J.A.R.V.I.S. on the next connection. Reconnect the mic to pick up changes.
        </div>
      </div>
    </div>
  );
}
