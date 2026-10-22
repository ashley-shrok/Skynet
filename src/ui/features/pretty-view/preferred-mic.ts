/**
 * preferred-mic — keep Skynet's mics on the headset, not the phone's own mic.
 *
 * iOS sometimes answers getUserMedia with the iPhone's built-in microphone
 * even while AirPods are connected (seen 2026-10-22, voice mode and the
 * dictation mic alike). Input and output are paired on iOS, so recording from
 * the built-in mic also moves all of the page's sound — a reply being read
 * aloud included — to the phone speaker.
 *
 * Once a mic is open, labels are readable: learnHeadsetMic() spots the
 * built-in mic, finds a headset input and remembers it for the page's
 * lifetime. micAudioConstraints() then asks for that device on every later
 * getUserMedia (as `ideal`, so a headset that's gone still yields a mic).
 * Voice mode also swaps its live stream at once; the dictation mic uses the
 * headset from its next recording.
 */

/** An iPhone / iPad's own mic. */
const BUILT_IN_MIC = /^(iphone|ipad) microphone$/i;

let preferredInputId: string | null = null;

/** Is this the phone's own mic? */
export function isBuiltInMic(label: string): boolean {
  return BUILT_IN_MIC.test(label.trim());
}

/**
 * The headset mic to use instead, when `currentLabel` is the phone's built-in
 * one. Null when the current mic isn't built-in or there's no other input.
 */
export function headsetInputId(devices: ReadonlyArray<MediaDeviceInfo>, currentLabel: string): string | null {
  if (!isBuiltInMic(currentLabel)) return null;
  const headset = devices.find(
    (d) =>
      d.kind === "audioinput" &&
      d.deviceId !== "" &&
      d.deviceId !== "default" &&
      d.label !== "" &&
      !isBuiltInMic(d.label),
  );
  return headset?.deviceId ?? null;
}

/** getUserMedia audio constraints: `base` plus the remembered headset, if any. */
export function micAudioConstraints(base: MediaTrackConstraints = {}): MediaTrackConstraints | true {
  if (!preferredInputId) return Object.keys(base).length > 0 ? base : true;
  return { ...base, deviceId: { ideal: preferredInputId } };
}

/**
 * Check a freshly opened stream. If it got the built-in mic and a headset mic
 * exists that hasn't been tried yet, remember the headset and resolve true
 * (the caller may swap streams). Each headset is tried once, so a phone that
 * keeps handing out the built-in mic can't cause a loop.
 */
export async function learnHeadsetMic(stream: MediaStream, log: (msg: string) => void): Promise<boolean> {
  const label = stream.getAudioTracks?.()[0]?.label ?? "";
  if (!isBuiltInMic(label) || typeof navigator === "undefined" || !navigator.mediaDevices?.enumerateDevices) {
    return false;
  }
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const id = headsetInputId(devices, label);
    if (!id || id === preferredInputId) return false;
    preferredInputId = id;
    const to = devices.find((d) => d.deviceId === id)?.label ?? "?";
    log(`mic-prefer-headset from="${label}" to="${to}"`);
    return true;
  } catch (err) {
    log(`enumerate-devices-failed errMessage="${err instanceof Error ? err.message : String(err)}"`);
    return false;
  }
}

/** Test helper. */
export function __resetPreferredMicForTests(): void {
  preferredInputId = null;
}
