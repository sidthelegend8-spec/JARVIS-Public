import { useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { Plus, Trash2, Pencil, ExternalLink, Search, X } from 'lucide-react';
import { Shortcut } from '../hooks/use-shortcuts';

interface Props {
  shortcuts: Shortcut[];
  onSave: (input: { id?: string; name: string; url: string }) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
}

const FIELD =
  'w-full bg-black/60 border border-white/20 rounded px-3 py-2 text-[11px] font-mono text-white/90 ' +
  'placeholder:text-white/25 focus:outline-none focus:border-white/60 transition-colors';

const LABEL = 'text-[9px] text-white/50 tracking-widest font-display uppercase mb-1.5 block';

/** Host only, so a long URL stays readable in the list. */
const hostOf = (url: string) => {
  try {
    return new URL(url).host.replace(/^www\./, '');
  } catch {
    return url;
  }
};

export default function BrowserTab({ shortcuts, onSave, onRemove }: Props) {
  const [query, setQuery] = useState('');
  const [draft, setDraft] = useState<{ id?: string; name: string; url: string } | null>(null);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const list = needle
      ? shortcuts.filter(
          (s) => s.name.toLowerCase().includes(needle) || s.url.toLowerCase().includes(needle)
        )
      : shortcuts;
    return [...list].sort((a, b) => a.name.localeCompare(b.name));
  }, [shortcuts, query]);

  const submit = async () => {
    if (!draft?.name.trim() || !draft.url.trim()) return;
    await onSave(draft);
    setDraft(null);
  };

  return (
    <div className="w-full max-w-3xl h-full max-h-[70vh] px-4 flex flex-col">
      <div className="border border-white/20 bg-black/50 backdrop-blur-sm rounded-lg shadow-[0_0_15px_rgba(255,255,255,0.05)] flex flex-col overflow-hidden h-full">
        <div className="text-[10px] text-white/70 tracking-widest px-4 py-3 border-b border-white/20 font-display flex justify-between items-center shrink-0">
          <span>SYS // BOOKMARKS</span>
          <div className="flex items-center gap-4">
            <span className="text-white/40">
              {shortcuts.length} {shortcuts.length === 1 ? 'LINK' : 'LINKS'}
            </span>
            <button
              onClick={() => setDraft(draft ? null : { name: '', url: '' })}
              title="Add a link"
              className="text-white/50 hover:text-white transition-colors"
            >
              <Plus className={`w-3.5 h-3.5 transition-transform ${draft ? 'rotate-45' : ''}`} />
            </button>
          </div>
        </div>

        <div className="px-4 py-3 border-b border-white/20 shrink-0 space-y-3">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-white/30 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search links…"
              spellCheck={false}
              className={`${FIELD} pl-9 pr-8`}
            />
            {query && (
              <button
                onClick={() => setQuery('')}
                title="Clear"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-white/30 hover:text-white transition-colors"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>

          {draft && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-3">
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className={LABEL}>Name — what you say</label>
                  <input
                    autoFocus
                    value={draft.name}
                    onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                    placeholder="Library"
                    className={FIELD}
                  />
                </div>
                <div className="col-span-2">
                  <label className={LABEL}>URL</label>
                  <input
                    value={draft.url}
                    onChange={(e) => setDraft({ ...draft, url: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') submit();
                      if (e.key === 'Escape') setDraft(null);
                    }}
                    placeholder="https://www.example.com/"
                    className={FIELD}
                    spellCheck={false}
                  />
                </div>
              </div>
              <div className="flex justify-end gap-3">
                <button
                  onClick={() => setDraft(null)}
                  className="px-4 py-2 text-[10px] tracking-widest font-display uppercase text-white/50 hover:text-white transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={submit}
                  disabled={!draft.name.trim() || !draft.url.trim()}
                  className="px-5 py-2 text-[10px] tracking-widest font-display uppercase border border-white/40 rounded text-white hover:bg-white/10 transition-colors disabled:opacity-40"
                >
                  Save
                </button>
              </div>
            </motion.div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-2">
          {visible.length === 0 && (
            <div className="text-white/30 italic text-[10px] font-mono text-center py-12">
              {shortcuts.length === 0
                ? 'No links saved. Use + to add one, then just say its name.'
                : 'Nothing matches that search.'}
            </div>
          )}

          {visible.map((shortcut) => (
            <div
              key={shortcut.id}
              className="border border-white/15 rounded bg-black/40 flex items-center gap-3 px-3 py-2.5"
            >
              <div className="min-w-0 flex-1">
                <div className="text-[11px] font-mono text-white/90 truncate">{shortcut.name}</div>
                <div className="text-[9px] font-mono text-white/35 truncate">{hostOf(shortcut.url)}</div>
              </div>

              <button
                onClick={() => window.open(shortcut.url, '_blank', 'noopener,noreferrer')}
                title="Open now"
                className="text-white/40 hover:text-white transition-colors shrink-0"
              >
                <ExternalLink className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => setDraft({ id: shortcut.id, name: shortcut.name, url: shortcut.url })}
                title="Edit"
                className="text-white/40 hover:text-white transition-colors shrink-0"
              >
                <Pencil className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => onRemove(shortcut.id)}
                title="Delete"
                className="text-white/40 hover:text-red-400 transition-colors shrink-0"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>

        <div className="border-t border-white/20 px-4 py-2.5 text-[9px] font-mono text-white/30 shrink-0">
          Say "open Library" and J.A.R.V.I.S. opens it in your browser. Reconnect the mic after adding one.
        </div>
      </div>
    </div>
  );
}
