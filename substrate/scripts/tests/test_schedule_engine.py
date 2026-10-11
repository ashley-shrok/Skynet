"""Tests for the schedule engine in wakeup-scheduler.py.

Four layers:
  1. Validation table — every accepted and rejected shape.
  2. Hand-checked cases — each kind/option, DST gaps and overlaps, leap years,
     month-end clamping, nth weekdays, parity, windows, start/until.
  3. Differential vs an independent brute-force oracle — thousands of seeded
     random schedules across awkward zones (half-hour DST, :45 offsets,
     midnight transitions, southern hemisphere), with `after` instants
     clustered around DST transitions.
  4. Scheduler simulation — drives `decide` through a poll loop with random
     poll spacing and downtime, and checks the firing invariants (one fire per
     slot window, one catch-up after downtime, never early, count/until).

Run: python3 -m unittest substrate/scripts/tests/test_schedule_engine.py
Env: SCHEDULE_FUZZ_CASES (default 1500) scales layer 3.
"""

import calendar
import importlib.util
import os
import random
import unittest
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

HERE = os.path.dirname(os.path.abspath(__file__))
_spec = importlib.util.spec_from_file_location(
    "wakeup_scheduler", os.path.join(HERE, "..", "wakeup-scheduler.py"))
eng = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(eng)

NY = ZoneInfo("America/New_York")
UTC = timezone.utc
DOW = ("mon", "tue", "wed", "thu", "fri", "sat", "sun")
FUZZ_CASES = int(os.environ.get("SCHEDULE_FUZZ_CASES", "1500"))

ZONES = [
    "UTC", "America/New_York", "Europe/London", "Australia/Lord_Howe",
    "Asia/Kolkata", "Pacific/Chatham", "America/St_Johns", "Australia/Sydney",
    "America/Santiago", "Asia/Tokyo", "Europe/Berlin", "Pacific/Auckland",
]


def ny(*a):
    return datetime(*a, tzinfo=NY).timestamp()


def show(ts, zi=NY):
    return None if ts is None else datetime.fromtimestamp(ts, zi).isoformat()


# ---------------------------------------------------------------------------
# 1. Validation
# ---------------------------------------------------------------------------

VALID = [
    {"type": "interval", "every": "30m"},
    {"type": "interval", "every": "45s"},
    {"type": "interval", "every": "2h"},
    {"type": "interval", "every": "1d"},
    {"type": "interval", "every": "11mo"},
    {"type": "interval", "every": "90"},
    {"type": "interval", "every": 15},
    {"type": "interval", "every": "05m"},
    {"type": "interval", "every": "30m", "window": {"from": "09:00", "to": "17:00"}},
    {"type": "interval", "every": "30m", "window": {"from": "22:00", "to": "06:00"}},
    {"type": "interval", "every": "1h", "timezone": "America/New_York", "days": ["mon", "fri"]},
    {"type": "interval", "every": "11mo", "start": "2026-09-03T09:00:00-04:00"},
    {"type": "interval", "every": "1d", "start": "2026-09-03", "until": "2027-01-01T00:00:00Z", "count": 3},
    {"type": "daily", "at": "09:00"},
    {"type": "daily", "at": "9:00"},
    {"type": "daily", "at": ["09:00", "17:00"]},
    {"type": "daily", "at": ["23:59", "00:00"], "days": ["Monday", "tue"]},
    {"type": "daily", "at": "09:00", "days": []},
    {"type": "weekly", "day": "mon", "at": "09:00"},
    {"type": "weekly", "day": "Friday", "at": "09:00", "every": 1},
    {"type": "weekly", "day": "fri", "at": "09:00", "every": 2, "start": "2026-10-16T00:00:00"},
    {"type": "monthly", "day": 1, "at": "09:00"},
    {"type": "monthly", "day": 31, "at": "09:00"},
    {"type": "monthly", "day": "last", "at": ["09:00", "17:00"]},
    {"type": "monthly", "nth": 1, "weekday": "mon", "at": "09:00"},
    {"type": "monthly", "nth": "last", "weekday": "fri", "at": "16:00", "every": 3, "start": "2027-01-01"},
    {"type": "yearly", "date": "08-03", "at": "09:00"},
    {"type": "yearly", "date": "12-31", "at": ["00:00", "23:59"], "count": 1},
    {"type": "one_shot", "at": "2026-08-15T09:00:00-04:00"},
    {"type": "one_shot", "at": "2026-08-15T09:00:00", "days": ["mon"]},
]

INVALID = [
    ({"type": "hourly", "every": "1h"}, "unknown schedule type"),
    ("daily", "must be an object"),
    ({"type": "interval"}, "every"),
    ({"type": "interval", "every": "0m"}, "every"),
    ({"type": "interval", "every": "1.5h"}, "every"),
    ({"type": "interval", "every": "-5m"}, "every"),
    ({"type": "interval", "every": "2w"}, "every"),
    ({"type": "interval", "every": "0mo"}, "every"),
    ({"type": "interval", "every": True}, "every"),
    ({"type": "interval", "every": 0}, "every"),
    ({"type": "interval", "every": 2.5}, "every"),
    ({"type": "interval", "every": "1h", "window": {"from": "09:00", "to": "09:00"}}, "window"),
    ({"type": "interval", "every": "1h", "window": {"from": "9am", "to": "17:00"}}, "window"),
    ({"type": "interval", "every": "1h", "window": ["09:00", "17:00"]}, "window"),
    ({"type": "daily", "at": "09:00", "window": {"from": "09:00", "to": "17:00"}}, "window"),
    ({"type": "daily"}, "at"),
    ({"type": "daily", "at": "24:00"}, "at"),
    ({"type": "daily", "at": "09:60"}, "at"),
    ({"type": "daily", "at": []}, "at"),
    ({"type": "daily", "at": ["09:00", "09:00"]}, "at"),
    ({"type": "daily", "at": ["%02d:00" % h for h in range(24)] + ["00:30"]}, "at"),
    ({"type": "daily", "at": "09:00", "every": 2}, "every"),
    ({"type": "daily", "at": "09:00", "days": ["mon", "funday"]}, "days"),
    ({"type": "daily", "at": "09:00", "days": "mon"}, "days"),
    ({"type": "daily", "at": "09:00", "timezone": "Mars/Olympus"}, "timezone"),
    ({"type": "daily", "at": "09:00", "start": "next tuesday"}, "start"),
    ({"type": "daily", "at": "09:00", "start": "2026-02-30T00:00:00"}, "start"),
    ({"type": "daily", "at": "09:00", "until": "2026-13-01"}, "until"),
    ({"type": "daily", "at": "09:00", "start": "2027-01-02", "until": "2027-01-01"}, "before"),
    ({"type": "daily", "at": "09:00", "count": 0}, "count"),
    ({"type": "daily", "at": "09:00", "count": "3"}, "count"),
    ({"type": "daily", "at": "09:00", "count": True}, "count"),
    ({"type": "weekly", "at": "09:00"}, "day"),
    ({"type": "weekly", "day": "xyz", "at": "09:00"}, "day"),
    ({"type": "weekly", "day": "fri", "at": "09:00", "every": 2}, "start"),
    ({"type": "weekly", "day": "fri", "at": "09:00", "every": 0, "start": "2026-01-01"}, "every"),
    ({"type": "weekly", "day": "fri", "at": "09:00", "every": "2", "start": "2026-01-01"}, "every"),
    ({"type": "monthly", "at": "09:00"}, "either"),
    ({"type": "monthly", "day": 1, "nth": 1, "weekday": "mon", "at": "09:00"}, "either"),
    ({"type": "monthly", "day": 0, "at": "09:00"}, "day"),
    ({"type": "monthly", "day": 32, "at": "09:00"}, "day"),
    ({"type": "monthly", "day": "first", "at": "09:00"}, "day"),
    ({"type": "monthly", "nth": 5, "weekday": "mon", "at": "09:00"}, "nth"),
    ({"type": "monthly", "nth": 1, "at": "09:00"}, "weekday"),
    ({"type": "monthly", "weekday": "mon", "at": "09:00"}, "nth"),
    ({"type": "monthly", "day": 1, "at": "09:00", "every": 3}, "start"),
    ({"type": "weekly", "day": "mon", "nth": 1, "at": "09:00"}, "monthly"),
    ({"type": "yearly", "date": "02-29", "at": "09:00"}, "date"),
    ({"type": "yearly", "date": "04-31", "at": "09:00"}, "date"),
    ({"type": "yearly", "date": "8-3", "at": "09:00"}, "date"),
    ({"type": "yearly", "at": "09:00"}, "date"),
    ({"type": "yearly", "date": "08-03"}, "at"),
    ({"type": "one_shot", "at": "2026-08-15T09:00:00", "count": 2}, "count"),
    ({"type": "one_shot", "at": "2026-08-15T09:00:00", "until": "2027-01-01"}, "until"),
]


class ValidationTest(unittest.TestCase):
    def test_valid(self):
        for sch in VALID:
            with self.subTest(sch=sch):
                self.assertIsNone(eng.schedule_error(sch))

    def test_invalid(self):
        for sch, needle in INVALID:
            with self.subTest(sch=sch):
                err = eng.schedule_error(sch)
                self.assertIsNotNone(err)
                self.assertIn(needle, err.lower() if needle.islower() else err)


# ---------------------------------------------------------------------------
# 2. Hand-checked cases (all America/New_York unless noted)
# ---------------------------------------------------------------------------

def nf(sch, after, zone=NY):
    assert eng.schedule_error(sch) is None, eng.schedule_error(sch)
    return eng.next_fire(sch, after, zone)


class HandCheckedTest(unittest.TestCase):
    def eq(self, sch, after, want, zone=NY):
        self.assertEqual(show(nf(sch, after, zone), zone), show(want, zone), sch)

    # ---- daily ----
    def test_daily_basic(self):
        s = {"type": "daily", "at": "09:00"}
        self.eq(s, ny(2027, 1, 5, 8, 59), ny(2027, 1, 5, 9, 0))
        self.eq(s, ny(2027, 1, 5, 9, 0), ny(2027, 1, 6, 9, 0))      # strictly after
        self.eq(s, ny(2027, 1, 5, 9, 0, 1), ny(2027, 1, 6, 9, 0))

    def test_daily_multiple_times(self):
        s = {"type": "daily", "at": ["17:00", "09:00", "12:30"]}
        self.eq(s, ny(2027, 1, 5, 8), ny(2027, 1, 5, 9))
        self.eq(s, ny(2027, 1, 5, 9), ny(2027, 1, 5, 12, 30))
        self.eq(s, ny(2027, 1, 5, 12, 30), ny(2027, 1, 5, 17))
        self.eq(s, ny(2027, 1, 5, 17), ny(2027, 1, 6, 9))

    def test_daily_days_gate(self):
        s = {"type": "daily", "at": "09:00", "days": ["mon", "wed", "fri"]}
        self.eq(s, ny(2027, 1, 1, 9, 0), ny(2027, 1, 4, 9, 0))    # Fri → Mon
        self.eq(s, ny(2027, 1, 4, 9, 0), ny(2027, 1, 6, 9, 0))    # Mon → Wed

    def test_daily_midnight_and_last_minute(self):
        self.eq({"type": "daily", "at": "00:00"}, ny(2027, 12, 31, 23, 59), ny(2028, 1, 1))
        self.eq({"type": "daily", "at": "23:59"}, ny(2027, 12, 31, 23, 59), ny(2028, 1, 1, 23, 59))

    def test_daily_spring_forward_gap_fires_at_jump(self):
        # 2027-03-14: 02:00 EST → 03:00 EDT. 02:30 doesn't exist.
        s = {"type": "daily", "at": "02:30"}
        got = nf(s, ny(2027, 3, 13, 12))
        self.assertEqual(datetime.fromtimestamp(got, UTC), datetime(2027, 3, 14, 7, 0, tzinfo=UTC))
        self.assertEqual(show(got), "2027-03-14T03:00:00-04:00")
        self.eq(s, got, ny(2027, 3, 15, 2, 30))                   # back to normal next day

    def test_daily_gap_with_two_times_keeps_order(self):
        # 02:30 → 03:00 (jump) and 03:15 stays 03:15: both fire, in order.
        s = {"type": "daily", "at": ["02:30", "03:15"]}
        first = nf(s, ny(2027, 3, 13, 12))
        self.assertEqual(show(first), "2027-03-14T03:00:00-04:00")
        self.assertEqual(show(nf(s, first)), "2027-03-14T03:15:00-04:00")

    def test_daily_fall_back_fires_once(self):
        # 2027-11-07: 01:00-01:59 happens twice. Fire at the first occurrence only.
        s = {"type": "daily", "at": "01:30"}
        first = nf(s, ny(2027, 11, 6, 12))
        self.assertEqual(datetime.fromtimestamp(first, UTC), datetime(2027, 11, 7, 5, 30, tzinfo=UTC))
        second = nf(s, first)
        self.assertEqual(show(second), "2027-11-08T01:30:00-05:00")

    def test_explicit_timezone_beats_box_zone(self):
        s = {"type": "daily", "at": "09:00", "timezone": "Asia/Tokyo"}
        tokyo = ZoneInfo("Asia/Tokyo")
        got = nf(s, ny(2027, 1, 5), NY)
        self.assertEqual(show(got, tokyo), "2027-01-06T09:00:00+09:00")   # NY midnight = 14:00 Tokyo

    # ---- weekly ----
    def test_weekly_basic(self):
        s = {"type": "weekly", "day": "fri", "at": "09:00"}
        self.eq(s, ny(2027, 1, 1, 8), ny(2027, 1, 1, 9))          # 2027-01-01 is a Friday
        self.eq(s, ny(2027, 1, 1, 9), ny(2027, 1, 8, 9))

    def test_weekly_every_two_weeks_parity(self):
        s = {"type": "weekly", "day": "fri", "at": "09:00", "every": 2, "start": "2027-01-01T00:00:00"}
        self.eq(s, ny(2026, 12, 1), ny(2027, 1, 1, 9))            # nothing before start
        self.eq(s, ny(2027, 1, 1, 9), ny(2027, 1, 15, 9))
        self.eq(s, ny(2027, 1, 15, 9), ny(2027, 1, 29, 9))

    def test_weekly_every_two_start_midweek(self):
        # start on a Wednesday: its week (Mon 2027-01-04) is week 0 → Fri 01-08 fires.
        s = {"type": "weekly", "day": "fri", "at": "09:00", "every": 2, "start": "2027-01-06T00:00:00"}
        self.eq(s, ny(2027, 1, 1), ny(2027, 1, 8, 9))
        self.eq(s, ny(2027, 1, 8, 9), ny(2027, 1, 22, 9))

    def test_weekly_every_two_start_after_target_day(self):
        # start on Sat 2027-01-09: week 0's Friday (01-08) is before start → skip;
        # next eligible is week 2 → Fri 01-22.
        s = {"type": "weekly", "day": "fri", "at": "09:00", "every": 2, "start": "2027-01-09T00:00:00"}
        self.eq(s, ny(2027, 1, 1), ny(2027, 1, 22, 9))

    def test_weekly_every_three_weeks_across_year_end(self):
        s = {"type": "weekly", "day": "mon", "at": "08:00", "every": 3, "start": "2027-12-06T00:00:00"}
        self.eq(s, ny(2027, 12, 6, 8), ny(2027, 12, 27, 8))
        self.eq(s, ny(2027, 12, 27, 8), ny(2028, 1, 17, 8))

    # ---- monthly ----
    def test_monthly_day_of_month(self):
        s = {"type": "monthly", "day": 1, "at": "09:00"}
        self.eq(s, ny(2027, 1, 1, 9), ny(2027, 2, 1, 9))
        self.eq(s, ny(2027, 12, 1, 9), ny(2028, 1, 1, 9))

    def test_monthly_31st_clamps(self):
        s = {"type": "monthly", "day": 31, "at": "09:00"}
        self.eq(s, ny(2027, 1, 31, 9), ny(2027, 2, 28, 9))
        self.eq(s, ny(2027, 2, 28, 9), ny(2027, 3, 31, 9))
        self.eq(s, ny(2027, 3, 31, 9), ny(2027, 4, 30, 9))
        self.eq(s, ny(2028, 1, 31, 9), ny(2028, 2, 29, 9))        # leap year

    def test_monthly_30th_in_february(self):
        s = {"type": "monthly", "day": 30, "at": "09:00"}
        self.eq(s, ny(2027, 1, 30, 9), ny(2027, 2, 28, 9))
        self.eq(s, ny(2027, 2, 28, 9), ny(2027, 3, 30, 9))

    def test_monthly_last_day(self):
        s = {"type": "monthly", "day": "last", "at": "17:00"}
        self.eq(s, ny(2027, 1, 1), ny(2027, 1, 31, 17))
        self.eq(s, ny(2027, 1, 31, 17), ny(2027, 2, 28, 17))
        self.eq(s, ny(2028, 2, 1), ny(2028, 2, 29, 17))
        self.eq(s, ny(2027, 4, 1), ny(2027, 4, 30, 17))

    def test_monthly_nth_weekday(self):
        first_mon = {"type": "monthly", "nth": 1, "weekday": "mon", "at": "09:00"}
        self.eq(first_mon, ny(2027, 1, 1), ny(2027, 1, 4, 9))
        self.eq(first_mon, ny(2027, 1, 4, 9), ny(2027, 2, 1, 9))  # Feb 1 2027 is a Monday
        fourth_thu = {"type": "monthly", "nth": 4, "weekday": "thu", "at": "12:00"}
        self.eq(fourth_thu, ny(2027, 11, 1), ny(2027, 11, 25, 12))  # US Thanksgiving
        last_fri = {"type": "monthly", "nth": "last", "weekday": "fri", "at": "16:00"}
        self.eq(last_fri, ny(2027, 1, 1), ny(2027, 1, 29, 16))
        self.eq(last_fri, ny(2027, 4, 1), ny(2027, 4, 30, 16))      # 5th Friday is the last
        self.eq(last_fri, ny(2027, 2, 1), ny(2027, 2, 26, 16))

    def test_monthly_every_three_months(self):
        s = {"type": "monthly", "day": 15, "at": "09:00", "every": 3, "start": "2027-01-01"}
        self.eq(s, ny(2026, 6, 1), ny(2027, 1, 15, 9))
        self.eq(s, ny(2027, 1, 15, 9), ny(2027, 4, 15, 9))
        self.eq(s, ny(2027, 10, 15, 9), ny(2028, 1, 15, 9))

    def test_monthly_every_two_start_after_slot_in_month(self):
        # start Jan 20: Jan 15 is before start, March is the next eligible month.
        s = {"type": "monthly", "day": 15, "at": "09:00", "every": 2, "start": "2027-01-20"}
        self.eq(s, ny(2027, 1, 1), ny(2027, 3, 15, 9))

    # ---- yearly ----
    def test_yearly(self):
        s = {"type": "yearly", "date": "08-03", "at": "09:00"}
        self.eq(s, ny(2026, 10, 11), ny(2027, 8, 3, 9))
        self.eq(s, ny(2027, 8, 3, 9), ny(2028, 8, 3, 9))
        self.eq(s, ny(2028, 2, 29, 12), ny(2028, 8, 3, 9))

    def test_yearly_dec31_multiple_times(self):
        s = {"type": "yearly", "date": "12-31", "at": ["00:00", "23:59"]}
        self.eq(s, ny(2027, 12, 31, 0), ny(2027, 12, 31, 23, 59))
        self.eq(s, ny(2027, 12, 31, 23, 59), ny(2028, 12, 31, 0))

    # ---- interval ----
    def test_interval_relative(self):
        self.eq({"type": "interval", "every": "30m"}, ny(2027, 1, 1, 9, 0, 17), ny(2027, 1, 1, 9, 30, 17))
        self.eq({"type": "interval", "every": "90"}, ny(2027, 1, 1, 9), ny(2027, 1, 1, 10, 30))
        self.eq({"type": "interval", "every": 15}, ny(2027, 1, 1, 9), ny(2027, 1, 1, 9, 15))

    def test_interval_relative_seconds_cross_dst(self):
        # Elapsed seconds don't care about DST: 1d from 12:00 EST = 13:00 EDT.
        self.eq({"type": "interval", "every": "1d"}, ny(2027, 3, 13, 12), ny(2027, 3, 14, 13))

    def test_interval_months_relative(self):
        self.eq({"type": "interval", "every": "1mo"}, ny(2027, 1, 31, 12), ny(2027, 2, 28, 12))
        self.eq({"type": "interval", "every": "13mo"}, ny(2027, 1, 31), ny(2028, 2, 29))
        self.eq({"type": "interval", "every": "3mo"}, ny(2027, 11, 15), ny(2028, 2, 15))

    def test_interval_months_grid_no_clamp_drift(self):
        # Grid from Jan 31: Feb 28, Mar 31 (not Mar 28 — computed from start, not chained).
        s = {"type": "interval", "every": "1mo", "start": "2027-01-31T09:00:00"}
        self.eq(s, ny(2027, 1, 31, 9), ny(2027, 2, 28, 9))
        self.eq(s, ny(2027, 2, 28, 9), ny(2027, 3, 31, 9))
        self.eq(s, ny(2027, 3, 31, 9), ny(2027, 4, 30, 9))

    def test_token_renewal_schedule(self):
        s = {"type": "interval", "every": "11mo", "start": "2026-09-03T09:00:00-04:00"}
        self.eq(s, ny(2026, 10, 11, 14), ny(2027, 8, 3, 9))
        self.eq(s, ny(2027, 8, 3, 9), ny(2028, 7, 3, 9))
        self.eq(s, ny(2028, 7, 3, 9), ny(2029, 6, 3, 9))

    def test_interval_grid_seconds(self):
        s = {"type": "interval", "every": "1h", "start": "2027-01-01T00:15:00-05:00"}
        self.eq(s, ny(2026, 12, 1), ny(2027, 1, 1, 0, 15))            # before start → start
        self.eq(s, ny(2027, 1, 1, 0, 15), ny(2027, 1, 1, 1, 15))
        self.eq(s, ny(2027, 1, 1, 5, 47, 3), ny(2027, 1, 1, 6, 15))   # catch-up stays on grid

    def test_interval_window(self):
        s = {"type": "interval", "every": "30m", "window": {"from": "09:00", "to": "17:00"}}
        self.eq(s, ny(2027, 1, 4, 16, 30), ny(2027, 1, 4, 17, 0))      # `to` inclusive
        self.eq(s, ny(2027, 1, 4, 16, 31), ny(2027, 1, 5, 9, 0))       # 17:01 outside → next opening
        self.eq(s, ny(2027, 1, 4, 3, 0), ny(2027, 1, 4, 9, 0))

    def test_interval_window_grid(self):
        s = {"type": "interval", "every": "30m", "start": "2027-01-04T09:00:00",
             "window": {"from": "09:00", "to": "17:00"}, "days": ["mon", "tue", "wed", "thu", "fri"]}
        self.eq(s, ny(2027, 1, 4, 9, 10), ny(2027, 1, 4, 9, 30))
        self.eq(s, ny(2027, 1, 8, 17, 0), ny(2027, 1, 11, 9, 0))       # Fri 17:00 → Mon 09:00

    def test_interval_window_wraps_midnight(self):
        s = {"type": "interval", "every": "1h", "window": {"from": "22:00", "to": "02:00"}}
        self.eq(s, ny(2027, 1, 4, 23, 30), ny(2027, 1, 5, 0, 30))
        self.eq(s, ny(2027, 1, 5, 1, 30), ny(2027, 1, 5, 22, 0))       # 02:30 out → 22:00

    def test_interval_window_in_dst_gap(self):
        # Window 02:15-03:30 on spring-forward day: local 02:15 never happens; the
        # window opens when the clock reads 03:00.
        s = {"type": "interval", "every": "4h", "window": {"from": "02:15", "to": "03:30"}}
        # 22:00 EST + 4h elapsed = the 07:00Z jump instant, local 03:00 → in window.
        self.eq(s, ny(2027, 3, 13, 22, 0), ny(2027, 3, 14, 3, 0))

    def test_interval_grid_never_lands_in_window(self):
        # Grid of 24h at 12:00 never lands in 09:00-10:00 → never fires.
        s = {"type": "interval", "every": "1d", "start": "2027-01-01T12:00:00-05:00",
             "window": {"from": "09:00", "to": "10:00"}}
        self.assertIsNone(nf(s, ny(2027, 1, 1)))

    # ---- start / until ----
    def test_start_in_future(self):
        s = {"type": "daily", "at": "09:00", "start": "2027-06-01T12:00:00"}
        self.eq(s, ny(2027, 1, 1), ny(2027, 6, 2, 9))

    def test_start_exactly_on_slot_fires(self):
        s = {"type": "daily", "at": "09:00", "start": "2027-06-01T09:00:00"}
        self.eq(s, ny(2027, 1, 1), ny(2027, 6, 1, 9))

    def test_until(self):
        s = {"type": "daily", "at": "09:00", "until": "2027-01-03T09:00:00"}
        self.eq(s, ny(2027, 1, 2, 9), ny(2027, 1, 3, 9))               # until inclusive
        self.assertIsNone(nf(s, ny(2027, 1, 3, 9)))
        s2 = {"type": "interval", "every": "1h", "until": "2027-01-01T10:30:00"}
        self.assertIsNone(nf(s2, ny(2027, 1, 1, 9, 31)))

    def test_date_only_and_offset_start(self):
        a = {"type": "daily", "at": "09:00", "start": "2027-06-01"}
        b = {"type": "daily", "at": "09:00", "start": "2027-06-01T00:00:00-04:00"}
        self.assertEqual(nf(a, ny(2027, 1, 1)), nf(b, ny(2027, 1, 1)))

    def test_days_gate_on_monthly_never_matches(self):
        # First Monday gated to Fridays only → never.
        s = {"type": "monthly", "nth": 1, "weekday": "mon", "at": "09:00", "days": ["fri"]}
        self.assertIsNone(nf(s, ny(2027, 1, 1)))

    def test_box_zone_used_for_naive(self):
        s = {"type": "daily", "at": "09:00"}
        tokyo = ZoneInfo("Asia/Tokyo")
        self.assertEqual(show(nf(s, ny(2027, 1, 5), tokyo), tokyo), "2027-01-06T09:00:00+09:00")


# ---------------------------------------------------------------------------
# 3. Independent brute-force oracle
# ---------------------------------------------------------------------------
# Deliberately shares NO helpers with the engine: dates qualify by direct
# predicates, local→instant resolution is a forward scan of the clock, and the
# answer is the global minimum over every candidate in the horizon.

def o_wall(ts, zi):
    return datetime.fromtimestamp(ts, tz=zi).replace(tzinfo=None)


def o_first_instant(naive, zi):
    """First instant whose local reading is >= naive: scan the clock forward
    (15-minute steps, then minutes, then seconds)."""
    whole = naive.replace(microsecond=0)
    guess = int(whole.replace(tzinfo=UTC).timestamp()) - 16 * 3600
    guess -= guess % 60
    t = guess
    while o_wall(t + 900, zi) < whole:
        t += 900
    while o_wall(t + 60, zi) < whole:
        t += 60
    while o_wall(t, zi) < whole:
        t += 1
    if o_wall(t, zi) == whole:
        return t + naive.microsecond / 1e6    # the time exists: exact instant
    return float(t)                           # skipped by a jump: the jump instant


def o_hhmm(v):
    h, m = v.split(":")
    return int(h), int(m)


def o_times(at):
    return sorted({o_hhmm(x) for x in (at if isinstance(at, list) else [at])})


def o_iso(v, zi):
    if v is None:
        return None
    s = v.strip()
    if len(s) == 10:
        return o_first_instant(datetime.strptime(s, "%Y-%m-%d"), zi)
    if s.endswith("Z"):
        return datetime.strptime(s[:-1], "%Y-%m-%dT%H:%M:%S").replace(tzinfo=UTC).timestamp()
    if s[-6] in "+-":
        return datetime.fromisoformat(s).timestamp()
    return o_first_instant(datetime.strptime(s, "%Y-%m-%dT%H:%M:%S"), zi)


def o_days(days):
    return None if not days else {DOW.index(d[:3].lower()) for d in days}


def o_allowed(ts, zi, days, window):
    w = datetime.fromtimestamp(ts, tz=zi)
    if days is not None and w.weekday() not in days:
        return False
    if window is None:
        return True
    sod = w.hour * 3600 + w.minute * 60 + w.second + w.microsecond / 1e6
    a = o_hhmm(window["from"])
    b = o_hhmm(window["to"])
    a = a[0] * 3600 + a[1] * 60
    b = b[0] * 3600 + b[1] * 60
    if a < b:
        return a <= sod <= b
    return sod >= a or sod <= b


def o_is_last_day(d):
    return (d + timedelta(days=1)).month != d.month


def o_qualifies(sch, d, start_date):
    t = sch["type"]
    if t == "daily":
        return True
    if t == "weekly":
        if d.weekday() != DOW.index(sch["day"][:3].lower()):
            return False
        n = sch.get("every", 1)
        if n == 1:
            return True
        monday0 = start_date.toordinal() - start_date.weekday()
        weeks = (d.toordinal() - monday0) // 7
        return weeks % n == 0
    if t == "monthly":
        n = sch.get("every", 1)
        if n > 1:
            months = (d.year - start_date.year) * 12 + (d.month - start_date.month)
            if months % n != 0:
                return False
        if "day" in sch:
            if sch["day"] == "last":
                return o_is_last_day(d)
            mdays = calendar.monthrange(d.year, d.month)[1]
            return d.day == min(sch["day"], mdays)
        if d.weekday() != DOW.index(sch["weekday"]):
            return False
        if sch["nth"] == "last":
            return (d + timedelta(days=7)).month != d.month
        return (d.day - 1) // 7 + 1 == sch["nth"]
    if t == "yearly":
        mm, dd = (int(x) for x in sch["date"].split("-"))
        return (d.month, d.day) == (mm, dd)
    raise AssertionError(t)


def o_wall_next(sch, after, zi, horizon_days):
    start = o_iso(sch.get("start"), zi)
    until = o_iso(sch.get("until"), zi)
    days = o_days(sch.get("days"))
    start_date = datetime.fromtimestamp(start, zi).date() if start is not None else None
    d = datetime.fromtimestamp(max(after, start or after), zi).date() - timedelta(days=2)
    best = None
    for _ in range(horizon_days):
        if o_qualifies(sch, d, start_date) and (days is None or d.weekday() in days):
            for h, m in o_times(sch["at"]):
                ts = o_first_instant(datetime(d.year, d.month, d.day, h, m), zi)
                if ts > after and (start is None or ts >= start):
                    if best is None or ts < best:
                        best = ts
        if best is not None and d > datetime.fromtimestamp(best, zi).date() + timedelta(days=2):
            break
        d += timedelta(days=1)
    if best is not None and until is not None and best > until:
        return None, d
    return best, d


def o_add_months_naive(naive, n):
    y = naive.year + (naive.month - 1 + n) // 12
    mo = (naive.month - 1 + n) % 12 + 1
    day = naive.day
    while True:
        try:
            return naive.replace(year=y, month=mo, day=day)
        except ValueError:
            day -= 1


def o_every(every):
    if isinstance(every, int):
        return ("s", every * 60)
    s = every.lower()
    if s.endswith("mo"):
        return ("mo", int(s[:-2]))
    if s[-1] in "smhd":
        return ("s", int(s[:-1]) * {"s": 1, "m": 60, "h": 3600, "d": 86400}[s[-1]])
    return ("s", int(s) * 60)


def o_interval_next(sch, after, zi, max_steps):
    start = o_iso(sch.get("start"), zi)
    until = o_iso(sch.get("until"), zi)
    days = o_days(sch.get("days"))
    window = sch.get("window")
    kind, n = o_every(sch["every"])
    if start is None:
        if kind == "s":
            cand = after + n
        else:
            cand = o_first_instant(o_add_months_naive(o_wall(after, zi), n), zi)
        if o_allowed(cand, zi, days, window):
            res = cand
        else:
            t = cand - cand % 60 + 60
            res = None
            for _ in range(9 * 1440):
                if o_allowed(t, zi, days, window):
                    res = float(t)
                    break
                t += 60
        if res is None or (until is not None and res > until):
            return None
        return res
    start_naive = o_wall(start, zi)
    if kind == "mo":
        max_steps = min(max_steps, 3000)
    for k in range(max_steps):
        if kind == "s":
            s = start + k * n
        else:
            s = o_first_instant(o_add_months_naive(start_naive, k * n), zi)
        if s <= after:
            continue
        if until is not None and s > until:
            return None
        if o_allowed(s, zi, days, window):
            return s
    return "horizon"


# ---- random schedule generator ----

TIMES = ["00:00", "00:30", "01:00", "01:30", "02:00", "02:30", "03:00", "03:30",
         "09:00", "12:00", "17:45", "23:30", "23:59"]


def rand_time(r):
    return r.choice(TIMES) if r.random() < 0.7 else "%02d:%02d" % (r.randrange(24), r.randrange(60))


def rand_at(r):
    if r.random() < 0.6:
        return rand_time(r)
    return sorted({rand_time(r) for _ in range(r.randint(2, 4))})


def rand_iso_naive(r, base):
    d = base + timedelta(days=r.randint(-400, 400), minutes=r.randrange(0, 1440, 5))
    if r.random() < 0.3:
        return d.strftime("%Y-%m-%d")
    return d.strftime("%Y-%m-%dT%H:%M:%S")


def rand_days(r):
    k = r.randint(1, 6)
    return sorted(r.sample(DOW, k), key=DOW.index)


def rand_schedule(r, base):
    t = r.choice(["daily", "weekly", "monthly", "yearly", "interval", "interval"])
    sch = {"type": t}
    if t == "interval":
        unit = r.choice(["m", "h", "d", "mo", "bare"])
        if unit == "mo":
            sch["every"] = "%dmo" % r.choice([1, 2, 3, 6, 11, 12, 13])
        elif unit == "bare":
            sch["every"] = r.choice([15, "45", 90])
        else:
            sch["every"] = "%d%s" % (r.choice({"m": [5, 15, 30, 45, 90], "h": [1, 2, 3, 7, 25],
                                               "d": [1, 2, 7]}[unit]), unit)
        if r.random() < 0.4:
            a, b = rand_time(r), rand_time(r)
            if a != b:
                sch["window"] = {"from": a, "to": b}
        if r.random() < 0.5:
            sch["start"] = rand_iso_naive(r, base)
    else:
        sch["at"] = rand_at(r)
    if t == "weekly":
        sch["day"] = r.choice(DOW)
        if r.random() < 0.5:
            sch["every"] = r.choice([2, 3, 4])
    if t == "monthly":
        if r.random() < 0.5:
            sch["day"] = r.choice([1, 15, 28, 29, 30, 31, "last"])
        else:
            sch["nth"] = r.choice([1, 2, 3, 4, "last"])
            sch["weekday"] = r.choice(DOW)
        if r.random() < 0.4:
            sch["every"] = r.choice([2, 3, 6, 12])
    if t == "yearly":
        sch["date"] = r.choice(["01-01", "02-28", "03-01", "03-14", "08-03", "10-31",
                                "11-07", "12-31", "%02d-%02d" % (r.randint(1, 12), r.randint(1, 28))])
    if t in ("weekly", "monthly") and sch.get("every", 1) > 1 or (t != "interval" and r.random() < 0.25):
        sch["start"] = rand_iso_naive(r, base)
    if r.random() < 0.3:
        sch["days"] = rand_days(r)
    if r.random() < 0.15:
        u = datetime.fromisoformat(sch["start"]) if "start" in sch and len(sch["start"]) > 10 else base
        sch["until"] = (u + timedelta(days=r.randint(1, 900))).strftime("%Y-%m-%dT%H:%M:%S")
    if r.random() < 0.5:
        sch["timezone"] = r.choice(ZONES)
    return sch


def transitions(zi, year):
    """UTC instants of every offset change in `year` (hour scan + minute refine)."""
    out = []
    t = int(datetime(year, 1, 1, tzinfo=UTC).timestamp())
    end = int(datetime(year + 1, 1, 1, tzinfo=UTC).timestamp())
    prev = datetime.fromtimestamp(t, zi).utcoffset()
    while t < end:
        nxt = t + 3600
        off = datetime.fromtimestamp(nxt, zi).utcoffset()
        if off != prev:
            m = t
            while datetime.fromtimestamp(m, zi).utcoffset() == prev:
                m += 60
            out.append(m)
            prev = off
        t = nxt
    return out


class OracleDifferentialTest(unittest.TestCase):
    def test_random_schedules_match_oracle(self):
        r = random.Random(20261011)
        base = datetime(2027, 1, 1)
        trans = {z: transitions(ZoneInfo(z), y) for z in ZONES for y in (2027,)}
        checked = never = 0
        for i in range(FUZZ_CASES):
            sch = rand_schedule(r, base)
            err = eng.schedule_error(sch)
            if err:
                # The generator only builds legal shapes, except until-before-start.
                self.assertIn("before `start`", err, sch)
                continue
            box = ZoneInfo(r.choice(ZONES))
            zi = ZoneInfo(sch["timezone"]) if "timezone" in sch else box
            tz_trans = trans[sch.get("timezone") or box.key]
            if tz_trans and r.random() < 0.5:
                after = r.choice(tz_trans) + r.randint(-36 * 3600, 36 * 3600)
            else:
                after = (base + timedelta(days=r.randint(-200, 600))).replace(tzinfo=UTC).timestamp()
                after += r.randrange(86400)
            if r.random() < 0.3:
                after += r.random()                     # fractional, like time.time()
            got = eng.next_fire(sch, after, box)
            with self.subTest(i=i, sch=sch, after=after, box=box.key):
                if sch["type"] == "interval":
                    want = o_interval_next(sch, after, zi, max_steps=200000)
                    if want == "horizon":
                        continue
                    self.assertEqual(show(got, zi), show(want, zi))
                else:
                    horizon = {"daily": 30, "weekly": 200, "monthly": 1500, "yearly": 3000}[sch["type"]]
                    res, scanned_to = o_wall_next(sch, after, zi, horizon)
                    if res is None:
                        never += 1
                        if got is not None:
                            # Oracle saw nothing within its horizon — engine's answer must lie beyond it.
                            self.assertGreater(datetime.fromtimestamp(got, zi).date(), scanned_to)
                    else:
                        self.assertEqual(show(got, zi), show(res, zi))
                if got is not None:
                    self.assertGreater(got, after)
            checked += 1
        self.assertGreater(checked, FUZZ_CASES * 0.8)


# ---------------------------------------------------------------------------
# 4. Scheduler simulation through `decide`
# ---------------------------------------------------------------------------

def all_slots(sch, t0, t1, zone):
    """Every slot in (t0, t1] by iterating next_fire (validated by layer 3)."""
    out, t = [], t0
    while True:
        n = eng.next_fire(sch, t, zone)
        if n is None or n > t1:
            return out
        out.append(n)
        t = n


def simulate(sch, t0, t1, zone, r, poll=(20, 40), downtimes=()):
    """Return (anchor_time, [fire times]) for a poll loop from t0 to t1."""
    last = anchored = None
    runs = 0
    fires = []
    t = t0
    anchor_at = None
    while t <= t1:
        if not any(a <= t < b for a, b in downtimes):
            action = eng.decide(sch, last, anchored, runs, t, zone)
            if action == "anchor":
                anchored = anchor_at = t
            elif action == "fire":
                fires.append(t)
                last = t
                runs += 1
        t += r.uniform(*poll)
    return anchor_at, fires


class SimulationTest(unittest.TestCase):
    def check_fixed_slots(self, sch, t0, t1, zone, r, poll, downtimes=()):
        """For fixed-slot schedules: a poll fires iff a slot lies in
        (previous poll, this poll] — after the anchor, within count."""
        anchor_at, fires = simulate(sch, t0, t1, zone, r, poll, downtimes)
        slots = all_slots(sch, anchor_at, t1 + 86400 * 400, zone)
        # Re-derive the polls the simulator actually ran (deterministic re-run).
        polls = []
        rr = random.Random(r.seed_value)
        t = t0
        while t <= t1:
            if not any(a <= t < b for a, b in downtimes):
                polls.append(t)
            t += rr.uniform(*poll)
        expected = []
        prev = polls[0]
        si = 0
        count = sch.get("count")
        for p in polls[1:]:
            hit = False
            while si < len(slots) and slots[si] <= p:
                if slots[si] > prev:
                    hit = True
                si += 1
            if hit and (count is None or len(expected) < count):
                expected.append(p)
            prev = p
        self.assertEqual([show(f, zone) for f in fires], [show(e, zone) for e in expected], sch)
        return fires, slots

    def seeded(self, seed):
        r = random.Random(seed)
        r.seed_value = seed
        return r

    def test_daily_multi_times_with_downtime(self):
        sch = {"type": "daily", "at": ["02:30", "09:00", "17:00"], "timezone": "America/New_York"}
        t0, t1 = ny(2027, 3, 1), ny(2027, 4, 15)
        down = [(ny(2027, 3, 10, 8), ny(2027, 3, 12, 10)),     # 2 days down: several slots → ONE catch-up
                (ny(2027, 3, 20, 8, 59), ny(2027, 3, 20, 9, 1))]
        fires, slots = self.check_fixed_slots(sch, t0, t1, NY, self.seeded(1), (20, 40), down)
        catch_up = [f for f in fires if ny(2027, 3, 12, 10) <= f < ny(2027, 3, 12, 10, 1)]
        self.assertEqual(len(catch_up), 1)
        # Never fires before its slot, and only ~one poll late when the box is up.
        for f in fires:
            prior = [s for s in slots if s <= f]
            self.assertTrue(prior)

    def test_weekly_every_two_across_dst(self):
        sch = {"type": "weekly", "day": "sun", "at": "02:30", "every": 2,
               "start": "2027-01-03T00:00:00", "timezone": "America/New_York"}
        self.check_fixed_slots(sch, ny(2027, 1, 1), ny(2027, 12, 31), NY, self.seeded(2), (600, 1800))

    def test_monthly_last_friday_with_count(self):
        sch = {"type": "monthly", "nth": "last", "weekday": "fri", "at": "16:00", "count": 4}
        fires, _ = self.check_fixed_slots(sch, ny(2027, 1, 1), ny(2028, 6, 1), NY, self.seeded(3), (1800, 3600))
        self.assertEqual(len(fires), 4)

    def test_monthly_31st_until(self):
        sch = {"type": "monthly", "day": 31, "at": "09:00", "until": "2027-06-30T09:00:00"}
        fires, _ = self.check_fixed_slots(sch, ny(2027, 1, 1), ny(2027, 12, 31), NY, self.seeded(4), (1800, 3600))
        self.assertEqual(len(fires), 6)      # Jan 31, Feb 28, Mar 31, Apr 30, May 31, Jun 30

    def test_grid_interval_window_lord_howe(self):
        lh = ZoneInfo("Australia/Lord_Howe")   # 30-minute DST shift
        sch = {"type": "interval", "every": "45m", "start": "2027-03-30T08:00:00",
               "window": {"from": "01:00", "to": "03:00"}, "timezone": "Australia/Lord_Howe"}
        t0 = datetime(2027, 3, 30, tzinfo=lh).timestamp()
        t1 = datetime(2027, 4, 10, tzinfo=lh).timestamp()
        self.check_fixed_slots(sch, t0, t1, lh, self.seeded(5), (20, 40))

    def test_token_renewal_simulated_over_years(self):
        sch = {"type": "interval", "every": "11mo", "start": "2026-09-03T09:00:00-04:00"}
        anchor_at, fires = simulate(sch, ny(2026, 10, 11, 14), ny(2030, 1, 1), NY,
                                    self.seeded(6), poll=(3000, 4000))
        self.assertEqual([datetime.fromtimestamp(f, NY).date() for f in fires],
                         [date(2027, 8, 3), date(2028, 7, 3), date(2029, 6, 3)])
        for f in fires:
            self.assertLess(f - datetime.fromtimestamp(f, NY).replace(hour=9, minute=0, second=0).timestamp(), 4001)

    def test_first_sight_never_fires_even_if_slot_just_passed(self):
        sch = {"type": "daily", "at": "09:00"}
        anchor_at, fires = simulate(sch, ny(2027, 1, 1, 9, 0, 5), ny(2027, 1, 1, 12), NY, self.seeded(7))
        self.assertEqual(fires, [])

    def test_relative_interval_spacing(self):
        sch = {"type": "interval", "every": "10m"}
        _, fires = simulate(sch, ny(2027, 1, 1), ny(2027, 1, 3), NY, self.seeded(8), (20, 40))
        gaps = [b - a for a, b in zip(fires, fires[1:])]
        self.assertTrue(all(600 <= g <= 640 for g in gaps), (min(gaps), max(gaps)))

    def test_relative_interval_window_days(self):
        sch = {"type": "interval", "every": "30m", "window": {"from": "09:00", "to": "17:00"},
               "days": ["mon", "tue", "wed", "thu", "fri"]}
        _, fires = simulate(sch, ny(2027, 1, 1), ny(2027, 1, 15), NY, self.seeded(9), (20, 40))
        for f in fires:
            w = datetime.fromtimestamp(f, NY)
            self.assertLess(w.weekday(), 5, w)
            sod = w.hour * 3600 + w.minute * 60 + w.second
            self.assertTrue(9 * 3600 <= sod <= 17 * 3600 + 40, w)   # allow one poll of lateness
        per_day = {}
        for f in fires:
            per_day.setdefault(datetime.fromtimestamp(f, NY).date(), 0)
            per_day[datetime.fromtimestamp(f, NY).date()] += 1
        self.assertTrue(all(14 <= n <= 17 for n in per_day.values()), per_day)

    def test_random_fixed_slot_schedules(self):
        r = random.Random(424242)
        base = datetime(2027, 1, 1)
        n = 0
        while n < 40:
            sch = rand_schedule(r, base)
            if sch["type"] == "interval" and "start" not in sch:
                continue
            if eng.schedule_error(sch):
                continue
            if r.random() < 0.3:
                sch["count"] = r.randint(1, 5)
            box = ZoneInfo(r.choice(ZONES))
            zi = ZoneInfo(sch["timezone"]) if "timezone" in sch else box
            t0 = datetime(2027, 1, 1, tzinfo=zi).timestamp() + r.randrange(86400 * 30)
            span = {"interval": 10, "daily": 20, "weekly": 120, "monthly": 400, "yearly": 1200}[sch["type"]]
            poll = (60, 300) if sch["type"] in ("interval", "daily") else (3600, 7200)
            down = []
            if r.random() < 0.5:
                d0 = t0 + r.uniform(0, span * 86400)
                down = [(d0, d0 + r.uniform(600, 86400 * 3))]
            with self.subTest(sch=sch, box=box.key):
                self.check_fixed_slots(sch, t0, t0 + span * 86400, box, self.seeded(1000 + n), poll, down)
            n += 1


if __name__ == "__main__":
    unittest.main()
