import { useState, useEffect, useCallback, useRef } from 'react';

export type McpTransport = 'auto' | 'http' | 'sse';

/** What the user typed. Persisted, encrypted, since headers may hold tokens. */
export interface McpServerConfig {
  id: string;
  label: string;
  url: string;
  transport: McpTransport;
  enabled: boolean;
  authHeader?: string;
  authValue?: string;
  /** Ships with the app; always listed, cannot be deleted. */
  builtin?: boolean;
  /** Pinned in the Memory tab while connected, in place of the generic line. */
  memory?: string;
}

/**
 * Servers the app starts for itself. They are always present in the list so
 * their status is visible even before a connection succeeds, and they cannot
 * be removed — only switched off. The public build ships none: every server
 * in the MCP tab is one the user added.
 */
const BUILTIN_SERVERS: McpServerConfig[] = [];

/** Built-ins first, then whatever the user added, with saved state preserved. */
export function withBuiltins(stored: McpServerConfig[]): McpServerConfig[] {
  const merged = BUILTIN_SERVERS.map((builtin) => {
    const saved = stored.find((s) => s.id === builtin.id);
    // Only the enabled flag and label are the user's to keep; the URL stays
    // under the app's control so a built-in cannot be pointed elsewhere.
    return saved ? { ...builtin, enabled: saved.enabled, label: saved.label } : builtin;
  });
  // A saved entry still flagged builtin but no longer shipped is dropped:
  // kept, it would come back as a server that cannot be deleted.
  return [...merged, ...stored.filter((s) => !s.builtin && !BUILTIN_SERVERS.some((b) => b.id === s.id))];
}

export interface McpToolInfo {
  name: string;
  qualifiedName: string;
  description: string;
}

/** Live connection result reported by the server. */
export interface McpServerState {
  id: string;
  label: string;
  url: string;
  status: 'connected' | 'error' | 'connecting' | 'disabled';
  error?: string;
  tools: McpToolInfo[];
  builtin?: boolean;
  memory?: string;
}

const STORAGE_KEY = 'jarvis.mcp';

const bridge = () => (typeof window !== 'undefined' ? (window as any).jarvis : undefined);

async function loadConfigs(): Promise<McpServerConfig[]> {
  const api = bridge();
  let raw: unknown = null;

  if (api?.loadMcpServers) {
    try {
      raw = await api.loadMcpServers();
    } catch (e) {
      console.error('Failed to load MCP servers', e);
    }
  } else {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      raw = stored ? JSON.parse(stored) : [];
    } catch {
      raw = [];
    }
  }

  // enabled was added after the first release; absent means on.
  const stored = Array.isArray(raw)
    ? raw.map((c: any) => ({ ...c, enabled: c.enabled !== false }))
    : [];
  return withBuiltins(stored);
}

async function persistConfigs(configs: McpServerConfig[]): Promise<void> {
  const api = bridge();
  if (api?.saveMcpServers) {
    await api.saveMcpServers(configs);
    return;
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(configs));
}

const toHeaders = (config: McpServerConfig) =>
  config.authHeader && config.authValue ? { [config.authHeader]: config.authValue } : undefined;

export function useMcp() {
  const [configs, setConfigs] = useState<McpServerConfig[]>([]);
  const [states, setStates] = useState<Record<string, McpServerState>>({});
  const [isLoaded, setIsLoaded] = useState(false);
  const configsRef = useRef<McpServerConfig[]>([]);

  const writeConfigs = useCallback(async (next: McpServerConfig[]) => {
    configsRef.current = next;
    setConfigs(next);
    await persistConfigs(next);
  }, []);

  const disconnectOne = useCallback(async (id: string) => {
    try {
      await fetch('/api/mcp/disconnect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id })
      });
    } catch (e) {
      console.error('Failed to disconnect MCP server', e);
    }
  }, []);

  const connectOne = useCallback(async (config: McpServerConfig) => {
    if (!config.enabled) {
      const disabled: McpServerState = {
        id: config.id,
        label: config.label,
        url: config.url,
        status: 'disabled',
        tools: []
      };
      setStates((prev) => ({ ...prev, [config.id]: disabled }));
      return disabled;
    }

    setStates((prev) => ({
      ...prev,
      [config.id]: {
        id: config.id,
        label: config.label,
        url: config.url,
        status: 'connecting',
        tools: []
      }
    }));

    try {
      const res = await fetch('/api/mcp/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: config.id,
          label: config.label,
          url: config.url,
          transport: config.transport,
          headers: toHeaders(config)
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
      setStates((prev) => ({ ...prev, [config.id]: data.server }));
      return data.server as McpServerState;
    } catch (e: any) {
      const failed: McpServerState = {
        id: config.id,
        label: config.label,
        url: config.url,
        status: 'error',
        error: e?.message || 'Could not reach the server',
        tools: []
      };
      setStates((prev) => ({ ...prev, [config.id]: failed }));
      return failed;
    }
  }, []);

  /**
   * Built-in servers are launched by the app at the same moment the interface
   * loads, so the first attempt usually beats them to it. Retry briefly rather
   * than leaving the tab showing an error for something that is simply still
   * starting.
   */
  const connectWithRetry = useCallback(
    async (config: McpServerConfig, attempts = 6, delayMs = 2000) => {
      let state = await connectOne(config);
      if (!config.builtin || !config.enabled) return state;

      for (let i = 1; i < attempts && state.status === 'error'; i++) {
        await new Promise((r) => setTimeout(r, delayMs));
        state = await connectOne(config);
      }
      return state;
    },
    [connectOne]
  );

  // Reconnect everything on start: the Node side holds connections in memory,
  // so they do not survive an app restart even though the configs do.
  useEffect(() => {
    let cancelled = false;
    loadConfigs().then(async (loaded) => {
      if (cancelled) return;
      configsRef.current = loaded;
      setConfigs(loaded);
      setIsLoaded(true);
      // Built-ins retry in the background so a slow-starting one does not hold
      // up the servers the user added.
      for (const config of loaded.filter((c) => !c.builtin)) {
        if (!cancelled) await connectOne(config);
      }
      for (const config of loaded.filter((c) => c.builtin)) {
        if (!cancelled) void connectWithRetry(config);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [connectOne, connectWithRetry]);

  const addServer = useCallback(async (input: Omit<McpServerConfig, 'id' | 'enabled'>) => {
    const config: McpServerConfig = {
      ...input,
      enabled: true,
      id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
    };
    await writeConfigs([...configsRef.current, config]);
    return connectOne(config);
  }, [connectOne, writeConfigs]);

  const removeServer = useCallback(async (id: string) => {
    // Built-ins are part of the app; disabling is the way to turn one off.
    if (configsRef.current.find((c) => c.id === id)?.builtin) return;
    await writeConfigs(configsRef.current.filter((c) => c.id !== id));
    setStates((prev) => {
      const copy = { ...prev };
      delete copy[id];
      return copy;
    });
    await disconnectOne(id);
  }, [disconnectOne, writeConfigs]);

  /** Toggle without discarding the entry: disabling only drops the connection. */
  const setEnabled = useCallback(async (id: string, enabled: boolean) => {
    const next = configsRef.current.map((c) => (c.id === id ? { ...c, enabled } : c));
    await writeConfigs(next);

    const config = next.find((c) => c.id === id);
    if (!config) return;

    if (enabled) {
      await connectOne(config);
    } else {
      await disconnectOne(id);
      setStates((prev) => ({
        ...prev,
        [id]: { id, label: config.label, url: config.url, status: 'disabled', tools: [] }
      }));
    }
  }, [connectOne, disconnectOne, writeConfigs]);

  const renameServer = useCallback(async (id: string, label: string) => {
    const trimmed = label.trim();
    if (!trimmed) return;
    await writeConfigs(configsRef.current.map((c) => (c.id === id ? { ...c, label: trimmed } : c)));
    setStates((prev) => (prev[id] ? { ...prev, [id]: { ...prev[id], label: trimmed } } : prev));
  }, [writeConfigs]);

  const reconnect = useCallback(
    (id: string) => {
      const config = configsRef.current.find((c) => c.id === id);
      return config ? connectOne(config) : Promise.resolve(undefined);
    },
    [connectOne]
  );

  const serverList = configs.map((c) => ({
    ...(states[c.id] ?? {
      id: c.id,
      label: c.label,
      url: c.url,
      status: (c.enabled ? 'connecting' : 'disabled') as McpServerState['status'],
      tools: []
    }),
    builtin: Boolean(c.builtin),
    memory: c.memory
  }));

  const toolCount = serverList.reduce(
    (sum, s) => sum + (s.status === 'connected' ? s.tools.length : 0),
    0
  );

  return {
    servers: serverList,
    configs,
    isLoaded,
    addServer,
    removeServer,
    setEnabled,
    renameServer,
    reconnect,
    toolCount
  };
}
