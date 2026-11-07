/**
 * Choosing the microphone.
 *
 * Phone-as-webcam apps (Camo, Iriun, iVCam, DroidCam, EpocCam) install a
 * microphone of their own and often take over as the Windows default. It is
 * silent unless the phone is streaming audio, which left J.A.R.V.I.S. deaf.
 * When the default is one of those, a real microphone is used instead.
 */

export interface InputDevice {
  deviceId: string;
  label: string;
  kind?: string;
}

const PHONE_CAMERA_MIC = /\b(camo|iriun|ivcam|e2esoft|droidcam|epoccam)\b/i;

export const isVirtualMic = (label: string) => PHONE_CAMERA_MIC.test(label);

/** The deviceId to open, or undefined to let the system use its default. */
export function pickMicrophone(devices: InputDevice[]): string | undefined {
  const inputs = devices.filter((d) => (d.kind ?? 'audioinput') === 'audioinput');
  const systemDefault = inputs.find((d) => d.deviceId === 'default');
  // Without labels (no microphone permission yet) there is nothing to judge by.
  if (!systemDefault?.label || !isVirtualMic(systemDefault.label)) return undefined;
  const real = inputs.find(
    (d) => d.deviceId !== 'default' && d.deviceId !== 'communications' && d.label && !isVirtualMic(d.label)
  );
  return real?.deviceId;
}
