import { useState, useEffect, useRef, useCallback } from 'react';

export interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
  at: number;
}

export interface ChatSession {
  id: string;
  startedAt: number;
  endedAt: number | null;
  messages: ChatMessage[];
}

const STORAGE_KEY = 'jarvis.chats';
const MAX_SESSIONS = 50;

const bridge = () => (typeof window !== 'undefined' ? (window as any).jarvis : undefined);

async function loadSessions(): Promise<ChatSession[]> {
  const api = bridge();
  if (api?.loadChats) {
    try {
      const stored = await api.loadChats();
      return Array.isArray(stored) ? stored : [];
    } catch (e) {
      console.error('Failed to load chat history', e);
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

async function persistSessions(sessions: ChatSession[]): Promise<void> {
  const api = bridge();
  if (api?.saveChats) {
    await api.saveChats(sessions);
    return;
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
}

/**
 * Transcript of past voice sessions. A session opens on the first exchange and
 * closes when the user disconnects, so the next connection starts a new one.
 */
export function useChatHistory() {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);

  // The live-api callbacks are long-lived and must not capture stale state, so
  // the authoritative copy lives in a ref and React state mirrors it for render.
  const sessionsRef = useRef<ChatSession[]>([]);
  const activeIdRef = useRef<string | null>(null);
  const saveTimerRef = useRef<number | null>(null);

  const cancelPendingSave = useCallback(() => {
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
  }, []);

  // Mute and disconnect are the intended checkpoints, but closing the window
  // does neither. Without this, quitting mid-conversation would discard the
  // whole session, so writes are also debounced behind each exchange.
  const scheduleSave = useCallback(() => {
    cancelPendingSave();
    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null;
      void persistSessions(sessionsRef.current);
    }, 1500);
  }, [cancelPendingSave]);

  useEffect(() => cancelPendingSave, [cancelPendingSave]);

  useEffect(() => {
    let cancelled = false;
    loadSessions().then((loaded) => {
      if (cancelled) return;
      // Any session left open by a crash or force-quit is closed on load.
      const settled = loaded.map((s) => (s.endedAt === null ? { ...s, endedAt: s.startedAt } : s));
      sessionsRef.current = settled;
      setSessions(settled);
      setIsLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const commit = useCallback((next: ChatSession[], persist: boolean) => {
    const trimmed = next.slice(-MAX_SESSIONS);
    sessionsRef.current = trimmed;
    setSessions(trimmed);
    if (persist) void persistSessions(trimmed);
  }, []);

  /** Append one turn, opening a session if none is currently active. */
  const addMessage = useCallback((role: ChatMessage['role'], text: string) => {
    const body = text.trim();
    if (!body) return;

    const message: ChatMessage = { role, text: body, at: Date.now() };
    const current = sessionsRef.current;
    const activeId = activeIdRef.current;
    const active = activeId ? current.find((s) => s.id === activeId) : undefined;

    if (!active) {
      const session: ChatSession = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        startedAt: Date.now(),
        endedAt: null,
        messages: [message]
      };
      activeIdRef.current = session.id;
      commit([...current, session], false);
      scheduleSave();
      return;
    }

    commit(
      current.map((s) => (s.id === activeId ? { ...s, messages: [...s.messages, message] } : s)),
      false
    );
    scheduleSave();
  }, [commit, scheduleSave]);

  /** Write the in-progress session to disk without closing it. */
  const flush = useCallback(() => {
    if (!activeIdRef.current) return;
    cancelPendingSave();
    void persistSessions(sessionsRef.current);
  }, [cancelPendingSave]);

  /** Close the active session so the next exchange begins a fresh one. */
  const endSession = useCallback(() => {
    const activeId = activeIdRef.current;
    activeIdRef.current = null;
    cancelPendingSave();
    if (!activeId) return;

    const next = sessionsRef.current
      // An session with no exchanges is not worth keeping.
      .filter((s) => s.id !== activeId || s.messages.length > 0)
      .map((s) => (s.id === activeId ? { ...s, endedAt: Date.now() } : s));

    commit(next, true);
  }, [commit, cancelPendingSave]);

  return { sessions, isLoaded, addMessage, flush, endSession };
}
