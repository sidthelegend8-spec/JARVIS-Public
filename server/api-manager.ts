/**
 * Turns connected API providers into callable tools. The user supplies only a
 * name and a key; everything about the request comes from the provider entry.
 *
 * Requests are issued here rather than in the renderer: it keeps API keys out
 * of the page and sidesteps CORS.
 */
import { ApiProvider, findProvider } from './api-providers';

export interface ApiToolConfig {
  id: string;
  /** Which built-in provider this is an instance of. */
  provider: string;
  /** Display name; the model sees a sanitized `api_<name>`. */
  name: string;
  apiKey?: string;
  enabled: boolean;
}

const DEFAULT_MAX_CHARS = 4000;
const CALL_TIMEOUT_MS = 30000;

const slug = (value: string) =>
  value.replace(/[^a-zA-Z0-9_]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '').toLowerCase();

export const qualifyApiName = (name: string) => `api_${slug(name) || 'tool'}`.slice(0, 60);

/**
 * Replace {placeholder} values, escaped for the context they land in, so a
 * quote or ampersand in a query cannot corrupt the URL or the JSON body.
 */
function fill(template: string, values: Record<string, unknown>, mode: 'url' | 'body' | 'raw'): string {
  return template.replace(/\{(\w+)\}/g, (_match, key: string) => {
    const value = values[key];
    if (value === undefined || value === null) return '';
    const str = String(value);
    if (mode === 'url') return encodeURIComponent(str);
    // Strip the surrounding quotes; the template already supplies them.
    if (mode === 'body') return JSON.stringify(str).slice(1, -1);
    return str;
  });
}

function extractPath(payload: unknown, path?: string): unknown {
  if (!path) return payload;
  let current: any = payload;
  for (const segment of path.split('.')) {
    if (current == null) return null;
    current = current[segment];
  }
  return current ?? null;
}

export class ApiManager {
  private tools = new Map<string, { config: ApiToolConfig; provider: ApiProvider }>();

  /** The renderer owns the list; this mirrors the usable entries. */
  sync(configs: ApiToolConfig[]): number {
    this.tools.clear();
    for (const config of configs) {
      if (!config?.name || config.enabled === false) continue;
      const provider = findProvider(config.provider);
      if (!provider) continue;
      // A provider that needs a key but has none would fail on every call.
      if (provider.requiresKey && !config.apiKey?.trim()) continue;
      this.tools.set(qualifyApiName(config.name), { config, provider });
    }
    return this.tools.size;
  }

  isApiTool(name: string): boolean {
    return this.tools.has(name);
  }

  /** Who each tool belongs to, so an approval prompt can name it in English. */
  list() {
    return [...this.tools.entries()].map(([qualifiedName, { config, provider }]) => ({
      qualifiedName,
      label: config.name,
      provider: provider.label,
      description: provider.description
    }));
  }

  declarations() {
    return [...this.tools.entries()].map(([qualifiedName, { provider }]) => {
      const properties: Record<string, { type: string; description?: string }> = {};
      for (const param of provider.params) {
        properties[param.name] = { type: 'STRING', description: param.description };
      }
      const required = provider.params.filter((p) => p.required).map((p) => p.name);

      return {
        name: qualifiedName,
        description: provider.description,
        parameters: {
          type: 'OBJECT',
          properties,
          ...(required.length > 0 ? { required } : {})
        }
      };
    });
  }

  async call(qualifiedName: string, args: Record<string, unknown>) {
    const entry = this.tools.get(qualifiedName);
    if (!entry) throw new Error(`Unknown API tool: ${qualifiedName}`);
    return this.execute(entry.provider, entry.config.apiKey, args);
  }

  /** Shared by live calls and the tab's test button. */
  async execute(provider: ApiProvider, apiKey: string | undefined, args: Record<string, unknown>) {
    const values = { ...args, API_KEY: apiKey || '' };

    const url = fill(provider.url, values, 'url');
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      throw new Error(`Resolved URL is not valid: ${url}`);
    }
    if (!/^https?:$/.test(parsedUrl.protocol)) {
      throw new Error('Only http and https URLs are allowed');
    }

    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(provider.headers || {})) {
      headers[key] = fill(value, values, 'raw');
    }

    let body: string | undefined;
    if (provider.method === 'POST' && provider.bodyTemplate) {
      body = fill(provider.bodyTemplate, values, 'body');
      if (!Object.keys(headers).some((h) => h.toLowerCase() === 'content-type')) {
        headers['Content-Type'] = 'application/json';
      }
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CALL_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        method: provider.method,
        headers,
        body,
        signal: controller.signal
      });
      const raw = await response.text();

      if (!response.ok) {
        return {
          isError: true,
          // Redact: some providers echo the key back in error payloads.
          text: `Request failed (${response.status}): ${redact(raw.slice(0, 500), apiKey)}`,
          status: response.status
        };
      }

      let payload: unknown = raw;
      try {
        payload = JSON.parse(raw);
      } catch {
        /* not JSON; the raw text is the result */
      }

      const narrowed = typeof payload === 'string' ? payload : extractPath(payload, provider.resultPath);
      const text = typeof narrowed === 'string' ? narrowed : JSON.stringify(narrowed);

      // Results are re-fed to the model, so an unbounded payload would blow
      // the context window.
      return {
        isError: false,
        text:
          text.length > DEFAULT_MAX_CHARS
            ? `${text.slice(0, DEFAULT_MAX_CHARS)}\n…[truncated ${text.length - DEFAULT_MAX_CHARS} chars]`
            : text,
        status: response.status
      };
    } catch (e: any) {
      if (e?.name === 'AbortError') throw new Error(`Request timed out after ${CALL_TIMEOUT_MS}ms`);
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }
}

function redact(text: string, apiKey?: string): string {
  return apiKey && apiKey.length > 6 ? text.split(apiKey).join('[key]') : text;
}
