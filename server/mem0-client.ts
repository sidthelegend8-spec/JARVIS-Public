/**
 * Thin client for the mem0 cloud API.
 *
 * mem0 is the semantic half of the memory system, not the whole of it. Its
 * self-hosted mode needs Qdrant and an embedding provider, which cannot be
 * shipped inside a desktop installer, so this talks to the hosted API with the
 * user's key. Every call is best-effort: the local store is authoritative and
 * must keep working when this is absent, unconfigured or down.
 */

const BASE = 'https://api.mem0.ai';
const TIMEOUT_MS = 15000;

export interface Mem0Result {
  id: string;
  memory: string;
  score?: number;
  created_at?: string;
}

async function request(
  path: string,
  apiKey: string,
  init: { method: string; body?: unknown }
): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(`${BASE}${path}`, {
      method: init.method,
      headers: {
        Authorization: `Token ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: controller.signal
    });

    const text = await response.text();
    if (!response.ok) {
      throw new Error(`mem0 ${init.method} ${path} failed (${response.status}): ${text.slice(0, 300)}`);
    }
    try {
      return text ? JSON.parse(text) : null;
    } catch {
      return null;
    }
  } catch (e: any) {
    if (e?.name === 'AbortError') throw new Error(`mem0 request timed out after ${TIMEOUT_MS}ms`);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/** mem0 does its own extraction, so raw conversation turns are handed over. */
export async function mem0Add(
  apiKey: string,
  userId: string,
  messages: { role: string; content: string }[],
  metadata?: Record<string, unknown>
) {
  return request('/v3/memories/add/', apiKey, {
    method: 'POST',
    body: { user_id: userId, messages, ...(metadata ? { metadata } : {}) }
  });
}

export async function mem0Search(
  apiKey: string,
  userId: string,
  query: string,
  topK = 8
): Promise<Mem0Result[]> {
  // Entity ids must sit inside `filters`; at the top level the API 400s.
  const data = await request('/v3/memories/search/', apiKey, {
    method: 'POST',
    body: { query, filters: { user_id: userId }, top_k: topK }
  });
  return Array.isArray(data?.results) ? data.results : [];
}

export async function mem0Delete(apiKey: string, memoryId: string) {
  return request(`/v1/memories/${encodeURIComponent(memoryId)}/`, apiKey, { method: 'DELETE' });
}

export async function mem0Ping(apiKey: string): Promise<boolean> {
  // A trivial search is the cheapest way to prove a key works.
  await mem0Search(apiKey, 'jarvis-connectivity-probe', 'ping', 1);
  return true;
}
