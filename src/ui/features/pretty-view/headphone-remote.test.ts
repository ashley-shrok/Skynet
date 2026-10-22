import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createHeadphoneRemote, setAudioSessionType, PRESS_DEBOUNCE_MS } from "./headphone-remote";

const handlers = new Map<string, (() => void) | null>();
const mediaSession = {
  metadata: null as unknown,
  playbackState: "none",
  setActionHandler: vi.fn((action: string, h: (() => void) | null) => {
    handlers.set(action, h);
  }),
};

class MockAudio {
  static instances: MockAudio[] = [];
  loop = false;
  paused = true;
  onpause: (() => void) | null = null;
  constructor(public src: string) {
    MockAudio.instances.push(this);
  }
  play = vi.fn(() => {
    this.paused = false;
    return Promise.resolve();
  });
  pause = vi.fn(() => {
    this.paused = true;
  });
  removeAttribute = vi.fn();
}

beforeEach(() => {
  vi.useFakeTimers();
  handlers.clear();
  mediaSession.setActionHandler.mockClear();
  MockAudio.instances = [];
  vi.stubGlobal("Audio", MockAudio);
  vi.stubGlobal("MediaMetadata", class {
    constructor(public init: unknown) {}
  });
  Object.defineProperty(navigator, "mediaSession", { configurable: true, value: mediaSession });
  URL.createObjectURL = vi.fn(() => "blob:loop");
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function make() {
  const onPress = vi.fn();
  const onSkip = vi.fn();
  const remote = createHeadphoneRemote({ onPress, onSkip, log: () => {} })!;
  return { remote, onPress, onSkip };
}

describe("headphone-remote", () => {
  it("plays a looping track so the page is 'now playing'", () => {
    make();
    expect(MockAudio.instances[0].loop).toBe(true);
    expect(MockAudio.instances[0].play).toHaveBeenCalled();
    expect(mediaSession.playbackState).toBe("playing");
  });

  it("play / pause are a press; next track is a skip", () => {
    const { onPress, onSkip } = make();
    handlers.get("pause")!();
    vi.advanceTimersByTime(PRESS_DEBOUNCE_MS);
    handlers.get("play")!();
    vi.advanceTimersByTime(PRESS_DEBOUNCE_MS);
    handlers.get("nexttrack")!();
    expect(onPress).toHaveBeenCalledTimes(2);
    expect(onSkip).toHaveBeenCalledTimes(1);
  });

  it("drops the duplicate the phone sends with every press", () => {
    const { onPress } = make();
    handlers.get("pause")!();
    handlers.get("pause")!();
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it("keeps the loop playing when a press pauses it", () => {
    make();
    const loop = MockAudio.instances[0];
    loop.paused = true;
    loop.play.mockClear();
    handlers.get("pause")!();
    expect(loop.play).toHaveBeenCalled();
  });

  it("reclaim restarts the loop and re-registers the buttons", () => {
    const { remote } = make();
    const loop = MockAudio.instances[0];
    mediaSession.setActionHandler.mockClear();
    remote.reclaim();
    expect(loop.pause).toHaveBeenCalled();
    expect(loop.play).toHaveBeenCalledTimes(2);
    expect(mediaSession.setActionHandler).toHaveBeenCalledWith("play", expect.any(Function));
  });

  it("dispose stops the loop and lets go of the buttons", () => {
    const { remote, onPress } = make();
    remote.dispose();
    expect(MockAudio.instances[0].pause).toHaveBeenCalled();
    expect(handlers.get("play")).toBeNull();
    expect(mediaSession.playbackState).toBe("none");
    expect(onPress).not.toHaveBeenCalled();
  });

  it("returns null without the Media Session API", () => {
    Object.defineProperty(navigator, "mediaSession", { configurable: true, value: undefined });
    expect(createHeadphoneRemote({ onPress: vi.fn(), onSkip: vi.fn(), log: () => {} })).toBeNull();
  });

  it("setAudioSessionType sets the type where the API exists and is a no-op elsewhere", () => {
    const session = { type: "auto" };
    Object.defineProperty(navigator, "audioSession", { configurable: true, value: session });
    setAudioSessionType("playback", () => {});
    expect(session.type).toBe("playback");
    Object.defineProperty(navigator, "audioSession", { configurable: true, value: undefined });
    expect(() => setAudioSessionType("playback", () => {})).not.toThrow();
  });
});
