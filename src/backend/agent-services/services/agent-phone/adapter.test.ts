import { describe, it, expect, vi } from "vitest";

vi.mock("../../../utils/logger.js", () => {
  const stub = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    success: vi.fn(),
  };
  return { systemLogger: stub, databaseLogger: stub };
});

import {
  CALL_DEADLINE_MS,
  placeCallAndAwait,
  type AdapterDeps,
} from "./adapter.js";

const creds = {
  accountSid: "AC123",
  authToken: "secret-token",
  fromNumber: "+17165550000",
};
const call = {
  to: "+15555550100",
  openingLine: "Hi, this is Clipper. CI failed.",
  receiptLine: "Your reply has been sent back to Clipper. You may hang up.",
};

const ACCOUNT = "https://api.twilio.com/2010-04-01/Accounts/AC123";

interface FakeTwilio {
  /** Response body for POST /Calls.json, or an HTTP error. */
  place?: { status: number; body: unknown };
  /** Successive GET /Calls/:sid bodies; the last one repeats. */
  statuses?: Array<Record<string, unknown>>;
  /** Successive GET /Calls/:sid/Recordings bodies; the last one repeats. */
  recordings?: Array<Array<Record<string, unknown>>>;
  /** GET /Recordings/:sid.mp3 status. */
  mediaStatus?: number;
}

function fakeTwilio(f: FakeTwilio) {
  let statusIdx = 0;
  let recIdx = 0;
  const calls: Array<{ method: string; url: string; body?: string; auth?: string }> = [];
  const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    const method = init?.method ?? "GET";
    const headers = (init?.headers ?? {}) as Record<string, string>;
    calls.push({
      method,
      url: u,
      body: typeof init?.body === "string" ? init.body : undefined,
      auth: headers.Authorization,
    });
    const json = (status: number, body: unknown) =>
      new Response(JSON.stringify(body), { status });
    if (method === "POST" && u === `${ACCOUNT}/Calls.json`) {
      const p = f.place ?? { status: 201, body: { sid: "CA1", status: "queued" } };
      return json(p.status, p.body);
    }
    if (method === "GET" && u === `${ACCOUNT}/Calls/CA1.json`) {
      const list = f.statuses ?? [{ status: "completed", duration: "30" }];
      const body = list[Math.min(statusIdx++, list.length - 1)];
      return json(200, body);
    }
    if (method === "POST" && u === `${ACCOUNT}/Calls/CA1.json`) {
      return json(200, { sid: "CA1" });
    }
    if (method === "GET" && u === `${ACCOUNT}/Calls/CA1/Recordings.json`) {
      const list = f.recordings ?? [
        [{ sid: "RE1", status: "completed", source: "StartCallRecordingTwiML" }],
      ];
      return json(200, { recordings: list[Math.min(recIdx++, list.length - 1)] });
    }
    if (method === "GET" && u === `${ACCOUNT}/Recordings/RE1.mp3`) {
      return new Response("MP3", { status: f.mediaStatus ?? 200 });
    }
    if (method === "DELETE" && u === `${ACCOUNT}/Recordings/RE1.json`) {
      return new Response(null, { status: 204 });
    }
    return json(404, { message: `unexpected ${method} ${u}` });
  });
  return { fetchFn: fetchFn as unknown as typeof fetch, calls };
}

function deps(
  fetchFn: typeof fetch,
  transcribe: AdapterDeps["transcribe"] = vi.fn(async () => "On it."),
): AdapterDeps & { clock: { t: number } } {
  const clock = { t: 0 };
  return {
    clock,
    now: () => clock.t,
    sleep: async (ms) => {
      clock.t += ms;
    },
    fetchFn,
    transcribe,
  };
}

describe("placeCallAndAwait (Twilio)", () => {
  it("places the call from the instance number with inline TwiML and machine detection", async () => {
    const t = fakeTwilio({});
    await placeCallAndAwait(call, creds, deps(t.fetchFn));
    const place = t.calls[0];
    expect(place.method).toBe("POST");
    expect(place.auth).toBe(
      `Basic ${Buffer.from("AC123:secret-token").toString("base64")}`,
    );
    const form = new URLSearchParams(place.body);
    expect(form.get("To")).toBe("+15555550100");
    expect(form.get("From")).toBe("+17165550000");
    expect(form.get("MachineDetection")).toBe("Enable");
    expect(form.get("AsyncAmd")).toBe("true");
    expect(form.get("Twiml")).toContain("Hi, this is Clipper. CI failed.");
    expect(form.get("Twiml")).toContain("<Start><Recording ");
  });

  it("returns the reply transcript, then deletes the recording", async () => {
    const t = fakeTwilio({
      statuses: [
        { status: "ringing" },
        { status: "in-progress", answered_by: "human" },
        { status: "completed", duration: "31", answered_by: "human" },
      ],
    });
    const transcribe = vi.fn(async () => " Okay, going to bed. ");
    const result = await placeCallAndAwait(call, creds, deps(t.fetchFn, transcribe));
    expect(result).toEqual({
      outcome: "completed",
      call_length_seconds: 31,
      transcript: [
        "voice: Hi, this is Clipper. CI failed.",
        "user: Okay, going to bed.",
        "voice: Your reply has been sent back to Clipper. You may hang up.",
      ].join("\n"),
    });
    expect(vi.mocked(transcribe).mock.calls[0][0].toString()).toBe("MP3");
    expect(t.calls.some((c) => c.method === "DELETE")).toBe(true);
  });

  it("waits for the recording to finish processing", async () => {
    const t = fakeTwilio({
      recordings: [
        [],
        [{ sid: "RE1", status: "processing", source: "StartCallRecordingTwiML" }],
        [{ sid: "RE1", status: "completed", source: "StartCallRecordingTwiML" }],
      ],
    });
    const result = await placeCallAndAwait(call, creds, deps(t.fetchFn));
    expect(result.outcome).toBe("completed");
  });

  it("is no_response when the callee said nothing", async () => {
    const t = fakeTwilio({});
    const result = await placeCallAndAwait(
      call,
      creds,
      deps(t.fetchFn, vi.fn(async () => "  ")),
    );
    expect(result).toEqual({
      outcome: "no_response",
      call_length_seconds: 30,
      transcript: "voice: Hi, this is Clipper. CI failed.",
    });
  });

  it("is no_response when no recording ever appears (hung up during the message)", async () => {
    const t = fakeTwilio({ recordings: [[]] });
    const transcribe = vi.fn(async () => "x");
    const result = await placeCallAndAwait(call, creds, deps(t.fetchFn, transcribe));
    expect(result.outcome).toBe("no_response");
    expect(transcribe).not.toHaveBeenCalled();
  });

  it("is no_answer when voicemail picked up, deleting the recording", async () => {
    const t = fakeTwilio({
      statuses: [{ status: "completed", duration: "20", answered_by: "machine_start" }],
    });
    const result = await placeCallAndAwait(
      call,
      creds,
      deps(t.fetchFn, vi.fn(async () => "")),
    );
    expect(result).toEqual({
      outcome: "no_answer",
      call_length_seconds: 20,
      message:
        "voicemail picked up (answered_by: machine_start); the message was likely left on voicemail",
    });
    expect(t.calls.some((c) => c.method === "DELETE")).toBe(true);
  });

  it("keeps a recorded reply on no_answer in case voicemail detection misfired", async () => {
    const t = fakeTwilio({
      statuses: [{ status: "completed", duration: "25", answered_by: "machine_start" }],
    });
    const result = await placeCallAndAwait(
      call,
      creds,
      deps(t.fetchFn, vi.fn(async () => "Yes, I'm up.")),
    );
    expect(result.outcome).toBe("no_answer");
    expect(result.transcript).toBe(
      "voice: Hi, this is Clipper. CI failed.\nuser: Yes, I'm up.",
    );
  });

  it("reports completed without the provider error when transcription fails, and still deletes the recording", async () => {
    const t = fakeTwilio({});
    const result = await placeCallAndAwait(
      call,
      creds,
      deps(t.fetchFn, vi.fn(async () => Promise.reject(new Error("stt down: {body}")))),
    );
    expect(result.outcome).toBe("completed");
    expect(result.transcript).toContain(
      "user: [the reply was recorded but could not be transcribed]",
    );
    expect(result.transcript).not.toContain("stt down");
    expect(t.calls.some((c) => c.method === "DELETE")).toBe(true);
  });

  it.each([
    ["busy", "busy"],
    ["no-answer", "no_answer"],
    ["canceled", "canceled"],
    ["failed", "queue_error"],
  ])("maps Twilio status %s to %s", async (status, outcome) => {
    const t = fakeTwilio({ statuses: [{ status, duration: "0" }] });
    const result = await placeCallAndAwait(call, creds, deps(t.fetchFn));
    expect(result.outcome).toBe(outcome);
    expect(t.calls.some((c) => c.url.endsWith("/Recordings.json"))).toBe(false);
  });

  it("reports placement_error with Twilio's message and code", async () => {
    const t = fakeTwilio({
      place: {
        status: 400,
        body: { code: 21211, message: "The 'To' number is not a valid phone number." },
      },
    });
    const result = await placeCallAndAwait(call, creds, deps(t.fetchFn));
    expect(result).toEqual({
      outcome: "placement_error",
      message: "The 'To' number is not a valid phone number. (Twilio 21211)",
    });
    expect(t.calls).toHaveLength(1);
  });

  it("reports placement_error when the request throws", async () => {
    const fetchFn = vi.fn(async () => {
      throw new Error("ECONNRESET");
    }) as unknown as typeof fetch;
    const result = await placeCallAndAwait(call, creds, deps(fetchFn));
    expect(result).toEqual({ outcome: "placement_error", message: "ECONNRESET" });
  });

  it("keeps polling through poll errors", async () => {
    const t = fakeTwilio({});
    let n = 0;
    const flaky = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).endsWith("/Calls/CA1.json") && (init?.method ?? "GET") === "GET" && n++ < 2) {
        throw new Error("blip");
      }
      return t.fetchFn(url, init);
    }) as unknown as typeof fetch;
    const result = await placeCallAndAwait(call, creds, deps(flaky));
    expect(result.outcome).toBe("completed");
  });

  it("hangs up and reports timeout when the call never finishes", async () => {
    const t = fakeTwilio({ statuses: [{ status: "ringing" }] });
    const d = deps(t.fetchFn);
    const result = await placeCallAndAwait(call, creds, d);
    expect(result.outcome).toBe("timeout");
    expect(d.clock.t).toBeGreaterThanOrEqual(CALL_DEADLINE_MS);
    const hangup = t.calls.find(
      (c) => c.method === "POST" && c.url.endsWith("/Calls/CA1.json"),
    );
    // completed ends a call in any state; canceled would miss an answered one.
    expect(new URLSearchParams(hangup?.body).get("Status")).toBe("completed");
    expect(result.message).toContain("the backend hung it up");
  });

  it("says so when the deadline hang-up is refused", async () => {
    const t = fakeTwilio({ statuses: [{ status: "in-progress" }] });
    const refusing = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (init?.method === "POST" && String(url).endsWith("/Calls/CA1.json")) {
        return new Response("{}", { status: 500 });
      }
      return t.fetchFn(url, init);
    }) as unknown as typeof fetch;
    const result = await placeCallAndAwait(call, creds, deps(refusing));
    expect(result.outcome).toBe("timeout");
    expect(result.message).toContain("could not confirm it hung up");
  });
});
