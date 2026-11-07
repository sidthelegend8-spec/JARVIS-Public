/**
 * Checks the decision the Skills feature turns on: which saved skill a spoken
 * phrase names.
 *
 * The matching is a pure function precisely so it can be checked here, without
 * a browser, a microphone or a live session.
 *
 *   npx tsx tools/test-skills.ts
 */
import { Skill, resolveSkill, steps, normalise } from '../src/lib/skill-utils';

let passed = 0;
let failed = 0;

function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    passed++;
    console.log(`  ok   ${label}`);
  } else {
    failed++;
    console.log(`  FAIL ${label}\n         expected ${JSON.stringify(expected)}\n         actual   ${JSON.stringify(actual)}`);
  }
}

const skill = (name: string, trigger: string, enabled = true): Skill => ({
  id: name.toLowerCase().replace(/\s+/g, '-'),
  name,
  trigger,
  instructions: 'Step one\nStep two',
  enabled,
  createdAt: '2026-01-01T00:00:00.000Z',
  useCount: 0
});

const SKILLS: Skill[] = [
  skill('Morning brief', 'run my morning brief'),
  skill('Study mode', 'study mode'),
  skill('Deep study mode', 'deep study mode'),
  skill('Wind down', 'wind down'),
  skill('Retired routine', 'retired routine', false)
];

const found = (spoken: string) => resolveSkill(SKILLS, spoken)?.name ?? null;

console.log('\nresolveSkill — exactly as saved');
check('trigger verbatim', found('run my morning brief'), 'Morning brief');
check('name instead of trigger', found('Morning brief'), 'Morning brief');
check('case and punctuation ignored', found('MORNING BRIEF!'), 'Morning brief');

console.log('\nresolveSkill — the way people actually speak');
check('leading please', found('please run my morning brief'), 'Morning brief');
check('leading can you', found('can you run my morning brief'), 'Morning brief');
check('addressed by name', found('Jarvis, study mode'), 'Study mode');
check('trailing words', found('study mode please'), 'Study mode');
check('inside a sentence', found('ok lets do wind down now'), 'Wind down');
check('bare verb stripped', found('run study mode'), 'Study mode');
check('start instead of run', found('start my morning brief'), 'Morning brief');

console.log('\nresolveSkill — the specific one wins');
check('longer trigger beats its own substring', found('deep study mode'), 'Deep study mode');
check('shorter trigger still reachable', found('study mode'), 'Study mode');

console.log('\nresolveSkill — refuses rather than guesses');
check('unknown phrase', found('order me a pizza'), null);
check('empty', found('   '), null);
check('disabled skill is invisible', found('retired routine'), null);
check('one shared word is not enough', found('what is the weather this morning'), null);
check('nothing saved', resolveSkill([], 'morning brief'), null);

console.log('\nnormalise / steps');
check('normalise strips punctuation', normalise("  Morning's Brief!! "), 'morning s brief');
check('steps splits lines', steps('One\nTwo\nThree'), ['One', 'Two', 'Three']);
check('steps drops numbering', steps('1. One\n2) Two\n- Three\n* Four'), ['One', 'Two', 'Three', 'Four']);
check('steps ignores blank lines', steps('One\n\n\nTwo\n   \n'), ['One', 'Two']);

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
