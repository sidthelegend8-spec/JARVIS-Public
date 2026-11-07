import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Loader2, Search, Trash2 } from 'lucide-react';

/** A research as the server keeps it (server/research.ts). */
export interface ResearchSource {
  n: number;
  url: string;
  site: string;
  title: string;
  key_point: string;
  summary: string;
}

export interface Research {
  id: string;
  topic: string;
  created: string;
  method: 'google' | 'news';
  sources: ResearchSource[];
  links: { a: number; b: number; kind: 'agrees' | 'disputes' | 'adds' }[];
  summary: string[];
}

interface ListItem {
  id: string;
  topic: string;
  created: string;
}

interface Props {
  geminiKey: string;
  /** A research JARVIS just finished by voice: open it. */
  openId: string | null;
}

// -- the board's layout ------------------------------------------------------------------
// The topic in the middle of a 5 x 3 grid of cards: five across the top, one either side,
// five across the bottom, nearest the topic first. Each card is nudged and tilted a little,
// seeded by the research, so a board opens the same way every time.
const RINGS: [number, number][][] = [
  [[1, 1], [3, 1], [2, 0], [2, 2]],
  [[1, 0], [3, 0], [1, 2], [3, 2]],
  [[0, 0], [4, 0], [0, 2], [4, 2]]
];
const GAP_X = 20;
const GAP_Y = 30;
const MARGIN = 14;

interface Box { x: number; y: number; w: number; h: number; rot: number }
interface Lines { width: number; height: number; strings: string[]; related: { d: string; kind: string; label: { x: number; y: number } | null }[] }

function seeded(text: string): () => number {
  let h = 2166136261;
  for (const ch of text) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return () => {
    h += 0x6d2b79f5;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled<T>(list: T[], rand: () => number): T[] {
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function pinOf(box: Box) {
  const turn = (box.rot * Math.PI) / 180;
  const reach = box.h / 2;
  return { x: box.x + box.w / 2 + reach * Math.sin(turn), y: box.y + box.h / 2 - reach * Math.cos(turn) };
}

function curve(a: { x: number; y: number }, b: { x: number; y: number }, sag: number) {
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2 + Math.hypot(b.x - a.x, b.y - a.y) * sag;
  const at = (t: number) => ({
    x: (1 - t) * (1 - t) * a.x + 2 * (1 - t) * t * mx + t * t * b.x,
    y: (1 - t) * (1 - t) * a.y + 2 * (1 - t) * t * my + t * t * b.y
  });
  return { d: `M${a.x.toFixed(1)} ${a.y.toFixed(1)} Q${mx.toFixed(1)} ${my.toFixed(1)} ${b.x.toFixed(1)} ${b.y.toFixed(1)}`, at };
}

function when(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

/** A paragraph with its [n] marks (and groups like [1, 3]) turned into links to those sources. */
function Cited({ text, research }: { text: string; research: Research }) {
  const byNumber = new Map(research.sources.map((s) => [s.n, s]));
  const pieces = text.split(/(\[\d+(?:\s*,\s*\d+)*\])/);
  return (
    <>
      {pieces.map((piece, i) => {
        const group = /^\[(\d+(?:\s*,\s*\d+)*)\]$/.exec(piece);
        const sources = group ? group[1].split(',').map((n) => byNumber.get(Number(n.trim()))) : [];
        if (!sources.length || !sources.every(Boolean)) return <span key={i}>{piece}</span>;
        return sources.map((source) => (
          <a
            key={`${i}-${source!.n}`}
            href={source!.url}
            target="_blank"
            rel="noopener noreferrer"
            title={`${source!.title} (${source!.site})`}
            className="inline-block min-w-[20px] mx-[1px] px-1 rounded border border-cyan-300/30 text-[10px] leading-[16px] text-center text-cyan-200/90 no-underline align-[2px] hover:bg-cyan-300 hover:text-black transition-colors"
          >
            {source!.n}
          </a>
        ));
      })}
    </>
  );
}

export default function ResearchTab({ geminiKey, openId }: Props) {
  const [list, setList] = useState<ListItem[]>([]);
  const [current, setCurrent] = useState<Research | null>(null);
  const [view, setView] = useState<'sources' | 'summary'>('sources');
  const [topic, setTopic] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const hubRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<(HTMLAnchorElement | null)[]>([]);
  const [lines, setLines] = useState<Lines | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/research');
      const data = await res.json();
      setList(data.research || []);
      return (data.research || []) as ListItem[];
    } catch {
      return [];
    }
  }, []);

  const open = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/research/${encodeURIComponent(id)}`);
      const data = await res.json();
      if (data.research) {
        setCurrent(data.research);
        setError(null);
      }
    } catch {
      setError('That research could not be opened.');
    }
  }, []);

  useEffect(() => {
    refresh().then((items) => {
      if (!openId && items[0]) void open(items[0].id);
    });
  }, [refresh, open, openId]);

  useEffect(() => {
    if (openId) {
      void refresh();
      void open(openId);
      setView('sources');
    }
  }, [openId, refresh, open]);

  const run = async () => {
    const wanted = topic.trim();
    if (!wanted) {
      setError('Type a topic to research first.');
      return;
    }
    if (!geminiKey) {
      setError('Add your Gemini key in the Keys tab first.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/research', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic: wanted, key: geminiKey })
      });
      const data = await res.json();
      if (!res.ok || !data.research) throw new Error(data.error || 'Research failed.');
      setCurrent(data.research);
      setView('sources');
      setTopic('');
      void refresh();
    } catch (e: any) {
      setError(e?.message || 'Research failed.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    await fetch(`/api/research/${encodeURIComponent(id)}`, { method: 'DELETE' });
    const items = await refresh();
    if (current?.id === id) {
      setCurrent(null);
      if (items[0]) void open(items[0].id);
    }
  };

  // Lay the board out once the cards are in the page and their heights are known.
  const layout = useCallback(() => {
    const board = boardRef.current;
    const hub = hubRef.current;
    if (!board || !hub || !current || view !== 'sources') return;
    const W = board.clientWidth;
    const H = board.clientHeight;
    if (!W || !H) return;
    const cards = cardRefs.current.slice(0, current.sources.length).filter(Boolean) as HTMLAnchorElement[];
    const rand = seeded(current.id);
    const cardW = Math.round(Math.max(150, Math.min(250, (W - 2 * MARGIN - 4 * GAP_X) / 5)));
    hub.style.width = `${cardW}px`;
    for (const card of cards) card.style.width = `${cardW}px`;

    const slots = RINGS.flatMap((ring) => shuffled(ring, rand)).slice(0, cards.length);
    const heights = cards.map((card) => card.offsetHeight);
    const hubH = hub.offsetHeight;
    const rowH = [0, hubH, 0];
    slots.forEach(([, row], i) => { rowH[row] = Math.max(rowH[row], heights[i]); });
    const total = rowH[0] + rowH[1] + rowH[2] + (rowH[0] ? GAP_Y : 0) + (rowH[2] ? GAP_Y : 0);
    const canvasH = Math.max(H, total + 2 * MARGIN);
    const rowTop = [(canvasH - total) / 2, 0, 0];
    rowTop[1] = rowTop[0] + (rowH[0] ? rowH[0] + GAP_Y : 0);
    rowTop[2] = rowTop[1] + rowH[1] + GAP_Y;
    const left = Math.max(MARGIN, (W - (5 * cardW + 4 * GAP_X)) / 2);
    const cellX = (column: number) => left + column * (cardW + GAP_X);

    const hubBox = { x: cellX(2), y: rowTop[1] + (rowH[1] - hubH) / 2, w: cardW, h: hubH, rot: 0 };
    hub.style.left = `${hubBox.x}px`;
    hub.style.top = `${hubBox.y}px`;
    const placed: Box[] = slots.map(([column, row], i) => {
      const h = heights[i];
      const box = {
        x: cellX(column) + (rand() - 0.5) * GAP_X * 0.8,
        y: rowTop[row] + (rowH[row] - h) / 2 + (rand() - 0.5) * GAP_Y * 0.6,
        w: cardW,
        h,
        rot: (rand() - 0.5) * 5
      };
      cards[i].style.left = `${box.x}px`;
      cards[i].style.top = `${box.y}px`;
      cards[i].style.setProperty('--rot', `${box.rot.toFixed(2)}deg`);
      return box;
    });

    const center = { x: hubBox.x + hubBox.w / 2, y: hubBox.y + hubBox.h / 2 };
    const boxes = [hubBox, ...placed];
    const clear = (p: { x: number; y: number }) =>
      !boxes.some((b) => p.x > b.x - 26 && p.x < b.x + b.w + 26 && p.y > b.y - 8 && p.y < b.y + b.h + 8);
    setLines({
      width: W,
      height: canvasH,
      strings: placed.map((box) => curve(center, pinOf(box), 0.1).d),
      related: current.links
        .filter((link) => placed[link.a - 1] && placed[link.b - 1])
        .map((link) => {
          const line = curve(pinOf(placed[link.a - 1]), pinOf(placed[link.b - 1]), 0.14);
          const spot = [0.5, 0.44, 0.56, 0.38, 0.62, 0.3, 0.7, 0.22, 0.78].map(line.at).find(clear) || null;
          return { d: line.d, kind: link.kind, label: spot };
        })
    });
  }, [current, view]);

  useLayoutEffect(() => {
    layout();
  }, [layout]);

  useEffect(() => {
    const board = boardRef.current;
    if (!board) return;
    const watcher = new ResizeObserver(() => layout());
    watcher.observe(board);
    return () => watcher.disconnect();
  }, [layout]);

  return (
    <div className="w-full max-w-[1600px] h-[calc(100vh-300px)] min-h-[400px] px-6 flex gap-3">
      <aside className="hidden md:flex w-52 shrink-0 flex-col border border-white/20 bg-black/50 backdrop-blur-sm rounded-lg overflow-hidden" aria-label="Past research">
        <div className="text-[10px] text-white/70 tracking-widest px-3 py-3 border-b border-white/20 font-display">SYS // HISTORY</div>
        <ul className="flex-1 overflow-y-auto custom-scrollbar p-2 space-y-1">
          {list.length === 0 && <li className="text-[10px] text-white/35 font-mono px-2 py-2">No research yet.</li>}
          {list.map((item) => (
            <li key={item.id} className="group flex items-start gap-1">
              <button
                onClick={() => open(item.id)}
                aria-current={current?.id === item.id}
                className={`flex-1 text-left rounded px-2 py-1.5 text-[11px] font-mono transition-colors ${
                  current?.id === item.id ? 'bg-white/10 text-white border border-white/25' : 'text-white/55 hover:text-white hover:bg-white/5 border border-transparent'
                }`}
              >
                {item.topic}
                <span className="block text-[9px] text-white/35">{when(item.created)}</span>
              </button>
              <button
                onClick={() => remove(item.id)}
                aria-label={`Delete research on ${item.topic}`}
                className="opacity-0 group-hover:opacity-100 focus:opacity-100 p-1.5 text-white/40 hover:text-red-300 transition"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </li>
          ))}
        </ul>
      </aside>

      <section className="flex-1 min-w-0 min-h-0 flex flex-col border border-white/20 bg-black/50 backdrop-blur-sm rounded-lg overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 px-4 py-2.5 border-b border-white/20">
          <span className="text-[10px] text-white/70 tracking-widest font-display">SYS // RESEARCH</span>
          <span className="text-[11px] text-white font-mono truncate max-w-[30%]" title={current?.topic}>{current?.topic}</span>
          {current && (
            <span className="text-[9px] text-white/35 font-mono">
              {current.sources.length} sources · {current.method === 'google' ? 'Google Search' : 'news and Wikipedia'}
            </span>
          )}
          <div className="ml-auto flex items-center gap-1" role="tablist" aria-label="Research views">
            {(['sources', 'summary'] as const).map((name) => (
              <button
                key={name}
                role="tab"
                aria-selected={view === name}
                onClick={() => setView(name)}
                className={`px-3 py-1 rounded text-[10px] tracking-widest font-display uppercase transition-colors ${
                  view === name ? 'bg-white/15 text-white' : 'text-white/45 hover:text-white'
                }`}
              >
                {name}
              </button>
            ))}
          </div>
        </div>

        <form
          className="flex gap-2 px-4 py-2.5 border-b border-white/10"
          onSubmit={(e) => { e.preventDefault(); void run(); }}
        >
          <input
            value={topic}
            onChange={(e) => { setTopic(e.target.value); setError(null); }}
            placeholder='Research a topic, or say "Jarvis, research ..."'
            className="flex-1 min-w-0 bg-black/60 border border-white/20 rounded px-3 py-1.5 text-[11px] font-mono text-white/90 placeholder:text-white/25 focus:outline-none focus:border-white/60"
            aria-label="Topic to research"
            disabled={busy}
          />
          <button
            type="submit"
            disabled={busy}
            className="px-3 border border-white/30 rounded text-[10px] tracking-widest font-display uppercase text-white/75 hover:text-white hover:bg-white/10 transition-colors disabled:opacity-40 flex items-center gap-2"
          >
            {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Search className="w-3 h-3" />}
            {busy ? 'Researching' : 'Research'}
          </button>
        </form>
        {error && <p role="alert" className="px-4 pt-2 text-[10px] font-mono text-red-300/90">{error}</p>}

        {!current ? (
          <div className="flex-1 grid place-items-center text-[11px] font-mono text-white/40 px-6 text-center">
            {busy ? 'Reading the web... about half a minute.' : 'No research open. Type a topic above, or ask J.A.R.V.I.S. to research something.'}
          </div>
        ) : view === 'sources' ? (
          <div ref={boardRef} className="research-board relative flex-1 min-h-0 overflow-y-auto overflow-x-hidden" key={current.id}>
            {lines && (
              <svg className="absolute left-0 top-0 pointer-events-none z-[1]" width={lines.width} height={lines.height} aria-hidden="true">
                {lines.strings.map((d, i) => (
                  <g key={i}>
                    <path d={d} className="research-string" pathLength={1} style={{ animationDelay: `${150 + i * 50}ms` }} />
                    <path d={d} className="research-spark" pathLength={1} style={{ animationDelay: `${1000 + ((i * 7) % 12) * 240}ms` }} />
                  </g>
                ))}
                {lines.related.map((link, i) => (
                  <path key={`r${i}`} d={link.d} className="research-related" />
                ))}
              </svg>
            )}
            {lines && (
              <svg className="absolute left-0 top-0 pointer-events-none z-[4]" width={lines.width} height={lines.height} aria-hidden="true">
                {lines.related.map((link, i) => link.label && (
                  <text key={i} x={link.label.x} y={link.label.y + 4} textAnchor="middle" className="research-label">{link.kind}</text>
                ))}
              </svg>
            )}
            <div ref={hubRef} className="research-hub absolute z-[3] rounded-lg border border-cyan-300/60 bg-[#06182a]/95 px-3 py-3 text-center">
              <div className="text-[9px] tracking-[0.3em] text-cyan-300/90 font-display uppercase">Research</div>
              <div className="mt-1 text-[13px] text-white font-display leading-snug break-words">{current.topic}</div>
            </div>
            {current.sources.map((source, i) => (
              <a
                key={source.n}
                ref={(node) => { cardRefs.current[i] = node; }}
                href={source.url}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`${source.title}, ${source.site}. ${source.key_point}. Opens the page.`}
                className="research-card absolute z-[2] flex flex-col gap-1.5 rounded-lg border border-white/20 bg-[#070d18]/95 px-3 pt-3 pb-2.5 no-underline text-inherit"
                style={{ animationDelay: `${80 + i * 45}ms` }}
              >
                <span className="research-pin" aria-hidden="true" />
                <div className="flex items-center gap-2">
                  <span className="text-[9px] font-display text-cyan-200/80 border border-white/20 rounded px-1">{String(source.n).padStart(2, '0')}</span>
                  <span className="text-[9px] font-mono text-white/40 truncate">{source.site}</span>
                </div>
                <div className="text-[12px] text-white/95 font-display leading-snug line-clamp-2">{source.title}</div>
                <div className="text-[11px] text-cyan-100/85 border-l-2 border-cyan-300/70 pl-2 leading-snug line-clamp-2">{source.key_point}</div>
                <div className="text-[10px] text-white/50 border-t border-white/10 pt-1.5 leading-snug line-clamp-3">{source.summary}</div>
              </a>
            ))}
          </div>
        ) : (
          <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar">
            <article className="max-w-[72ch] mx-auto px-6 py-6">
              <h2 className="text-[10px] tracking-[0.3em] text-cyan-300/90 font-display uppercase mb-4">Summary</h2>
              {current.summary.map((paragraph, i) => (
                <p key={i} className="research-reveal font-sans text-[15px] leading-7 text-white/85 mb-4" style={{ animationDelay: `${i * 120}ms` }}>
                  <Cited text={paragraph} research={current} />
                </p>
              ))}
              <ol className="mt-6 pt-4 border-t border-white/10 space-y-1.5">
                {current.sources.map((source) => (
                  <li key={source.n} className="text-[11px] font-mono">
                    <a href={source.url} target="_blank" rel="noopener noreferrer" className="text-white/55 hover:text-white no-underline">
                      <span className="text-cyan-300/90 mr-2">{source.n}</span>{source.title} <span className="text-white/30">({source.site})</span>
                    </a>
                  </li>
                ))}
              </ol>
            </article>
          </div>
        )}
      </section>
    </div>
  );
}
