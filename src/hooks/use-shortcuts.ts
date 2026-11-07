import { useState, useEffect, useCallback, useRef } from 'react';

export interface Shortcut {
  id: string;
  name: string;
  url: string;
}

const STORAGE_KEY = 'jarvis.shortcuts';

const bridge = () => (typeof window !== 'undefined' ? (window as any).jarvis : undefined);

async function loadShortcuts(): Promise<Shortcut[]> {
  const api = bridge();
  if (api?.loadShortcuts) {
    try {
      const stored = await api.loadShortcuts();
      return Array.isArray(stored) ? stored : [];
    } catch (e) {
      console.error('Failed to load shortcuts', e);
      return [];
    }
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function persistShortcuts(shortcuts: Shortcut[]): Promise<void> {
  const api = bridge();
  if (api?.saveShortcuts) {
    // The main process reports a failed write by returning false. Ignoring it
    // is how a link can look saved in the tab and be gone after a restart.
    const ok = await api.saveShortcuts(shortcuts);
    if (ok === false) {
      console.error('[shortcuts] the write failed — these links will not survive a restart');
    }
    return;
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(shortcuts));
}

/** Accept bare hosts as well as full URLs, so "example.com" works. */
export const normaliseUrl = (raw: string) => {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
};

/**
 * Match a spoken name against the saved list.
 *
 * Speech recognition rarely returns a name exactly as it was typed — "the
 * library", "Library." — so this works down from an exact match to word
 * overlap rather than demanding the string be identical.
 */
export function resolveShortcut(shortcuts: Shortcut[], spoken: string): Shortcut | null {
  const needle = spoken.trim().toLowerCase().replace(/[.,!?]+$/, '');
  if (!needle) return null;

  const exact = shortcuts.find((s) => s.name.toLowerCase() === needle);
  if (exact) return exact;

  // Ignore leading articles: "the library" should find "Library".
  const stripped = needle.replace(/^(the|my|open)\s+/, '');
  const afterStrip = shortcuts.find((s) => s.name.toLowerCase() === stripped);
  if (afterStrip) return afterStrip;

  const contains = shortcuts.find(
    (s) => s.name.toLowerCase().includes(stripped) || stripped.includes(s.name.toLowerCase())
  );
  if (contains) return contains;

  // Last resort: the entry sharing the most words with what was said.
  const words = new Set(stripped.split(/\s+/).filter(Boolean));
  let best: { shortcut: Shortcut; score: number } | null = null;
  for (const shortcut of shortcuts) {
    const own = shortcut.name.toLowerCase().split(/\s+/).filter(Boolean);
    const score = own.filter((w) => words.has(w)).length / Math.max(own.length, 1);
    if (score > 0.5 && (!best || score > best.score)) best = { shortcut, score };
  }
  return best?.shortcut ?? null;
}

export function useShortcuts() {
  const [shortcuts, setShortcuts] = useState<Shortcut[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);
  const shortcutsRef = useRef<Shortcut[]>([]);
  /**
   * Resolves once the saved links have been read.
   *
   * Every mutation writes the whole list back, so acting before the read
   * finishes would write the empty starting state over a full file. Waiting
   * costs a few milliseconds at startup and removes that possibility entirely.
   */
  const readyRef = useRef<Promise<void> | null>(null);

  const commit = useCallback(async (next: Shortcut[]) => {
    shortcutsRef.current = next;
    setShortcuts(next);
    await persistShortcuts(next);
  }, []);

  useEffect(() => {
    let cancelled = false;
    readyRef.current = loadShortcuts().then((loaded) => {
      if (cancelled) return;
      shortcutsRef.current = loaded;
      setShortcuts(loaded);
      setIsLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const saveShortcut = useCallback(
    async (input: { id?: string; name: string; url: string }) => {
      const name = input.name.trim();
      const url = normaliseUrl(input.url);
      if (!name || !url) return;

      await readyRef.current;
      const existing = shortcutsRef.current;
      if (input.id && existing.some((s) => s.id === input.id)) {
        await commit(existing.map((s) => (s.id === input.id ? { ...s, name, url } : s)));
        return;
      }
      await commit([
        ...existing,
        { id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, name, url }
      ]);
    },
    [commit]
  );

  const removeShortcut = useCallback(
    async (id: string) => {
      await readyRef.current;
      return commit(shortcutsRef.current.filter((s) => s.id !== id));
    },
    [commit]
  );

  /** Names only, for briefing the assistant on what it can open. */
  const names = useCallback(() => shortcutsRef.current.map((s) => s.name), []);

  const resolve = useCallback(
    (spoken: string) => resolveShortcut(shortcutsRef.current, spoken),
    []
  );

  return { shortcuts, isLoaded, saveShortcut, removeShortcut, names, resolve };
}
