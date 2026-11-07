import { useMemo, useState } from 'react';
import { Search, X } from 'lucide-react';
import { ChatSession } from '../hooks/use-chat-history';

interface Props {
  sessions: ChatSession[];
}

type RangeKey = 'ALL' | 'TODAY' | '7D' | '30D';

const RANGES: { key: RangeKey; label: string; ms: number | null }[] = [
  { key: 'ALL', label: 'ALL', ms: null },
  { key: 'TODAY', label: 'TODAY', ms: 24 * 60 * 60 * 1000 },
  { key: '7D', label: '7D', ms: 7 * 24 * 60 * 60 * 1000 },
  { key: '30D', label: '30D', ms: 30 * 24 * 60 * 60 * 1000 }
];

const formatTime = (ts: number) =>
  new Date(ts).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });

const formatDate = (ts: number) =>
  new Date(ts).toLocaleDateString([], { month: 'short', day: '2-digit', year: 'numeric' }).toUpperCase();

/** Split on the search terms so matches can be marked without dangerouslySetInnerHTML. */
function highlight(text: string, terms: string[]) {
  if (terms.length === 0) return text;

  const escaped = terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const parts = text.split(new RegExp(`(${escaped.join('|')})`, 'gi'));
  const lowered = terms.map((t) => t.toLowerCase());

  return parts.map((part, i) =>
    lowered.includes(part.toLowerCase()) ? (
      <mark key={i} className="bg-white/25 text-white rounded-sm px-0.5">
        {part}
      </mark>
    ) : (
      part
    )
  );
}

export default function ChatTab({ sessions }: Props) {
  const [query, setQuery] = useState('');
  const [range, setRange] = useState<RangeKey>('ALL');

  // Every term must appear somewhere in the message, so extra words narrow
  // rather than widen the result set.
  const terms = useMemo(
    () => query.trim().toLowerCase().split(/\s+/).filter(Boolean),
    [query]
  );

  const { results, matchCount } = useMemo(() => {
    const cutoff = RANGES.find((r) => r.key === range)?.ms ?? null;
    const since = cutoff === null ? 0 : Date.now() - cutoff;

    let matches = 0;
    const filtered = sessions
      .filter((session) => session.startedAt >= since)
      .map((session) => {
        if (terms.length === 0) return session;
        const messages = session.messages.filter((m) => {
          const text = m.text.toLowerCase();
          return terms.every((t) => text.includes(t));
        });
        return { ...session, messages };
      })
      .filter((session) => session.messages.length > 0);

    for (const session of filtered) matches += session.messages.length;
    return { results: [...filtered].reverse(), matchCount: matches };
  }, [sessions, terms, range]);

  const isFiltering = terms.length > 0 || range !== 'ALL';

  return (
    <div className="w-full max-w-3xl h-full max-h-[70vh] px-4 flex flex-col">
      <div className="border border-white/20 bg-black/50 backdrop-blur-sm rounded-lg shadow-[0_0_15px_rgba(255,255,255,0.05)] flex flex-col overflow-hidden h-full">
        <div className="text-[10px] text-white/70 tracking-widest px-4 py-3 border-b border-white/20 font-display flex justify-between shrink-0">
          <span>SYS // SESSION_LOG</span>
          <span className="text-white/40">
            {isFiltering
              ? `${matchCount} ${matchCount === 1 ? 'MATCH' : 'MATCHES'} · ${results.length} ${results.length === 1 ? 'SESSION' : 'SESSIONS'}`
              : `${sessions.length} ${sessions.length === 1 ? 'SESSION' : 'SESSIONS'}`}
          </span>
        </div>

        <div className="px-4 py-3 border-b border-white/20 flex items-center gap-3 shrink-0">
          <div className="relative flex-1">
            <Search className="w-3.5 h-3.5 text-white/30 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search keywords, names, topics…"
              spellCheck={false}
              className="w-full bg-black/60 border border-white/20 rounded pl-9 pr-8 py-2 text-[11px] font-mono text-white/90 placeholder:text-white/25 focus:outline-none focus:border-white/60 transition-colors"
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

          <div className="flex gap-1 shrink-0">
            {RANGES.map((r) => (
              <button
                key={r.key}
                onClick={() => setRange(r.key)}
                className={`px-2.5 py-1.5 text-[9px] tracking-widest font-display border rounded transition-colors ${
                  range === r.key
                    ? 'border-white/50 text-white bg-white/10'
                    : 'border-white/15 text-white/40 hover:text-white/80'
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-6">
          {results.length === 0 && (
            <div className="text-white/30 italic text-[10px] font-mono text-center py-12">
              {sessions.length === 0
                ? 'No sessions recorded yet.'
                : 'Nothing matches that search.'}
            </div>
          )}

          {results.map((session) => (
            <div key={session.id}>
              <div className="flex items-center gap-3 mb-3">
                <span className="text-[9px] text-white/50 tracking-widest font-display shrink-0">
                  {formatDate(session.startedAt)} · {formatTime(session.startedAt)}
                </span>
                <div className="h-[1px] flex-1 bg-white/10" />
                {session.endedAt === null && (
                  <span className="text-[9px] text-white tracking-widest font-display shrink-0 flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse drop-shadow-[0_0_5px_rgba(255,255,255,1)]" />
                    ACTIVE
                  </span>
                )}
              </div>

              <div className="space-y-2">
                {session.messages.map((msg, i) => (
                  <div
                    key={i}
                    className={`border-l-2 pl-3 py-1.5 ${
                      msg.role === 'user'
                        ? 'border-white/30 bg-white/5'
                        : 'border-cyan-400/40 bg-cyan-400/5'
                    }`}
                  >
                    <div className="flex items-baseline gap-2 mb-1">
                      <span
                        className={`text-[8px] tracking-widest font-display ${
                          msg.role === 'user' ? 'text-white/50' : 'text-cyan-400/70'
                        }`}
                      >
                        {msg.role === 'user' ? 'USER' : 'J.A.R.V.I.S'}
                      </span>
                      <span className="text-[8px] text-white/25 font-mono">{formatTime(msg.at)}</span>
                    </div>
                    <p
                      className={`text-[11px] font-mono leading-relaxed whitespace-pre-wrap ${
                        msg.role === 'user' ? 'text-white/80' : 'text-cyan-50/80'
                      }`}
                    >
                      {highlight(msg.text, terms)}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
