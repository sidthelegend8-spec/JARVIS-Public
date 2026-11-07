/**
 * Checks which Windows voice says "Welcome back" when J.A.R.V.I.S. is not in
 * a live session: a British male voice when there is one, sensible fallbacks
 * when not.
 *
 *   npx tsx tools/test-speak.ts
 */
import { pickVoice, VoiceLike } from '../src/lib/speak';

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

const v = (name: string, lang: string): VoiceLike => ({ name, lang });
const DAVID = v('Microsoft David - English (United States)', 'en-US');
const ZIRA = v('Microsoft Zira - English (United States)', 'en-US');
const GEORGE = v('Microsoft George - English (United Kingdom)', 'en-GB');
const HAZEL = v('Microsoft Hazel - English (United Kingdom)', 'en-GB');
const HEIKO = v('Microsoft Heiko - German (Germany)', 'de-DE');

check('British male voice wins', pickVoice([ZIRA, DAVID, HAZEL, GEORGE])?.name, GEORGE.name);
check('then any British voice', pickVoice([ZIRA, DAVID, HAZEL])?.name, HAZEL.name);
check('then David', pickVoice([ZIRA, DAVID, HEIKO])?.name, DAVID.name);
check('then any English voice', pickVoice([HEIKO, ZIRA])?.name, ZIRA.name);
check('then whatever there is', pickVoice([HEIKO])?.name, HEIKO.name);
check('lang tags with underscores still count', pickVoice([v('Some Voice', 'en_GB'), DAVID])?.name, 'Some Voice');
check('nothing installed', pickVoice([]), null);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
