/**
 * Checks which microphone J.A.R.V.I.S. listens on. Phone-as-webcam apps (Camo
 * and the like) add a microphone and often become the Windows default; it is
 * silent unless the phone is streaming audio, and J.A.R.V.I.S. went deaf.
 *
 *   npx tsx tools/test-microphone.ts
 */
import { isVirtualMic, pickMicrophone } from '../src/lib/microphone';

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

const mic = (deviceId: string, label: string) => ({ deviceId, label, kind: 'audioinput' });

// What this PC reported, word for word.
const THIS_PC = [
  mic('default', 'Default - Microphone (Camo)'),
  mic('communications', 'Communications - Microphone (Camo)'),
  mic('fa2411995348', 'Microphone (Camo)'),
  mic('30e1e2841297', 'Headset (WH-1000XM4) (Bluetooth)'),
  { deviceId: 'default', label: 'Default - Headphones (WH-1000XM4) (Bluetooth)', kind: 'audiooutput' }
];

check('Camo is a phone camera mic', isVirtualMic('Default - Microphone (Camo)'), true);
check('so are Iriun and iVCam', [isVirtualMic('Microphone (Iriun Webcam)'), isVirtualMic('e2eSoft iVCam')], [true, true]);
check('a headset is not', isVirtualMic('Headset (WH-1000XM4) (Bluetooth)'), false);

check('Camo as default: use the headset instead', pickMicrophone(THIS_PC), '30e1e2841297');
check(
  'a real default mic is left to the system',
  pickMicrophone([mic('default', 'Default - Headset (WH-1000XM4) (Bluetooth)'), mic('30e1e2841297', 'Headset (WH-1000XM4) (Bluetooth)')]),
  undefined
);
check(
  'Camo is the only mic: nothing better to pick',
  pickMicrophone([mic('default', 'Default - Microphone (Camo)'), mic('fa24', 'Microphone (Camo)')]),
  undefined
);
check('labels hidden (no permission yet): leave it to the system', pickMicrophone([mic('default', ''), mic('abc', '')]), undefined);
check('no devices at all', pickMicrophone([]), undefined);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
