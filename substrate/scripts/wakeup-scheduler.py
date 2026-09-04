"""wakeup-scheduler.py — scheduled wake-ups for a fleet /id agent.

The sibling of the relay receiver. The receiver wakes an agent when a MESSAGE
wants its attention; this wakes it when the CLOCK does. Same primitive: it's
launched once on wake as a persistent `Monitor` and prints one line per due
wake-up; each printed line is an async wake for the agent.

Vendored into Skynet's substrate and distributed to every host running agent substrate
via the Skynet distributor (see feature 02). Stdlib only.

Schedule specs live at `~/.claude/identities/<name>/wakeups/<slug>.json`:

    {"name": "standup-check", "enabled": true,
     "schedule": {"type": "interval", "every": "2h"},        # or:
     #           {"type": "daily",    "at": "09:00"}         # local time
     #           {"type": "weekly",   "day": "mon", "at": "09:00"}
     #           {"type": "one_shot", "at": "2026-08-15T09:00:00-04:00"}   # fires once, spec self-deletes after
     # optional on interval/daily/weekly: "days": ["mon","tue","wed","thu","fri"]  (box-local; weekdays-only)
     # optional on daily/weekly/one_shot: "timezone": "America/New_York"  (IANA name)
     #   pins `at` to that zone year-round (DST-safe); absent = box-local.
     #   Malformed tz name = LOUD one-shot alert + spec DOES NOT FIRE.
     #   Timezone on interval-type = one-shot note (no-op; interval fires by elapsed seconds).
     #   Timezone on one_shot whose `at` already has an offset/Z = one-shot note (no-op).
     # one_shot semantics:
     #   `at` is a full ISO datetime. Accepts `Z`, offset (`±HH:MM`), or naive (+ optional `timezone`).
     #   Fires once when now >= at. If `at` is already in the past when the spec is first
     #   seen, fires immediately (catch-up). After firing, the spec file is AUTO-DELETED
     #   (a `.state/<slug>.fired` sentinel is written first, so a same-poll load-race
     #   can't double-fire). Malformed `at` = LOUD one-shot alert, spec DOES NOT FIRE.
     "instruction": "Check the work Kanban for cards assigned to you and triage."}

⚠️ GOVERNANCE (user-reserved): an agent may SUGGEST a wake-up, but only Ashley
authorizes creating one — she says yes to a suggestion, or asks for it. Agents
never self-schedule. (This file just executes whatever specs exist.)

On a due entry it prints:
    ⏰ [scheduled: <name> @ <UTC-ISO-Z>] <instruction>          (short instructions)
    ⏰ [scheduled: <name> @ <UTC-ISO-Z>] [long instruction, N chars — full text at
       <state_dir>/<name>.wake — Read it]                        (long instructions)

The harness truncates each stdout line at ~450 chars, so an instruction longer
than that would silently lose its tail in the visible notification (2026-09-01
aqua diagnosis after 3 sweeps missed their fleet-attention scans because Part 6
was past the cap). For long instructions, the scheduler writes the FULL text to
`<state_dir>/<name>.wake` first and emits a short file-pointer notification —
same pattern the relay receiver uses for long m.text messages, so agents already
know to Read the referenced file. Short instructions still emit inline.

The UTC stamp is the wall-clock time it actually FIRED — which tells an on-time
fire from a missed-slot catch-up fire, since the latter fires at restart time,
not its slot.

Semantics:
- First time an entry is ever seen (no persisted last-fired) it is ANCHORED to
  now and does NOT fire — so creating a schedule is quiet and predictable, and a
  session restart never re-fires.
- After it has fired once, a MISSED slot (box/session was down at the scheduled
  time) fires ONCE as catch-up on the next run — never a backlog storm.

Usage:  python3 wakeup-scheduler.py <identity_dir>
Env:    WAKEUP_POLL_SEC (default 30) — loop granularity.
"""

import glob
import json
import os
import sys
import time
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

POLL = int(os.environ.get("WAKEUP_POLL_SEC", "30"))
# Harness truncates monitor-event stdout at ~450 chars. Leave headroom for the
# header + short-form margin; instructions above this go to file-pointer form.
LONG_INSTRUCTION_CHARS = int(os.environ.get("WAKEUP_LONG_CHARS", "300"))
_DOW = {"mon": 0, "tue": 1, "wed": 2, "thu": 3, "fri": 4, "sat": 5, "sun": 6}


def _emit_wake(key, utc, instruction, state_dir):
    """Print the wake notification. Short instructions go inline; long ones are
    written to `<state_dir>/<key>.wake` and referenced via a file-pointer emit
    (same pattern the relay receiver uses for long m.text messages, so agents
    already know to Read the referenced file)."""
    if len(instruction) <= LONG_INSTRUCTION_CHARS:
        print("⏰ [scheduled: %s @ %s] %s" % (key, utc, instruction), flush=True)
        return
    wake_path = os.path.join(state_dir, key + ".wake")
    try:
        with open(wake_path, "w") as f:
            f.write(instruction)
    except OSError as e:
        # File-write failed — fall back to inline emit and let the harness truncate.
        # Better a truncated wake than a silent one; agent at least sees the header.
        print("⚠️ [wakeup-scheduler: %s] could not write wake file (%s); "
              "emitting inline (may truncate)" % (key, e), flush=True)
        print("⏰ [scheduled: %s @ %s] %s" % (key, utc, instruction), flush=True)
        return
    print("⏰ [scheduled: %s @ %s] [long instruction, %d chars — full text at %s "
          "— Read it]" % (key, utc, len(instruction), wake_path), flush=True)


def _zone(spec):
    """Resolve an optional IANA timezone from spec.schedule.timezone.
    Returns (ZoneInfo|None, err_msg|None). err_msg set = malformed → caller must NOT fire."""
    tz = spec.get("schedule", {}).get("timezone")
    if not tz:
        return None, None
    try:
        return ZoneInfo(str(tz)), None
    except (ZoneInfoNotFoundError, ValueError) as e:
        return None, "unknown IANA timezone %r (%s)" % (tz, e.__class__.__name__)


def _dur_secs(s):
    s = str(s).strip().lower()
    unit = s[-1]
    mult = {"s": 1, "m": 60, "h": 3600, "d": 86400}.get(unit)
    if mult is None:
        return int(s) * 60          # bare number = minutes
    return int(s[:-1]) * mult


def _slot_at(ref, hhmm):
    h, m = (int(x) for x in hhmm.split(":"))
    return ref.replace(hour=h, minute=m, second=0, microsecond=0)


def _parse_at_ts(at_str, zi):
    """Parse a one_shot `at` string into an epoch. Returns (ts, has_offset, err_msg).
    `at_str` may be Z-suffixed, offset-bearing, or naive (naive → localize to `zi` if
    given, else box-local). `has_offset` = True if the string carried Z/offset itself
    (in which case a supplied `timezone` is redundant and the caller should note it)."""
    if not isinstance(at_str, str) or not at_str:
        return None, False, "one_shot: `at` is empty or not a string"
    s = at_str.strip()
    # datetime.fromisoformat accepts `Z` only on 3.11+; normalise for older too.
    has_offset = s.endswith("Z") or (len(s) >= 6 and s[-6] in "+-" and s[-3] == ":")
    norm = s[:-1] + "+00:00" if s.endswith("Z") else s
    try:
        dt = datetime.fromisoformat(norm)
    except ValueError as e:
        return None, has_offset, "one_shot: cannot parse `at` %r (%s)" % (at_str, e)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=zi) if zi else dt.astimezone()   # naive → tz or box-local
    return dt.timestamp(), has_offset, None


def _due(spec, last_fired, now_ts, zi=None):
    """Return True if this entry should fire now. last_fired is an epoch or None;
    caller guarantees last_fired is not None here (first-sight is anchored earlier).
    zi = optional ZoneInfo; when set, wall-clock reasoning (`at`, `days`, weekday) uses
    that zone instead of box-local. Interval-type ignores zi (fires by elapsed seconds)."""
    sch = spec.get("schedule", {})
    now = datetime.fromtimestamp(now_ts, tz=zi) if zi else datetime.fromtimestamp(now_ts)
    # Optional day-of-week gate (box-local). e.g. "days": ["mon","tue","wed","thu","fri"]
    # for weekdays-only. Missing = every day. Applies to any schedule type.
    days = sch.get("days")
    if days:
        today3 = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"][now.weekday()]
        if today3 not in [str(d).lower()[:3] for d in days]:
            return False
    t = sch.get("type")
    if t == "interval":
        return now_ts >= last_fired + _dur_secs(sch["every"])
    if t == "daily":
        slot = _slot_at(now, sch["at"]).timestamp()
        return now_ts >= slot and last_fired < slot
    if t == "weekly":
        target = _DOW[str(sch["day"]).lower()[:3]]
        back = (now.weekday() - target) % 7          # days since most-recent target weekday
        slot = (_slot_at(now, sch["at"]) - timedelta(days=back)).timestamp()
        return now_ts >= slot and last_fired < slot
    return False


def _load_specs(wdir):
    out = []
    for p in sorted(glob.glob(os.path.join(wdir, "*.json"))):
        try:
            spec = json.load(open(p))
        except Exception:
            continue
        if not spec.get("enabled", True):
            continue
        spec["_key"] = spec.get("name") or os.path.splitext(os.path.basename(p))[0]
        spec["_path"] = p          # source file path — needed for the one_shot stale-sentinel check
        if spec.get("instruction") and spec.get("schedule"):
            out.append(spec)
    return out


def _single_instance(state_dir, ident_dir):
    """Newest-wins guard: kill any prior scheduler for THIS identity, claim the pidfile."""
    pf = os.path.join(state_dir, "scheduler.pid")
    try:
        old = int(open(pf).read().strip())
        if old != os.getpid():
            try:
                cmd = open("/proc/%d/cmdline" % old).read()
            except Exception:
                cmd = os.popen("ps -p %d -o command= 2>/dev/null" % old).read()
            if "wakeup-scheduler" in cmd and ident_dir in cmd:
                os.kill(old, 15)
    except Exception:
        pass
    open(pf, "w").write(str(os.getpid()))


def main():
    if len(sys.argv) < 2:
        print("usage: python3 wakeup-scheduler.py <identity_dir>", file=sys.stderr)
        sys.exit(2)
    ident_dir = os.path.abspath(os.path.expanduser(sys.argv[1]))
    wdir = os.path.join(ident_dir, "wakeups")
    state_dir = os.path.join(wdir, ".state")
    os.makedirs(state_dir, exist_ok=True)
    _single_instance(state_dir, ident_dir)

    def last_path(key):
        return os.path.join(state_dir, key + ".last")

    def get_last(key):
        try:
            return float(open(last_path(key)).read().strip())
        except Exception:
            return None

    def set_last(key, ts):
        open(last_path(key), "w").write(str(ts))

    warned = set()          # (key, kind) — one-shot LOUD alert per issue per session
    while True:
        now_ts = time.time()
        for spec in _load_specs(wdir):
            key = spec["_key"]
            zi, tz_err = _zone(spec)
            if tz_err:
                # Malformed IANA name: DO NOT FIRE. LOUD one-shot wake so Ashley notices.
                if (key, "tz_bad") not in warned:
                    print("⚠️ [wakeup-scheduler: %s] %s — spec DOES NOT FIRE until fixed"
                          % (key, tz_err), flush=True)
                    warned.add((key, "tz_bad"))
                continue
            sch_type = spec.get("schedule", {}).get("type")
            if zi and sch_type == "interval":
                # timezone on interval is a no-op (interval fires by elapsed seconds); note once.
                if (key, "tz_on_interval") not in warned:
                    print("⚠️ [wakeup-scheduler: %s] `timezone` has no effect on interval-type "
                          "schedules (they fire by elapsed seconds); firing normally"
                          % key, flush=True)
                    warned.add((key, "tz_on_interval"))
                zi = None
            if sch_type == "one_shot":
                # One-shot doesn't use the .last dance; a .fired sentinel governs it.
                # Sentinel exists = already fired; skip. (Also written BEFORE unlink so a
                # same-poll load-race in a paranoid future world can't double-fire.)
                fired_path = os.path.join(state_dir, key + ".fired")
                if os.path.exists(fired_path):
                    # Guard against a STALE sentinel from a prior same-name one_shot.
                    # The sentinel is keyed by `name`, so if a caller writes a fresh
                    # spec whose `name` happens to match a prior day's, the old sentinel
                    # would silently skip it forever. Compare mtimes: if the current
                    # spec on disk is newer than the sentinel, the sentinel is stale
                    # from a prior spec — clear it and fall through. (See wakeup-
                    # scheduler-stale-sentinel-collision bounty; aqua 2026-08-06.)
                    try:
                        spec_mtime = os.path.getmtime(spec["_path"])
                        sentinel_mtime = os.path.getmtime(fired_path)
                    except OSError:
                        continue
                    if spec_mtime > sentinel_mtime:
                        if (key, "stale_sentinel_cleared") not in warned:
                            print("⚠️ [wakeup-scheduler: %s] cleared stale .fired sentinel "
                                  "(spec on disk is newer — prior same-name spec collision)"
                                  % key, flush=True)
                            warned.add((key, "stale_sentinel_cleared"))
                        try:
                            os.unlink(fired_path)
                        except OSError:
                            pass
                        # fall through to normal one_shot processing below
                    else:
                        continue
                at_ts, has_offset, at_err = _parse_at_ts(spec["schedule"].get("at"), zi)
                if at_err:
                    if (key, "at_bad") not in warned:
                        print("⚠️ [wakeup-scheduler: %s] %s — spec DOES NOT FIRE until fixed"
                              % (key, at_err), flush=True)
                        warned.add((key, "at_bad"))
                    continue
                if zi and has_offset and (key, "tz_on_offset") not in warned:
                    print("⚠️ [wakeup-scheduler: %s] `timezone` has no effect when `at` "
                          "already carries an offset/Z; firing at the offset time"
                          % key, flush=True)
                    warned.add((key, "tz_on_offset"))
                if now_ts >= at_ts:
                    utc = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
                    _emit_wake(key, utc, spec["instruction"], state_dir)
                    open(fired_path, "w").write(str(now_ts))     # sentinel first
                    try:
                        os.unlink(os.path.join(wdir, key + ".json"))
                    except FileNotFoundError:
                        # Spec may have been named differently on disk; find + remove any
                        # matching-by-name spec so it can't be seen again.
                        for p in glob.glob(os.path.join(wdir, "*.json")):
                            try:
                                s = json.load(open(p))
                            except Exception:
                                continue
                            if (s.get("name") or os.path.splitext(os.path.basename(p))[0]) == key:
                                try:
                                    os.unlink(p)
                                except OSError:
                                    pass
                                break
                    except OSError as e:
                        # Delete failed (permissions?). Sentinel still prevents re-fire.
                        print("⚠️ [wakeup-scheduler: %s] fired, but spec auto-delete failed: %s "
                              "— .state/%s.fired sentinel prevents re-fire" % (key, e, key), flush=True)
                continue
            last = get_last(key)
            if last is None:                      # first sight -> anchor, don't fire
                set_last(key, now_ts)
                continue
            if _due(spec, last, now_ts, zi):
                utc = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
                _emit_wake(key, utc, spec["instruction"], state_dir)
                set_last(key, now_ts)
        time.sleep(POLL)


if __name__ == "__main__":
    main()
