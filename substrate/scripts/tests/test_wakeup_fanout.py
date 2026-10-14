"""Tests for the wake-up scheduler's fan-out spread (per-identity mode).

A due slot fires at slot + offset, offset in [0, min(per-agent × N, cap)) where
N = running identities on the box with a wake-up slot in the same minute. One
agent → no offset. The offset is a hash of (identity, spec, slot), so a restart
fires at the same moment.

Run: python3 -m unittest substrate/scripts/tests/test_wakeup_fanout.py
"""

import importlib.util
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPT = os.path.join(HERE, "..", "wakeup-scheduler.py")
_spec = importlib.util.spec_from_file_location("wakeup_scheduler", SCRIPT)
eng = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(eng)


class Fleet:
    """A scratch ~/fleet/identities tree."""

    def __init__(self):
        self.root = tempfile.mkdtemp()
        self.ids = os.path.join(self.root, "fleet", "identities")
        os.makedirs(self.ids)

    def identity(self, name, dormant=False):
        d = os.path.join(self.ids, name)
        os.makedirs(os.path.join(d, "wakeups", ".state"), exist_ok=True)
        open(os.path.join(d, name + ".md"), "w").write("---\nroles: [r]\n---\n")
        if dormant:
            open(os.path.join(d, ".dormant"), "w").close()
        return d

    def interval_spec(self, ident_dir, key, last):
        """An every-10m interval spec whose next slot is last + 600."""
        w = os.path.join(ident_dir, "wakeups")
        json.dump({"name": key, "enabled": True, "instruction": "do " + key,
                   "schedule": {"type": "interval", "every": "10m"}},
                  open(os.path.join(w, key + ".json"), "w"))
        open(os.path.join(w, ".state", key + ".last"), "w").write(str(last))

    def cleanup(self):
        shutil.rmtree(self.root, ignore_errors=True)


class FanoutUnit(unittest.TestCase):
    def setUp(self):
        self.f = Fleet()

    def tearDown(self):
        self.f.cleanup()

    def test_offset_zero_for_one_agent(self):
        self.assertEqual(eng.fanout_offset("a", "k", 1_000_000, 1), 0.0)

    def test_offset_deterministic_and_bounded(self):
        offs = [eng.fanout_offset("id%d" % i, "k", 1_000_020, 4) for i in range(200)]
        self.assertEqual(offs[0], eng.fanout_offset("id0", "k", 1_000_020, 4))
        span = min(4 * eng.FANOUT_SEC_PER_AGENT, eng.FANOUT_CAP_SEC)
        self.assertTrue(all(0 <= o < span for o in offs))
        self.assertGreater(len(set(offs)), 150)       # actually spreads
        self.assertGreater(max(offs) - min(offs), span / 2)

    def test_offset_capped(self):
        offs = [eng.fanout_offset("id%d" % i, "k", 5, 1000) for i in range(200)]
        self.assertTrue(all(o < eng.FANOUT_CAP_SEC for o in offs))

    def test_same_minute_counts_running_peers_only(self):
        last = 1_800_000_000 - 600            # slot = 1_800_000_000 (minute-aligned)
        me = self.f.identity("me")
        self.f.interval_spec(me, "a", last)
        self.f.interval_spec(self.f.identity("p1"), "b", last + 10)    # same minute
        self.f.interval_spec(self.f.identity("p2"), "c", last + 120)   # other minute
        self.f.interval_spec(self.f.identity("p3", dormant=True), "d", last)
        p4 = self.f.identity("p4")                                      # two specs, counts once
        self.f.interval_spec(p4, "e", last)
        self.f.interval_spec(p4, "f", last + 5)
        os.makedirs(os.path.join(self.f.ids, "not-an-identity"))
        self.assertEqual(eng.same_minute_agents(1_800_000_000, me, None), 3)

    def test_current_slot_one_shot_and_fired(self):
        d = self.f.identity("me")
        sdir = os.path.join(d, "wakeups", ".state")
        spec = {"_key": "o", "schedule": {"type": "one_shot", "at": "2030-01-01T00:00:00Z"}}
        self.assertEqual(eng.current_slot(spec, sdir, None), 1893456000)
        open(os.path.join(sdir, "o.fired"), "w").close()
        self.assertIsNone(eng.current_slot(spec, sdir, None))

    def test_current_slot_unanchored_is_none(self):
        d = self.f.identity("me")
        spec = {"_key": "x", "schedule": {"type": "interval", "every": "10m"}}
        self.assertIsNone(eng.current_slot(spec, os.path.join(d, "wakeups", ".state"), None))


class FanoutProcess(unittest.TestCase):
    """Drive the real scheduler process for a few polls."""

    def setUp(self):
        self.f = Fleet()

    def tearDown(self):
        self.f.cleanup()

    def run_scheduler(self, ident_dir, per_agent, cap, seconds=4):
        env = dict(os.environ, HOME=self.f.root, WAKEUP_POLL_SEC="1",
                   AMBIENT_MONITOR_HARNESS_PID=str(os.getpid()),
                   WAKEUP_FANOUT_SEC_PER_AGENT=str(per_agent),
                   WAKEUP_FANOUT_CAP_SEC=str(cap))
        p = subprocess.run(["timeout", str(seconds), sys.executable, SCRIPT, ident_dir],
                           env=env, capture_output=True, text=True)
        return p.stdout, p.stderr

    def test_crowded_minute_is_held(self):
        last = time.time() - 600 - 1          # due now
        me = self.f.identity("me")
        self.f.interval_spec(me, "a", last)
        self.f.interval_spec(self.f.identity("peer"), "b", last)
        slot = eng.next_fire({"type": "interval", "every": "10m"}, last)
        # offset = span × hash fraction; pick a span that puts this slot's
        # offset at >= 60s, well past the run window.
        frac = eng.fanout_offset("me", "a", slot, 2) / min(2 * eng.FANOUT_SEC_PER_AGENT, eng.FANOUT_CAP_SEC)
        out, err = self.run_scheduler(me, 1e6, 60.0 / max(frac, 1e-6))
        self.assertNotIn("⏰", out, err)
        self.assertIn("2 agents share this minute, holding", err)

    def test_held_slot_fires_after_offset(self):
        last = time.time() - 600 - 1
        me = self.f.identity("me")
        self.f.interval_spec(me, "a", last)
        self.f.interval_spec(self.f.identity("peer"), "b", last)
        out, err = self.run_scheduler(me, 1, 2, seconds=5)   # span 2s
        self.assertEqual(out.count("⏰ [scheduled: a @"), 1, err)

    def test_lone_agent_fires_immediately(self):
        last = time.time() - 600 - 1
        me = self.f.identity("me")
        self.f.interval_spec(me, "a", last)
        self.f.interval_spec(self.f.identity("sleeper", dormant=True), "b", last)
        out, err = self.run_scheduler(me, 1e6, 1e6, seconds=3)
        self.assertEqual(out.count("⏰ [scheduled: a @"), 1, err)
        self.assertNotIn("holding", err)


if __name__ == "__main__":
    unittest.main()
