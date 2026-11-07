import { useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { Plus, Trash2, Pencil, Star, Search, X, Check, Lock } from 'lucide-react';
import { Memory, weightOf, weeksRemaining } from '../lib/memory-utils';

interface Props {
  memories: Memory[];
  starredCount: number;
  onAdd: (text: string) => Promise<unknown>;
  onUpdate: (id: string, text: string) => Promise<void>;
  onToggleStar: (id: string) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
}

const FIELD =
  'w-full bg-black/60 border border-white/20 rounded px-3 py-2 text-[11px] font-mono text-white/90 ' +
  'placeholder:text-white/25 focus:outline-none focus:border-white/60 transition-colors';

const KIND_LABEL: Record<Memory['kind'], string> = {
  fact: 'LEARNED',
  manual: 'ADDED',
  system: 'LINKED'
};

const formatDate = (ts: number) =>
  new Date(ts).toLocaleDateString([], { month: 'short', day: '2-digit' }).toUpperCase();

/** Strength bar: full and amber when starred, otherwise decaying white. */
function Strength({ memory }: { memory: Memory }) {
  const weight = weightOf(memory);
  const weeks = weeksRemaining(memory);
  const pct = Math.round(weight * 100);

  return (
    <div className="flex items-center gap-2 shrink-0" title={
      memory.starred
        ? 'Starred — never fades'
        : `${pct}% · fades in about ${Math.max(0, Math.round(weeks ?? 0))} weeks`
    }>
      <div className="w-10 h-1 bg-white/10 rounded-full overflow-hidden">
        <div
          className={`h-full ${memory.starred ? 'bg-amber-400' : 'bg-white/50'}`}
          style={{ width: `${Math.max(4, pct)}%` }}
        />
      </div>
      <span className="text-[8px] font-mono text-white/30 w-7 text-right">
        {memory.starred ? '∞' : `${pct}%`}
      </span>
    </div>
  );
}

export default function MemoryTab({
  memories,
  starredCount,
  onAdd,
  onUpdate,
  onToggleStar,
  onRemove
}: Props) {
  const [query, setQuery] = useState('');
  const [draft, setDraft] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');

  const terms = useMemo(
    () => query.trim().toLowerCase().split(/\s+/).filter(Boolean),
    [query]
  );

  const visible = useMemo(() => {
    const filtered =
      terms.length === 0
        ? memories
        : memories.filter((m) => {
            const text = m.text.toLowerCase();
            return terms.every((t) => text.includes(t));
          });

    // Starred first, then strongest, so the things J.A.R.V.I.S. is surest of
    // sit at the top.
    return [...filtered].sort((a, b) => {
      if (a.starred !== b.starred) return a.starred ? -1 : 1;
      return weightOf(b) - weightOf(a);
    });
  }, [memories, terms]);

  const submitAdd = async () => {
    if (!draft.trim()) return;
    await onAdd(draft);
    setDraft('');
    setShowAdd(false);
  };

  const commitEdit = async (id: string) => {
    if (editValue.trim()) await onUpdate(id, editValue);
    setEditingId(null);
  };

  return (
    <div className="w-full max-w-3xl h-full max-h-[70vh] px-4 flex flex-col">
      <div className="border border-white/20 bg-black/50 backdrop-blur-sm rounded-lg shadow-[0_0_15px_rgba(255,255,255,0.05)] flex flex-col overflow-hidden h-full">
        <div className="text-[10px] text-white/70 tracking-widest px-4 py-3 border-b border-white/20 font-display flex justify-between items-center shrink-0">
          <span>SYS // MEMORY_CORE</span>
          <div className="flex items-center gap-4">
            <span className="text-white/40">
              {memories.length} {memories.length === 1 ? 'MEMORY' : 'MEMORIES'} · {starredCount} STARRED
            </span>
            <button
              onClick={() => setShowAdd((v) => !v)}
              title="Add a memory"
              className="text-white/50 hover:text-white transition-colors"
            >
              <Plus className={`w-3.5 h-3.5 transition-transform ${showAdd ? 'rotate-45' : ''}`} />
            </button>
          </div>
        </div>

        <div className="px-4 py-3 border-b border-white/20 shrink-0 space-y-3">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-white/30 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search memories…"
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

          {showAdd && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex gap-2">
              <input
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') submitAdd();
                  if (e.key === 'Escape') setShowAdd(false);
                }}
                placeholder="Something J.A.R.V.I.S. should know…"
                className={FIELD}
              />
              <button
                onClick={submitAdd}
                disabled={!draft.trim()}
                className="px-4 py-2 text-[10px] tracking-widest font-display uppercase border border-white/40 rounded text-white hover:bg-white/10 transition-colors disabled:opacity-40 shrink-0"
              >
                Save
              </button>
            </motion.div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-2">
          {visible.length === 0 && (
            <div className="text-white/30 italic text-[10px] font-mono text-center py-12">
              {memories.length === 0
                ? 'Nothing remembered yet. Talk to J.A.R.V.I.S., or add something with +.'
                : 'Nothing matches that search.'}
            </div>
          )}

          {visible.map((memory) => {
            const isSystem = memory.kind === 'system';
            return (
              <div
                key={memory.id}
                className={`border rounded px-3 py-2.5 flex items-start gap-3 ${
                  memory.starred ? 'border-amber-400/25 bg-amber-400/5' : 'border-white/15 bg-black/40'
                }`}
              >
                <button
                  onClick={() => !isSystem && onToggleStar(memory.id)}
                  title={
                    isSystem
                      ? 'Linked services are always remembered'
                      : memory.starred
                        ? 'Unstar — let it fade over time'
                        : 'Star — never forget this'
                  }
                  disabled={isSystem}
                  className={`shrink-0 mt-0.5 transition-colors ${
                    memory.starred ? 'text-amber-400' : 'text-white/25 hover:text-white/70'
                  } ${isSystem ? 'cursor-default' : ''}`}
                >
                  {isSystem ? (
                    <Lock className="w-3.5 h-3.5" />
                  ) : (
                    <Star className={`w-3.5 h-3.5 ${memory.starred ? 'fill-amber-400' : ''}`} />
                  )}
                </button>

                <div className="min-w-0 flex-1">
                  {editingId === memory.id ? (
                    <input
                      autoFocus
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      onBlur={() => commitEdit(memory.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') commitEdit(memory.id);
                        if (e.key === 'Escape') setEditingId(null);
                      }}
                      className="w-full bg-black/60 border border-white/40 rounded px-2 py-1 text-[11px] font-mono text-white/90 focus:outline-none"
                    />
                  ) : (
                    <p className="text-[11px] font-mono text-white/85 leading-relaxed break-words">
                      {memory.text}
                    </p>
                  )}
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-[8px] tracking-widest font-display text-white/30">
                      {KIND_LABEL[memory.kind]}
                    </span>
                    <span className="text-[8px] font-mono text-white/20">
                      {formatDate(memory.createdAt)}
                    </span>
                  </div>
                </div>

                <Strength memory={memory} />

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => {
                      setEditingId(memory.id);
                      setEditValue(memory.text);
                    }}
                    title="Edit"
                    className="text-white/30 hover:text-white transition-colors"
                  >
                    {editingId === memory.id ? (
                      <Check className="w-3.5 h-3.5" />
                    ) : (
                      <Pencil className="w-3.5 h-3.5" />
                    )}
                  </button>
                  <button
                    onClick={() => onRemove(memory.id)}
                    title="Forget"
                    className="text-white/30 hover:text-red-400 transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        <div className="border-t border-white/20 px-4 py-2.5 text-[9px] font-mono text-white/30 shrink-0">
          Memories fade 10% a week unless starred. Linked APIs and MCP servers are always kept.
        </div>
      </div>
    </div>
  );
}
