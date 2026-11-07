import { useState, useEffect, useCallback, useRef } from 'react';
import { Skill, resolveSkill, newSkillId } from '../lib/skill-utils';

export type { Skill } from '../lib/skill-utils';

const STORAGE_KEY = 'jarvis.skills';

const bridge = () => (typeof window !== 'undefined' ? (window as any).jarvis : undefined);

/** Fill in anything a hand-edited or older entry is missing. */
const hydrate = (raw: any): Skill | null => {
  const name = String(raw?.name ?? '').trim();
  const instructions = String(raw?.instructions ?? '').trim();
  if (!name || !instructions) return null;
  return {
    id: String(raw.id || newSkillId()),
    name,
    trigger: String(raw.trigger ?? '').trim() || name,
    instructions,
    enabled: raw.enabled !== false,
    createdAt: raw.createdAt || new Date().toISOString(),
    useCount: Number(raw.useCount) || 0,
    lastUsedAt: raw.lastUsedAt
  };
};

async function loadSkills(): Promise<Skill[]> {
  const api = bridge();
  let stored: unknown = null;
  if (api?.loadSkills) {
    try {
      stored = await api.loadSkills();
    } catch (e) {
      console.error('Failed to load skills', e);
      return [];
    }
  } else {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      stored = raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }
  return Array.isArray(stored) ? stored.map(hydrate).filter((s): s is Skill => s !== null) : [];
}

async function persistSkills(skills: Skill[]): Promise<void> {
  const api = bridge();
  if (api?.saveSkills) {
    // The main process reports a failed write by returning false. Ignoring it
    // is how a skill can look saved in the tab and be gone after a restart.
    const ok = await api.saveSkills(skills);
    if (ok === false) {
      console.error('[skills] the write failed — these skills will not survive a restart');
    }
    return;
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(skills));
}

export function useSkills() {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);
  const skillsRef = useRef<Skill[]>([]);
  /**
   * Resolves once the saved skills have been read.
   *
   * Every mutation writes the whole list back, so acting before the read
   * finishes would write the empty starting state over a full file. Waiting
   * costs a few milliseconds at startup and removes that possibility entirely.
   */
  const readyRef = useRef<Promise<void> | null>(null);

  const commit = useCallback(async (next: Skill[]) => {
    skillsRef.current = next;
    setSkills(next);
    await persistSkills(next);
  }, []);

  useEffect(() => {
    let cancelled = false;
    readyRef.current = loadSkills().then((loaded) => {
      if (cancelled) return;
      skillsRef.current = loaded;
      setSkills(loaded);
      setIsLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const saveSkill = useCallback(
    async (input: { id?: string; name: string; trigger: string; instructions: string }) => {
      const name = input.name.trim();
      const instructions = input.instructions.trim();
      if (!name || !instructions) return;
      const trigger = input.trigger.trim() || name;

      await readyRef.current;
      const existing = skillsRef.current;
      if (input.id && existing.some((s) => s.id === input.id)) {
        await commit(
          existing.map((s) => (s.id === input.id ? { ...s, name, trigger, instructions } : s))
        );
        return;
      }
      await commit([
        ...existing,
        {
          id: newSkillId(),
          name,
          trigger,
          instructions,
          enabled: true,
          createdAt: new Date().toISOString(),
          useCount: 0
        }
      ]);
    },
    [commit]
  );

  const removeSkill = useCallback(
    async (id: string) => {
      await readyRef.current;
      return commit(skillsRef.current.filter((s) => s.id !== id));
    },
    [commit]
  );

  const setEnabled = useCallback(
    async (id: string, enabled: boolean) => {
      await readyRef.current;
      return commit(skillsRef.current.map((s) => (s.id === id ? { ...s, enabled } : s)));
    },
    [commit]
  );

  /** Enabled skills only, for briefing the model on what it can be asked to run. */
  const listForModel = useCallback(
    () => skillsRef.current.filter((s) => s.enabled).map((s) => ({ name: s.name, trigger: s.trigger })),
    []
  );

  const resolve = useCallback((spoken: string) => resolveSkill(skillsRef.current, spoken), []);

  /** Recorded after a run, so the tab shows which skills actually get used. */
  const markUsed = useCallback(
    (id: string) => {
      void (async () => {
        await readyRef.current;
        await commit(
          skillsRef.current.map((s) =>
            s.id === id
              ? { ...s, useCount: s.useCount + 1, lastUsedAt: new Date().toISOString() }
              : s
          )
        );
      })();
    },
    [commit]
  );

  const enabledCount = skills.filter((s) => s.enabled).length;

  return {
    skills,
    isLoaded,
    enabledCount,
    saveSkill,
    removeSkill,
    setEnabled,
    listForModel,
    resolve,
    markUsed
  };
}
