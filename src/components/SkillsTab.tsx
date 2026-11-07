import { useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { Plus, Trash2, Pencil, Search, X, Zap } from 'lucide-react';
import { Skill } from '../hooks/use-skills';
import { steps } from '../lib/skill-utils';
import Toggle from './Toggle';

interface Draft {
  id?: string;
  name: string;
  trigger: string;
  instructions: string;
}

interface Props {
  skills: Skill[];
  enabledCount: number;
  onSave: (input: Draft) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
  onSetEnabled: (id: string, enabled: boolean) => Promise<void>;
}

const FIELD =
  'w-full bg-black/60 border border-white/20 rounded px-3 py-2 text-[11px] font-mono text-white/90 ' +
  'placeholder:text-white/25 focus:outline-none focus:border-white/60 transition-colors';

const LABEL = 'text-[9px] text-white/50 tracking-widest font-display uppercase mb-1.5 block';

const EXAMPLE = `Open my Library link
Turn the light on
Tell me the three things that matter most`;

export default function SkillsTab({ skills, enabledCount, onSave, onRemove, onSetEnabled }: Props) {
  const [query, setQuery] = useState('');
  const [draft, setDraft] = useState<Draft | null>(null);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const list = needle
      ? skills.filter((s) =>
          [s.name, s.trigger, s.instructions].some((field) =>
            field.toLowerCase().includes(needle)
          )
        )
      : skills;
    return [...list].sort((a, b) => a.name.localeCompare(b.name));
  }, [skills, query]);

  const submit = async () => {
    if (!draft?.name.trim() || !draft.instructions.trim()) return;
    await onSave(draft);
    setDraft(null);
  };

  return (
    <div className="w-full max-w-3xl h-full max-h-[70vh] px-4 flex flex-col">
      <div className="border border-white/20 bg-black/50 backdrop-blur-sm rounded-lg shadow-[0_0_15px_rgba(255,255,255,0.05)] flex flex-col overflow-hidden h-full">
        <div className="text-[10px] text-white/70 tracking-widest px-4 py-3 border-b border-white/20 font-display flex justify-between items-center shrink-0">
          <span>SYS // SKILLS</span>
          <div className="flex items-center gap-4">
            <span className="text-white/40">
              {enabledCount}/{skills.length} ACTIVE
            </span>
            <button
              onClick={() =>
                setDraft(draft ? null : { name: '', trigger: '', instructions: '' })
              }
              title="Add a skill"
              className="text-white/50 hover:text-white transition-colors"
            >
              <Plus className={`w-3.5 h-3.5 transition-transform ${draft ? 'rotate-45' : ''}`} />
            </button>
          </div>
        </div>

        <div className="px-4 py-3 border-b border-white/20 shrink-0 space-y-3">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-white/30 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search skills…"
              spellCheck={false}
              className={`${FIELD} pl-9 pr-8`}
            />
            {query && (
              <button
                onClick={() => setQuery('')}
                title="Clear"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-white/30 hover:text-white transition-colors"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>

          {draft && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={LABEL}>Name</label>
                  <input
                    autoFocus
                    value={draft.name}
                    onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                    placeholder="Morning brief"
                    className={FIELD}
                  />
                </div>
                <div>
                  <label className={LABEL}>Trigger — what you say</label>
                  <input
                    value={draft.trigger}
                    onChange={(e) => setDraft({ ...draft, trigger: e.target.value })}
                    placeholder="run my morning brief"
                    className={FIELD}
                  />
                </div>
              </div>
              <div>
                <label className={LABEL}>Steps — one instruction per line</label>
                <textarea
                  value={draft.instructions}
                  onChange={(e) => setDraft({ ...draft, instructions: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') setDraft(null);
                  }}
                  rows={5}
                  placeholder={EXAMPLE}
                  spellCheck={false}
                  className={`${FIELD} resize-none leading-relaxed`}
                />
              </div>
              <div className="flex justify-end gap-3">
                <button
                  onClick={() => setDraft(null)}
                  className="px-4 py-2 text-[10px] tracking-widest font-display uppercase text-white/50 hover:text-white transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={submit}
                  disabled={!draft.name.trim() || !draft.instructions.trim()}
                  className="px-5 py-2 text-[10px] tracking-widest font-display uppercase border border-white/40 rounded text-white hover:bg-white/10 transition-colors disabled:opacity-40"
                >
                  Save
                </button>
              </div>
            </motion.div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-2">
          {visible.length === 0 && (
            <div className="text-white/30 italic text-[10px] font-mono text-center py-12">
              {skills.length === 0
                ? 'No skills yet. Use + to teach one, then just say its trigger.'
                : 'Nothing matches that search.'}
            </div>
          )}

          {visible.map((skill) => {
            const lines = steps(skill.instructions);
            return (
              <div
                key={skill.id}
                className={`border border-white/15 rounded bg-black/40 px-3 py-2.5 ${skill.enabled ? '' : 'opacity-50'}`}
              >
                <div className="flex items-center gap-3">
                  <Zap
                    className={`w-3.5 h-3.5 shrink-0 ${skill.enabled ? 'text-cyan-400/80' : 'text-white/25'}`}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="text-[11px] font-mono text-white/90 truncate">{skill.name}</div>
                    <div className="text-[9px] font-mono text-white/35 truncate">
                      “{skill.trigger}” · {lines.length} step{lines.length === 1 ? '' : 's'}
                      {skill.useCount > 0 && ` · run ${skill.useCount}×`}
                    </div>
                  </div>

                  <Toggle
                    checked={skill.enabled}
                    onChange={(next) => onSetEnabled(skill.id, next)}
                    title={skill.enabled ? 'Disable this skill' : 'Enable this skill'}
                  />
                  <button
                    onClick={() =>
                      setDraft({
                        id: skill.id,
                        name: skill.name,
                        trigger: skill.trigger,
                        instructions: skill.instructions
                      })
                    }
                    title="Edit"
                    className="text-white/40 hover:text-white transition-colors shrink-0"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => onRemove(skill.id)}
                    title="Delete"
                    className="text-white/40 hover:text-red-400 transition-colors shrink-0"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>

                <ol className="mt-2 pl-6 space-y-0.5">
                  {lines.slice(0, 4).map((line, i) => (
                    <li key={i} className="text-[9px] font-mono text-white/45 truncate">
                      <span className="text-white/25 mr-1.5">{i + 1}.</span>
                      {line}
                    </li>
                  ))}
                  {lines.length > 4 && (
                    <li className="text-[9px] font-mono text-white/25">
                      +{lines.length - 4} more
                    </li>
                  )}
                </ol>
              </div>
            );
          })}
        </div>

        <div className="border-t border-white/20 px-4 py-2.5 text-[9px] font-mono text-white/30 shrink-0">
          Say a trigger and J.A.R.V.I.S. runs it straight away. Reconnect the mic after adding one.
        </div>
      </div>
    </div>
  );
}
