/**
 * Checks the voice-engine choice. Classic must stay exactly what J.A.R.V.I.S.
 * did before Fast existed (same model, same microphone format, built-in Google
 * Search), so going back is always a clean return.
 *
 *   npx tsx tools/test-live-models.ts
 */
import { CLASSIC_DEFAULT_MODEL, FAST_MODEL, NEWEST_MODEL, engineChain, liveProfile, realtimeAudio } from '../src/lib/live-models';
import { DEFAULT_SETTINGS, migrate } from '../src/hooks/use-settings';

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

const classic = liveProfile('classic', 'gemini-2.5-flash-native-audio-preview-12-2025');
check('classic uses the configured model', classic.model, 'gemini-2.5-flash-native-audio-preview-12-2025');
check('classic keeps built-in Google Search', classic.builtInSearch, true);
check('classic has no search helper', classic.searchHelper, false);
check('classic sends the microphone as before (media)', realtimeAudio(classic, 'QUJD'), { media: { mimeType: 'audio/pcm;rate=16000', data: 'QUJD' } });

const fast = liveProfile('fast', 'gemini-2.5-flash-native-audio-preview-12-2025');
check('fast uses Gemini 3.1 Flash Live', fast.model, FAST_MODEL);
check('fast has no built-in Search (refused on this plan)', fast.builtInSearch, false);
check('fast searches through the helper', fast.searchHelper, true);
check('fast sends the microphone as audio', realtimeAudio(fast, 'QUJD'), { audio: { mimeType: 'audio/pcm;rate=16000', data: 'QUJD' } });
check('fast falls back to classic', fast.fallback, 'classic');
check('classic has nothing to fall back to', classic.fallback, null);

check('a custom classic model is honoured', liveProfile('classic', 'my-model').model, 'my-model');
check('an empty classic model uses the default', liveProfile('classic', '').model, CLASSIC_DEFAULT_MODEL);

// The chain: 3.8, then 3.1, then 2.5, each only if the one before will not start.
const newest = liveProfile('newest', '');
check('newest is Gemini 3.8 Live', newest.model, NEWEST_MODEL);
check('3.8 marks its tools blocking', newest.blockingTools, true);
check('3.8 sends audio, not media', realtimeAudio(newest, 'QUJD'), { audio: { mimeType: 'audio/pcm;rate=16000', data: 'QUJD' } });
check('3.8 looks things up through the helper', [newest.builtInSearch, newest.searchHelper], [false, true]);
check('3.8 falls back to 3.1', newest.fallback, 'fast');
check('3.1 falls back to 2.5', liveProfile('fast', '').fallback, 'classic');
check('2.5 is the last', liveProfile('classic', '').fallback, null);
check('the whole chain from 3.8', engineChain('newest'), ['newest', 'fast', 'classic']);
check('starting at 3.1 skips 3.8', engineChain('fast'), ['fast', 'classic']);
check('a renamed 3.8 model is honoured', liveProfile('newest', '', 'gemini-3.9-live').model, 'gemini-3.9-live');
check('an empty 3.8 model uses the default', liveProfile('newest', '', '').model, NEWEST_MODEL);

// Settings
const before = { schemaVersion: 2, geminiKey: 'k', liveModel: 'gemini-2.5-flash-native-audio-preview-12-2025', voiceName: 'Charon', extractModel: 'gemini-flash-latest', mem0Key: '' };
check('new settings start on the newest engine', DEFAULT_SETTINGS.liveEngine, 'newest');
check('settings without an engine start on the newest', migrate(before).liveEngine, 'newest');
check('a chosen engine is kept', migrate({ ...before, liveEngine: 'classic' }).liveEngine, 'classic');
check('3.1 can be chosen', migrate({ ...before, liveEngine: 'fast' }).liveEngine, 'fast');
check('nonsense falls back to the newest', migrate({ ...before, liveEngine: 'turbo' }).liveEngine, 'newest');
check('no home city by default', migrate(before).homeCity, '');
check('the 3.8 model defaults to gemini-3.8-live', migrate(before).newestModel, 'gemini-3.8-live');
check('a set 3.8 model is kept', migrate({ ...before, newestModel: 'gemini-3.9-live' }).newestModel, 'gemini-3.9-live');
check('the 2.5 model setting is left alone', migrate(before).liveModel, before.liveModel);
check('no key is ever built in', DEFAULT_SETTINGS.geminiKey + DEFAULT_SETTINGS.mem0Key, '');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
