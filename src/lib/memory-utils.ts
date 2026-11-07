export type MemoryKind = 'fact' | 'manual' | 'system';

export interface Memory {
  id: string;
  text: string;
  kind: MemoryKind;
  /** Starred memories never decay and are never pruned. */
  starred: boolean;
  createdAt: number;
  /** Last time this was recalled or edited; recall reinforces. */
  lastSeenAt: number;
  /** mem0 id when the memory also lives in the cloud. */
  mem0Id?: string;
  source?: string;
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** Everything starts here — deliberately not 1.0, so nothing is certain. */
export const BASE_WEIGHT = 0.9;
/** Retained fraction per elapsed week. */
export const WEEKLY_RETENTION = 0.9;
/** Below this a memory is considered faded and can be pruned. */
export const PRUNE_THRESHOLD = 0.1;

export const TWO_WEEKS_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * Strength of a memory now: 0.9 at creation, losing 10% of what remains every
 * week. Recall counts as reinforcement, so decay runs from lastSeenAt rather
 * than creation — something referred to often stays sharp.
 */
export function weightOf(memory: Memory, now: number = Date.now()): number {
  if (memory.starred) return 1;
  const weeks = Math.max(0, (now - memory.lastSeenAt) / WEEK_MS);
  return BASE_WEIGHT * Math.pow(WEEKLY_RETENTION, weeks);
}

export const isFaded = (memory: Memory, now: number = Date.now()) =>
  !memory.starred && weightOf(memory, now) < PRUNE_THRESHOLD;

/** Weeks until this memory fades, for display. */
export function weeksRemaining(memory: Memory, now: number = Date.now()): number | null {
  if (memory.starred) return null;
  const current = weightOf(memory, now);
  if (current < PRUNE_THRESHOLD) return 0;
  return Math.log(PRUNE_THRESHOLD / current) / Math.log(WEEKLY_RETENTION);
}

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'is', 'are', 'was', 'were', 'be', 'been',
  'to', 'of', 'in', 'on', 'at', 'for', 'with', 'my', 'i', 'me', 'you', 'it',
  'that', 'this', 'his', 'her', 'they', 'them', 'what', 'when', 'how', 'do', 'does'
]);

const tokenize = (text: string) =>
  text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2 && !STOPWORDS.has(t));

/**
 * Keyword overlap, weighted by how strongly the memory is held. Deliberately
 * simple: this is the fallback that must work with no key, no network and no
 * embedding model. mem0 supplies semantic recall when it is configured.
 */
export function scoreMemory(memory: Memory, queryTokens: string[], now: number = Date.now()): number {
  if (queryTokens.length === 0) return weightOf(memory, now);
  const tokens = new Set(tokenize(memory.text));
  if (tokens.size === 0) return 0;

  let hits = 0;
  for (const token of queryTokens) if (tokens.has(token)) hits++;
  const overlap = hits / queryTokens.length;
  return overlap * weightOf(memory, now);
}

export function searchMemories(memories: Memory[], query: string, limit = 8): Memory[] {
  const tokens = tokenize(query);
  const now = Date.now();
  return memories
    .map((m) => ({ m, score: scoreMemory(m, tokens, now) }))
    .filter((entry) => entry.score > 0.05)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((entry) => entry.m);
}

/**
 * What a fresh session is told. Starred memories always survive the cut, then
 * the last fortnight by strength — so replacing the API key does not cost
 * J.A.R.V.I.S. its recent history, which lives here rather than with the key.
 */
export function buildBrief(memories: Memory[], maxChars = 2200, now: number = Date.now()): string {
  const starred = memories.filter((m) => m.starred);
  const recent = memories
    .filter((m) => !m.starred && now - m.createdAt <= TWO_WEEKS_MS)
    .sort((a, b) => weightOf(b, now) - weightOf(a, now));

  const lines: string[] = [];
  let budget = maxChars;

  const push = (prefix: string, items: Memory[]) => {
    for (const memory of items) {
      const line = `${prefix}${memory.text}`;
      if (line.length + 1 > budget) return;
      lines.push(line);
      budget -= line.length + 1;
    }
  };

  push('- ', starred);
  push('- ', recent);

  return lines.join('\n');
}

export function pruneFaded(memories: Memory[], now: number = Date.now()): Memory[] {
  return memories.filter((m) => !isFaded(m, now));
}

export const newMemoryId = () =>
  `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

/** Fold in new facts, skipping ones already held near-verbatim. */
export function mergeFacts(
  existing: Memory[],
  facts: string[],
  kind: MemoryKind = 'fact',
  source?: string
): Memory[] {
  const seen = new Set(existing.map((m) => m.text.trim().toLowerCase()));
  const now = Date.now();
  const additions: Memory[] = [];

  for (const raw of facts) {
    const text = raw.trim();
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    additions.push({
      id: newMemoryId(),
      text,
      kind,
      starred: false,
      createdAt: now,
      lastSeenAt: now,
      source
    });
  }

  return additions;
}
