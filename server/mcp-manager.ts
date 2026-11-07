import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';

export type McpTransport = 'auto' | 'http' | 'sse';

export interface McpServerConfig {
  id: string;
  label: string;
  url: string;
  transport?: McpTransport;
  /** Extra request headers, typically Authorization. */
  headers?: Record<string, string>;
}

export interface McpToolInfo {
  /** Name as the MCP server knows it. */
  name: string;
  /** Collision-free name exposed to the model. */
  qualifiedName: string;
  description: string;
  parameters: GeminiSchema;
}

export interface McpServerState {
  id: string;
  label: string;
  url: string;
  transport: McpTransport;
  status: 'connected' | 'error';
  error?: string;
  tools: McpToolInfo[];
}

interface Connection {
  config: McpServerConfig;
  client: Client | null;
  state: McpServerState;
}

interface GeminiSchema {
  type: string;
  description?: string;
  enum?: string[];
  properties?: Record<string, GeminiSchema>;
  required?: string[];
  items?: GeminiSchema;
}

const CONNECT_TIMEOUT_MS = 20000;
const CALL_TIMEOUT_MS = 60000;

const JSON_TYPE_TO_GEMINI: Record<string, string> = {
  string: 'STRING',
  number: 'NUMBER',
  integer: 'INTEGER',
  boolean: 'BOOLEAN',
  array: 'ARRAY',
  object: 'OBJECT'
};

/**
 * MCP tools advertise full JSON Schema; Gemini accepts a small subset and
 * rejects unknown keywords outright. Anything it cannot represent ($ref,
 * anyOf, additionalProperties, …) is dropped rather than passed through.
 */
function toGeminiSchema(node: any, depth = 0): GeminiSchema {
  if (!node || typeof node !== 'object' || depth > 8) return { type: 'STRING' };

  // Unions such as ["string","null"] collapse to their first real type.
  let rawType = node.type;
  if (Array.isArray(rawType)) rawType = rawType.find((t: string) => t && t !== 'null');

  // A node with properties but no declared type is an object in practice.
  if (!rawType) rawType = node.properties ? 'object' : 'string';

  const type = JSON_TYPE_TO_GEMINI[rawType] || 'STRING';
  const schema: GeminiSchema = { type };

  if (typeof node.description === 'string') schema.description = node.description;
  if (Array.isArray(node.enum)) {
    schema.enum = node.enum.filter((v: unknown) => typeof v === 'string');
    if (schema.enum.length === 0) delete schema.enum;
  }

  if (type === 'OBJECT') {
    schema.properties = {};
    for (const [key, value] of Object.entries(node.properties || {})) {
      schema.properties[key] = toGeminiSchema(value, depth + 1);
    }
    const required = Array.isArray(node.required)
      ? node.required.filter((r: unknown) => typeof r === 'string' && schema.properties![r])
      : [];
    if (required.length > 0) schema.required = required;
  }

  if (type === 'ARRAY') {
    schema.items = toGeminiSchema(node.items, depth + 1);
  }

  return schema;
}

/** Gemini function names allow [A-Za-z0-9_.-], must not lead with a digit, max 64. */
function slug(value: string): string {
  return value.replace(/[^a-zA-Z0-9_]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
}

export class McpManager {
  private connections = new Map<string, Connection>();
  /** qualifiedName -> owning server + original tool name. */
  private toolIndex = new Map<string, { serverId: string; toolName: string }>();

  private qualify(serverId: string, toolName: string): string {
    const base = `mcp_${slug(serverId)}_${slug(toolName)}`.slice(0, 60) || 'mcp_tool';
    if (!this.toolIndex.has(base)) return base;

    // Two servers can legitimately expose the same tool name.
    let n = 2;
    while (this.toolIndex.has(`${base}_${n}`)) n++;
    return `${base}_${n}`;
  }

  private clearToolsFor(serverId: string) {
    for (const [qualified, owner] of this.toolIndex) {
      if (owner.serverId === serverId) this.toolIndex.delete(qualified);
    }
  }

  private async buildClient(config: McpServerConfig): Promise<Client> {
    const url = new URL(config.url);
    const requestInit = config.headers && Object.keys(config.headers).length > 0
      ? { headers: config.headers }
      : undefined;

    const attempt = async (kind: 'http' | 'sse') => {
      const client = new Client(
        { name: 'jarvis', version: '0.1.0' },
        { capabilities: {} }
      );
      const transport =
        kind === 'http'
          ? new StreamableHTTPClientTransport(url, { requestInit })
          : new SSEClientTransport(url, { requestInit });

      await withTimeout(client.connect(transport), CONNECT_TIMEOUT_MS, `connect (${kind})`);
      return client;
    };

    const mode = config.transport ?? 'auto';
    if (mode !== 'auto') return attempt(mode);

    // Streamable HTTP is current; SSE is the older shape still widely deployed.
    try {
      return await attempt('http');
    } catch (httpErr: any) {
      try {
        return await attempt('sse');
      } catch {
        throw httpErr;
      }
    }
  }

  async connect(config: McpServerConfig): Promise<McpServerState> {
    await this.disconnect(config.id);

    const state: McpServerState = {
      id: config.id,
      label: config.label || config.id,
      url: config.url,
      transport: config.transport ?? 'auto',
      status: 'error',
      tools: []
    };

    try {
      const client = await this.buildClient(config);
      const { tools } = await withTimeout(client.listTools(), CONNECT_TIMEOUT_MS, 'listTools');

      state.tools = (tools || []).map((tool: any) => {
        const qualifiedName = this.qualify(config.id, tool.name);
        this.toolIndex.set(qualifiedName, { serverId: config.id, toolName: tool.name });
        return {
          name: tool.name,
          qualifiedName,
          description: (tool.description || tool.title || tool.name).slice(0, 1024),
          parameters: toGeminiSchema(tool.inputSchema)
        };
      });
      state.status = 'connected';

      this.connections.set(config.id, { config, client, state });
    } catch (e: any) {
      state.status = 'error';
      state.error = describeConnectError(e, config.url);
      this.connections.set(config.id, { config, client: null, state });
    }

    return state;
  }

  async disconnect(serverId: string): Promise<void> {
    const existing = this.connections.get(serverId);
    if (!existing) return;

    this.clearToolsFor(serverId);
    this.connections.delete(serverId);

    try {
      await existing.client?.close();
    } catch (e) {
      console.error(`Error closing MCP server ${serverId}:`, e);
    }
  }

  list(): McpServerState[] {
    return [...this.connections.values()].map((c) => c.state);
  }

  /** Declarations for every connected tool, ready to hand to Gemini. */
  declarations() {
    return this.list()
      .filter((s) => s.status === 'connected')
      .flatMap((s) =>
        s.tools.map((t) => ({
          name: t.qualifiedName,
          description: t.description,
          parameters: t.parameters
        }))
      );
  }

  isMcpTool(qualifiedName: string): boolean {
    return this.toolIndex.has(qualifiedName);
  }

  async callTool(qualifiedName: string, args: Record<string, unknown>) {
    const owner = this.toolIndex.get(qualifiedName);
    if (!owner) throw new Error(`Unknown MCP tool: ${qualifiedName}`);

    const connection = this.connections.get(owner.serverId);
    if (!connection?.client) throw new Error(`MCP server ${owner.serverId} is not connected`);

    const result: any = await withTimeout(
      connection.client.callTool({ name: owner.toolName, arguments: args || {} }),
      CALL_TIMEOUT_MS,
      `call ${owner.toolName}`
    );

    // Flatten MCP's content blocks into something speakable.
    const text = (result?.content || [])
      .map((block: any) => {
        if (block?.type === 'text') return block.text;
        if (block?.type === 'resource') return block.resource?.text ?? '[resource]';
        return `[${block?.type || 'content'}]`;
      })
      .filter(Boolean)
      .join('\n')
      .trim();

    return {
      isError: Boolean(result?.isError),
      text: text || (result?.isError ? 'Tool reported an error.' : 'Done.'),
      structured: result?.structuredContent ?? null
    };
  }

  async closeAll() {
    await Promise.all([...this.connections.keys()].map((id) => this.disconnect(id)));
  }
}

/**
 * Node reports a refused connection as a bare "fetch failed", which says
 * nothing about what to do. A saved MCP server whose process simply is not
 * running is by far the most common cause, so name that.
 */
function describeConnectError(error: any, url: string): string {
  const message = error?.message || String(error);
  const code = error?.cause?.code || error?.code || '';

  if (/fetch failed/i.test(message) || /ECONNREFUSED|ENOTFOUND|EAI_AGAIN/i.test(code)) {
    let where = url;
    try {
      const parsed = new URL(url);
      where = parsed.host;
    } catch {
      /* keep the raw string */
    }
    const isLocal = /^(127\.0\.0\.1|localhost)/i.test(where);
    return isLocal
      ? `Nothing is answering at ${where}. The server is not running — start it, then hit reconnect.`
      : `Could not reach ${where}. Check the URL and that the server is online.`;
  }

  if (/401|403|unauthor|forbidden/i.test(message)) {
    return `${where(url)} refused the connection as unauthorised. Check the auth header on this server.`;
  }

  if (/timed out/i.test(message)) {
    return `${where(url)} did not respond in time. It may be starting up — try reconnect in a moment.`;
  }

  return message;
}

const where = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`MCP ${label} timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}
