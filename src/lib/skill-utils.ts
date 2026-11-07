/**
 * Skills: a phrase the user says, and the steps J.A.R.V.I.S. follows when it
 * hears it.
 *
 * The matching lives here rather than in the hook because speech is the only
 * way a skill is ever named, and speech is never exact — "run my morning
 * brief", "morning brief please", "Morning Brief." all have to find the same
 * entry. Keeping it as a pure function also makes it testable without a
 * browser.
 */

export interface Skill {
  id: string;
  /** What the user calls it, shown in the tab and spoken back. */
  name: string;
  /** The word or sentence that sets it off. */
  trigger: string;
  /** The steps to follow, in plain English, one per line. */
  instructions: string;
  enabled: boolean;
  createdAt: string;
  useCount: number;
  lastUsedAt?: string;
}

/** Lowercase, unpunctuated, single-spaced — the form everything compares in. */
export const normalise = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** Words that only ever introduce a request, never identify the skill itself. */
const LEAD_WORDS =
  /^(?:please\s+|can\s+you\s+|could\s+you\s+|would\s+you\s+|jarvis[\s,]+|hey\s+jarvis[\s,]+|now\s+|go\s+|run\s+|do\s+|start\s+|begin\s+|execute\s+|perform\s+|use\s+|activate\s+|trigger\s+|launch\s+|the\s+|my\s+|a\s+)+/;

const strip = (value: string): string => normalise(value).replace(LEAD_WORDS, '').trim();

const words = (value: string): string[] => value.split(' ').filter(Boolean);

/**
 * Overlap in both directions, so a two-word trigger inside a ten-word sentence
 * does not score the same as a genuine near-match.
 */
function overlap(a: string, b: string): number {
  const left = words(a);
  const right = new Set(words(b));
  if (left.length === 0 || right.size === 0) return 0;
  const shared = left.filter((w) => right.has(w)).length;
  return shared / Math.max(left.length, right.size);
}

/**
 * Find the skill the user just named.
 *
 * Works down from certainty to likelihood, and stops at the first tier that
 * produces a hit, so a exact trigger always beats a loose word overlap
 * elsewhere in the list. Disabled skills are never returned.
 */
export function resolveSkill(skills: Skill[], spoken: string): Skill | null {
  const live = skills.filter((s) => s.enabled);
  const said = normalise(spoken);
  if (!said || live.length === 0) return null;

  const stripped = strip(spoken);
  const forms = (skill: Skill) => [normalise(skill.trigger), normalise(skill.name)].filter(Boolean);

  // 1. Said exactly, with or without the leading "run my…".
  for (const skill of live) {
    if (forms(skill).some((f) => f === said || f === stripped)) return skill;
  }

  // 2. The trigger sits inside a longer sentence: "ok, morning brief then".
  //    Longest trigger first, so a specific one is not shadowed by a shorter
  //    trigger that happens to be a substring of it.
  const contained = live
    .flatMap((skill) => forms(skill).map((form) => ({ skill, form })))
    .filter(({ form }) => form.length > 0 && (said.includes(form) || stripped.includes(form)))
    .sort((a, b) => b.form.length - a.form.length);
  if (contained.length > 0) return contained[0].skill;

  // 3. Only part of it came through. Demand a strong overlap: a wrong skill
  //    firing is worse than admitting the name was not recognised.
  let best: { skill: Skill; score: number } | null = null;
  for (const skill of live) {
    for (const form of forms(skill)) {
      const score = Math.max(overlap(form, stripped), overlap(form, said));
      if (score >= 0.6 && (!best || score > best.score)) best = { skill, score };
    }
  }
  return best?.skill ?? null;
}

/** First line of the steps, for the list and the confirmation prompt. */
export const summarise = (instructions: string, max = 90): string => {
  const first = instructions.split('\n').map((l) => l.trim()).find(Boolean) || '';
  return first.length > max ? `${first.slice(0, max)}…` : first;
};

/** Steps as a numbered list, which is how they are handed to the model. */
export const steps = (instructions: string): string[] =>
  instructions
    .split('\n')
    .map((line) => line.replace(/^\s*(?:\d+[.)]|[-*•])\s*/, '').trim())
    .filter(Boolean);

export const newSkillId = (): string =>
  `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
