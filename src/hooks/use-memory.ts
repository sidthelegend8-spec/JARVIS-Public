import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Memory,
  MemoryKind,
  buildBrief,
  mergeFacts,
  newMemoryId,
  pruneFaded,
  searchMemories
} from '../lib/memory-utils';

const STORAGE_KEY = 'jarvis.memories';

const bridge = () => (typeof window !== 'undefined' ? (window as any).jarvis : undefined);

async function loadMemories(): Promise<Memory[]> {
  const api = bridge();
  if (api?.loadMemories) {
    try {
      const stored = await api.loadMemories();
      return Array.isArray(stored) ? stored : [];
    } catch (e) {
      console.error('Failed to load memories', e);
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

async function persistMemories(memories: Memory[]): Promise<void> {
  const api = bridge();
  if (api?.saveMemories) {
    await api.saveMemories(memories);
    return;
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(memories));
}

/**
 * Local memory is authoritative and always available. mem0 is layered on top
 * for semantic recall when a key is configured, and every mem0 call is
 * best-effort — nothing here fails because the cloud is unreachable.
 */
export function useMemory(mem0Key?: string) {
  const [memories, setMemories] = useState<Memory[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);
  const memoriesRef = useRef<Memory[]>([]);
  const mem0KeyRef = useRef(mem0Key);

  useEffect(() => {
    mem0KeyRef.current = mem0Key;
  }, [mem0Key]);

  const commit = useCallback(async (next: Memory[]) => {
    memoriesRef.current = next;
    setMemories(next);
    await persistMemories(next);
  }, []);

  useEffect(() => {
    let cancelled = false;
    loadMemories().then(async (loaded) => {
      if (cancelled) return;
      // Faded memories are dropped on load rather than during a conversation,
      // so recall never changes shape mid-session.
      const kept = pruneFaded(loaded);
      memoriesRef.current = kept;
      setMemories(kept);
      setIsLoaded(true);
      if (kept.length !== loaded.length) await persistMemories(kept);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const addMemory = useCallback(
    async (text: string, kind: MemoryKind = 'manual', starred = false) => {
      const body = text.trim();
      if (!body) return;
      const now = Date.now();
      const memory: Memory = {
        id: newMemoryId(),
        text: body,
        kind,
        starred,
        createdAt: now,
        lastSeenAt: now
      };
      await commit([...memoriesRef.current, memory]);
      return memory;
    },
    [commit]
  );

  const updateMemory = useCallback(
    async (id: string, text: string) => {
      const body = text.trim();
      if (!body) return;
      await commit(
        memoriesRef.current.map((m) =>
          m.id === id ? { ...m, text: body, lastSeenAt: Date.now() } : m
        )
      );
    },
    [commit]
  );

  const toggleStar = useCallback(
    async (id: string) => {
      await commit(
        memoriesRef.current.map((m) =>
          m.id === id ? { ...m, starred: !m.starred, lastSeenAt: Date.now() } : m
        )
      );
    },
    [commit]
  );

  const removeMemory = useCallback(
    async (id: string) => {
      const target = memoriesRef.current.find((m) => m.id === id);
      await commit(memoriesRef.current.filter((m) => m.id !== id));

      if (target?.mem0Id && mem0KeyRef.current) {
        try {
          await fetch('/api/mem0/delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ apiKey: mem0KeyRef.current, memoryId: target.mem0Id })
          });
        } catch (e) {
          console.error('Could not remove the cloud copy', e);
        }
      }
    },
    [commit]
  );

  /**
   * Keep one pinned memory per connected API and MCP server. These are derived
   * rather than learned, so they are rewritten whenever the links change and
   * never decay.
   */
  const syncSystemMemories = useCallback(
    async (descriptions: string[]) => {
      const current = memoriesRef.current;
      const existing = current.filter((m) => m.kind === 'system');
      const wanted = new Set(descriptions);

      const unchanged =
        existing.length === descriptions.length && existing.every((m) => wanted.has(m.text));
      if (unchanged) return;

      const now = Date.now();
      const rebuilt: Memory[] = descriptions.map((text) => {
        const prior = existing.find((m) => m.text === text);
        return (
          prior ?? {
            id: newMemoryId(),
            text,
            kind: 'system' as const,
            starred: true,
            createdAt: now,
            lastSeenAt: now
          }
        );
      });

      await commit([...current.filter((m) => m.kind !== 'system'), ...rebuilt]);
    },
    [commit]
  );

  /** Record facts drawn out of a conversation, and mirror them to mem0. */
  const rememberFacts = useCallback(
    async (facts: string[], source?: string) => {
      const additions = mergeFacts(memoriesRef.current, facts, 'fact', source);
      if (additions.length === 0) return;
      await commit([...memoriesRef.current, ...additions]);

      const key = mem0KeyRef.current;
      if (!key) return;
      try {
        await fetch('/api/mem0/add', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            apiKey: key,
            messages: additions.map((m) => ({ role: 'user', content: m.text })),
            metadata: { source: source || 'conversation' }
          })
        });
      } catch (e) {
        console.error('Could not mirror memories to mem0', e);
      }
    },
    [commit]
  );

  /** Local recall, widened with mem0 results when it is configured. */
  const recall = useCallback(async (query: string, limit = 8): Promise<string[]> => {
    const local = searchMemories(memoriesRef.current, query, limit).map((m) => m.text);
    const key = mem0KeyRef.current;
    if (!key) return local;

    try {
      const res = await fetch('/api/mem0/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: key, query, topK: limit })
      });
      const data = await res.json();
      const remote: string[] = (data.results || []).map((r: any) => r.memory).filter(Boolean);
      return [...new Set([...local, ...remote])].slice(0, limit * 2);
    } catch {
      return local;
    }
  }, []);

  /** What a new session is told about the user. */
  const brief = useCallback(() => buildBrief(memoriesRef.current), []);

  const starredCount = memories.filter((m) => m.starred).length;

  return {
    memories,
    isLoaded,
    starredCount,
    addMemory,
    updateMemory,
    toggleStar,
    removeMemory,
    rememberFacts,
    syncSystemMemories,
    recall,
    brief
  };
}
