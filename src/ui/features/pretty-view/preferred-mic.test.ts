import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  __resetPreferredMicForTests,
  headsetInputId,
  isBuiltInMic,
  learnHeadsetMic,
  micAudioConstraints,
} from "./preferred-mic";

const dev = (deviceId: string, label: string, kind: MediaDeviceKind = "audioinput") =>
  ({ deviceId, label, kind, groupId: "", toJSON: () => ({}) }) as MediaDeviceInfo;

function streamWith(label: string): MediaStream {
  return { getAudioTracks: () => [{ label }] } as unknown as MediaStream;
}

const enumerateDevices = vi.fn();

beforeEach(() => {
  __resetPreferredMicForTests();
  enumerateDevices.mockReset();
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { enumerateDevices } });
});

describe("preferred-mic", () => {
  it("recognises the phone's own mic", () => {
    expect(isBuiltInMic("iPhone Microphone")).toBe(true);
    expect(isBuiltInMic("iPad Microphone")).toBe(true);
    expect(isBuiltInMic("AirPods")).toBe(false);
    expect(isBuiltInMic("Headset (AirPods)")).toBe(false);
    expect(isBuiltInMic("Microphone (Razer BlackShark V2 Pro)")).toBe(false);
  });

  it("finds the headset only when the current mic is the built-in one", () => {
    const devices = [dev("b1", "iPhone Microphone"), dev("h1", "AirPods"), dev("o1", "AirPods", "audiooutput")];
    expect(headsetInputId(devices, "iPhone Microphone")).toBe("h1");
    expect(headsetInputId(devices, "AirPods")).toBeNull();
    expect(headsetInputId([dev("b1", "iPhone Microphone")], "iPhone Microphone")).toBeNull();
  });

  it("asks for the remembered headset (ideal) once one is learned", async () => {
    expect(micAudioConstraints()).toBe(true);
    expect(micAudioConstraints({ echoCancellation: true })).toEqual({ echoCancellation: true });
    enumerateDevices.mockResolvedValue([dev("b1", "iPhone Microphone"), dev("h1", "AirPods")]);
    expect(await learnHeadsetMic(streamWith("iPhone Microphone"), () => {})).toBe(true);
    expect(micAudioConstraints()).toEqual({ deviceId: { ideal: "h1" } });
    expect(micAudioConstraints({ echoCancellation: true })).toEqual({ echoCancellation: true, deviceId: { ideal: "h1" } });
  });

  it("tries each headset once, and leaves a headset stream alone", async () => {
    enumerateDevices.mockResolvedValue([dev("b1", "iPhone Microphone"), dev("h1", "AirPods")]);
    expect(await learnHeadsetMic(streamWith("iPhone Microphone"), () => {})).toBe(true);
    expect(await learnHeadsetMic(streamWith("iPhone Microphone"), () => {})).toBe(false);
    expect(await learnHeadsetMic(streamWith("AirPods"), () => {})).toBe(false);
  });
});
