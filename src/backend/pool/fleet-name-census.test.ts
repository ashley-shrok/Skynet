import { describe, it, expect } from "vitest";
import {
  FleetNameCensus,
  REFRESH_INTERVAL_MS,
  RETRY_AFTER_FAILURE_MS,
  RECENT_BIRTH_TTL_MS,
  RESERVATION_TTL_MS,
  FORGET_AFTER_MS,
  censusMachineKey,
  parseCensusOutput,
  mergeCensusIntoRankInput,
} from "./fleet-name-census.js";

function clock(start = 1_000_000) {
  let t = start;
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
  };
}

describe("FleetNameCensus", () => {
  it("is not ready and empty before any machine picture lands", () => {
    const c = new FleetNameCensus();
    const s = c.snapshot(1);
    expect(s.ready).toBe(false);
    expect(s.liveElsewhere.size).toBe(0);
    expect(s.liveOnTarget.size).toBe(0);
  });

  it("splits live names into target vs elsewhere by machine, reduced to bases", () => {
    const c = new FleetNameCensus();
    c.noteHost("1", "m-a");
    c.noteHost("2", "m-b");
    c.recordMachine("m-a", ["ada-box-maintainer"], []);
    c.recordMachine("m-b", ["byron-coordinator-2"], []);
    const s = c.snapshot(1);
    expect(s.ready).toBe(true);
    expect([...s.liveOnTarget]).toEqual(["ada"]);
    expect([...s.liveElsewhere]).toEqual(["byron"]);
  });

  it("counts a machine registered under several host rows once — as the target", () => {
    const c = new FleetNameCensus();
    c.noteHost("1", "m-shared");
    c.noteHost("5", "m-shared");
    c.recordMachine("m-shared", ["ada-x"], []);
    expect(c.snapshot(5).liveOnTarget.has("ada")).toBe(true);
    expect(c.snapshot(5).liveElsewhere.has("ada")).toBe(false);
  });

  it("keeps the newest archive time for a name across machines", () => {
    const c = new FleetNameCensus();
    c.recordMachine("m-a", [], [{ name: "ada-x", mtimeMs: 100 }]);
    c.recordMachine("m-b", [], [
      { name: "ada-y", mtimeMs: 900 },
      { name: "ada-z", mtimeMs: 300 },
    ]);
    expect(c.snapshot(1).lastArchivedMs.get("ada")).toBe(900);
  });

  it("refresh is due immediately, then every interval; sooner retry after failure", () => {
    const k = clock();
    const c = new FleetNameCensus(k.now);
    expect(c.claimRefresh("m")).toBe(true);
    expect(c.claimRefresh("m")).toBe(false); // second row, same tick
    c.recordMachine("m", [], []);
    k.advance(REFRESH_INTERVAL_MS - 1);
    expect(c.claimRefresh("m")).toBe(false);
    k.advance(1);
    expect(c.claimRefresh("m")).toBe(true);
    c.recordRefreshFailure("m");
    k.advance(RETRY_AFTER_FAILURE_MS);
    expect(c.claimRefresh("m")).toBe(true);
  });

  it("a failed refresh keeps the last known picture", () => {
    const c = new FleetNameCensus();
    c.recordMachine("m", ["ada-x"], []);
    c.recordRefreshFailure("m");
    expect(c.snapshot(99).liveElsewhere.has("ada")).toBe(true);
  });

  it("records births immediately; they count until a refresh started after the birth lands", () => {
    const k = clock();
    const c = new FleetNameCensus(k.now);
    c.noteHost("1", "m-a");
    expect(c.claimRefresh("m-a")).toBe(true); // read starts BEFORE the birth
    k.advance(1);
    c.recordBirth(1, "cora-box-maintainer");
    expect(c.snapshot(1).liveOnTarget.has("cora")).toBe(true);
    expect(c.snapshot(2).liveElsewhere.has("cora")).toBe(true);
    c.recordMachine("m-a", [], []); // that early read missed the folder
    k.advance(RECENT_BIRTH_TTL_MS * 10); // machine unreachable for ages
    expect(c.snapshot(2).liveElsewhere.has("cora")).toBe(true);
    k.advance(REFRESH_INTERVAL_MS);
    expect(c.claimRefresh("m-a")).toBe(true); // read starts AFTER the birth
    c.recordMachine("m-a", ["cora-box-maintainer"], []);
    c.noteHost("1", "m-a"); // still in the host list (scanner notes it every tick)
    c.prune();
    expect(c.snapshot(2).liveElsewhere.has("cora")).toBe(true); // via picture
    k.advance(REFRESH_INTERVAL_MS);
    expect(c.claimRefresh("m-a")).toBe(true);
    c.recordMachine("m-a", ["dora-x"], []); // cora since archived
    expect(c.snapshot(2).liveElsewhere.has("cora")).toBe(false);
  });

  it("a birth on an unmapped row counts on-target for that row and expires after the TTL", () => {
    const k = clock();
    const c = new FleetNameCensus(k.now);
    c.recordBirth(9, "cora-x");
    expect(c.snapshot(9).liveOnTarget.has("cora")).toBe(true);
    k.advance(RECENT_BIRTH_TTL_MS + 1);
    expect(c.snapshot(9).liveOnTarget.has("cora")).toBe(false);
  });

  it("reservations hold a name briefly, then expire", () => {
    const k = clock();
    const c = new FleetNameCensus(k.now);
    c.noteHost("1", "m-a");
    c.reserve(1, "oak");
    expect(c.snapshot(2).liveElsewhere.has("oak")).toBe(true);
    k.advance(RESERVATION_TTL_MS + 1);
    expect(c.snapshot(2).liveElsewhere.has("oak")).toBe(false);
  });

  it("a read showing no live agents over a non-empty picture is held until a second read agrees", () => {
    const c = new FleetNameCensus();
    c.recordMachine("m", ["ada-x", "byron-y"], []);
    expect(c.recordMachine("m", [], [])).toBe(false);
    expect(c.snapshot(99).liveElsewhere.has("ada")).toBe(true);
    expect(c.recordMachine("m", [], [])).toBe(true);
    expect(c.snapshot(99).liveElsewhere.has("ada")).toBe(false);
  });

  it("a non-empty read in between resets the empty-read hold", () => {
    const c = new FleetNameCensus();
    c.recordMachine("m", ["ada-x"], []);
    expect(c.recordMachine("m", [], [])).toBe(false);
    expect(c.recordMachine("m", ["ada-x"], [])).toBe(true);
    expect(c.recordMachine("m", [], [])).toBe(false);
  });

  it("forgets a machine only after it's been absent from the host list a long time", () => {
    const k = clock();
    const c = new FleetNameCensus(k.now);
    c.noteHost("1", "m-gone");
    c.noteHost("2", "m-kept");
    c.recordMachine("m-gone", ["ada-x"], []);
    c.recordMachine("m-kept", ["byron-x"], []);
    k.advance(FORGET_AFTER_MS - 1);
    c.noteHost("2", "m-kept"); // still listed (maybe unreachable — no refresh)
    c.prune();
    expect(c.snapshot(99).liveElsewhere.has("ada")).toBe(true);
    k.advance(2);
    c.noteHost("2", "m-kept");
    c.prune();
    const s = c.snapshot(99);
    expect(s.liveElsewhere.has("ada")).toBe(false);
    expect(s.liveElsewhere.has("byron")).toBe(true);
  });
});

describe("parseCensusOutput", () => {
  const valid = (n: string) => /^[a-z0-9_-]{1,64}$/.test(n);

  it("returns null when the END marker is missing (truncated read)", () => {
    expect(parseCensusOutput("L\tada-x\n", valid)).toBeNull();
  });

  it("parses live and archived lines, skipping malformed ones", () => {
    const out = parseCensusOutput(
      [
        "L\tada-box-maintainer",
        "L\tBAD NAME",
        "A\tbyron-x\t1700000000.5",
        "A\tcora-x\tnotanumber",
        "A\tdora-x",
        "garbage",
        "END",
      ].join("\n"),
      valid,
    );
    expect(out).toEqual({
      live: ["ada-box-maintainer"],
      archived: [{ name: "byron-x", mtimeMs: 1700000000500 }],
    });
  });

  it("returns null when a listing reported an error", () => {
    expect(parseCensusOutput("L\tada-x\nERR\nEND\n", valid)).toBeNull();
  });

  it("an empty fleet dir is a valid empty picture", () => {
    expect(parseCensusOutput("END\n", valid)).toEqual({ live: [], archived: [] });
  });
});

describe("mergeCensusIntoRankInput", () => {
  it("unions target live names, takes newest archive time, passes live-elsewhere", () => {
    const merged = mergeCensusIntoRankInput(
      {
        activeNames: new Set(["ada"]),
        archivedEntries: [
          { name: "byron", mtimeMs: 50 },
          { name: "cora", mtimeMs: 10 },
        ],
      },
      {
        ready: true,
        liveOnTarget: new Set(["dora"]),
        liveElsewhere: new Set(["eve"]),
        lastArchivedMs: new Map([
          ["byron", 20],
          ["cora", 99],
        ]),
      },
    );
    expect([...merged.activeNames].sort()).toEqual(["ada", "dora"]);
    expect(
      Object.fromEntries(merged.archivedEntries.map((e) => [e.name, e.mtimeMs])),
    ).toEqual({ byron: 50, cora: 99 });
    expect([...merged.liveElsewhere]).toEqual(["eve"]);
  });
});

describe("censusMachineKey", () => {
  it("separates different SSH logins on the same box", () => {
    expect(censusMachineKey("12", "ubuntu")).toBe("12|ubuntu");
    expect(censusMachineKey("12", "root")).not.toBe(censusMachineKey("12", "ubuntu"));
    expect(censusMachineKey("12", undefined)).toBe("12");
  });
});
