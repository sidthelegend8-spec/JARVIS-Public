import { useState, useEffect, useCallback, useRef } from 'react';

/** Catalog entry advertised by the server. Carries no request internals. */
export interface ApiProviderInfo {
  id: string;
  label: string;
  description: string;
  requiresKey: boolean;
  keyHint?: string;
  params: string[];
}

/** A connected provider. Only ever a name and a key. */
export interface ApiToolConfig {
  id: string;
  provider: string;
  name: string;
  apiKey?: string;
  enabled: boolean;
}

const STORAGE_KEY = 'jarvis.apis';

const bridge = () => (typeof window !== 'undefined' ? (window as any).jarvis : undefined);

async function loadTools(): Promise<ApiToolConfig[]> {
  const api = bridge();
  if (api?.loadApiTools) {
    try {
      const stored = await api.loadApiTools();
      return Array.isArray(stored) ? stored : [];
    } catch (e) {
      console.error('Failed to load API tools', e);
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

async function persistTools(tools: ApiToolConfig[]): Promise<void> {
  const api = bridge();
  if (api?.saveApiTools) {
    await api.saveApiTools(tools);
    return;
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(tools));
}

/** Push the current list to the server so it can answer declarations and calls. */
async function syncToServer(tools: ApiToolConfig[]): Promise<void> {
  try {
    await fetch('/api/apis/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tools })
    });
  } catch (e) {
    console.error('Failed to sync API tools', e);
  }
}

export function useApis() {
  const [tools, setTools] = useState<ApiToolConfig[]>([]);
  const [providers, setProviders] = useState<ApiProviderInfo[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);
  const toolsRef = useRef<ApiToolConfig[]>([]);

  const commit = useCallback(async (next: ApiToolConfig[]) => {
    toolsRef.current = next;
    setTools(next);
    await persistTools(next);
    await syncToServer(next);
  }, []);

  // The server keeps no state across restarts, so the list is pushed on load.
  useEffect(() => {
    let cancelled = false;

    fetch('/api/apis/providers')
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled) setProviders(d.providers || []);
      })
      .catch((e) => console.error('Failed to load providers', e));

    loadTools().then(async (loaded) => {
      if (cancelled) return;
      toolsRef.current = loaded;
      setTools(loaded);
      setIsLoaded(true);
      await syncToServer(loaded);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  const saveTool = useCallback(async (tool: ApiToolConfig) => {
    const exists = toolsRef.current.some((t) => t.id === tool.id);
    await commit(
      exists ? toolsRef.current.map((t) => (t.id === tool.id ? tool : t)) : [...toolsRef.current, tool]
    );
  }, [commit]);

  const removeTool = useCallback(
    async (id: string) => commit(toolsRef.current.filter((t) => t.id !== id)),
    [commit]
  );

  const setEnabled = useCallback(
    async (id: string, enabled: boolean) =>
      commit(toolsRef.current.map((t) => (t.id === id ? { ...t, enabled } : t))),
    [commit]
  );

  /** Run a provider without saving, so a key can be verified first. */
  const testTool = useCallback(
    async (provider: string, apiKey: string, args: Record<string, string>) => {
      const res = await fetch('/api/apis/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, apiKey, args })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
      return data as { isError: boolean; text: string; status: number };
    },
    []
  );

  const enabledCount = tools.filter((t) => t.enabled).length;

  return { tools, providers, isLoaded, saveTool, removeTool, setEnabled, testTool, enabledCount };
}
