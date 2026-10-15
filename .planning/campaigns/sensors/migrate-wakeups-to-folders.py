#!/usr/bin/env python3
"""Deploy-time migration for shape-sensor-scaffolding: flat wake-ups → folders.

Run ON EACH HOST, as the fleet user, AFTER the distributor has installed the new
wakeup-scheduler / ambient-monitor / agent-supervisor there.

    python3 migrate-wakeups-to-folders.py            # dry run: print the plan
    python3 migrate-wakeups-to-folders.py --apply    # do it

For every identity (live and archived) it converts each
`wakeups/<stem>.json` into `wakeups/<slug>/wakeup.json`, moving that wake-up's
state (`.state/<old key>.{last,anchored,runs,fired,wake}`, where the old key was
the spec's `name` or else the file stem) to `wakeups/<slug>/.state/<slug>.*`.

Then, with --apply, it restarts the ambient monitor of every identity that is
running right now, so its wake-up scheduler child runs the new folder-aware code
(monitors never restart children on their own; an old scheduler would find no
flat specs and go silent, and the supervisor would refuse to let it go dormant).
The monitor is relaunched with exactly the arguments it was running with.
"""

import glob
import json
import os
import re
import signal
import subprocess
import sys
import time

HOME = os.path.expanduser("~")
FLEET = os.path.join(HOME, "fleet")
SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,79}$")
STATE_EXTS = (".last", ".anchored", ".runs", ".fired", ".wake")


def slugify(stem):
    s = re.sub(r"[^a-z0-9_-]+", "-", stem.lower()).strip("-_")[:80]
    return s or "wakeup"


def plan_identity(wdir):
    steps, problems = [], []
    for p in sorted(glob.glob(os.path.join(wdir, "*.json"))):
        stem = os.path.splitext(os.path.basename(p))[0]
        try:
            spec = json.load(open(p))
        except Exception as e:
            problems.append("%s: unreadable (%s) — left alone" % (p, e))
            continue
        slug = stem if SLUG_RE.match(stem) else slugify(stem)
        target = os.path.join(wdir, slug)
        if os.path.exists(target):
            problems.append("%s: target folder %s already exists — left alone" % (p, target))
            continue
        old_key = spec.get("name") if isinstance(spec, dict) and spec.get("name") else stem
        moves = []
        for ext in STATE_EXTS:
            src = os.path.join(wdir, ".state", old_key + ext)
            if os.path.isfile(src):
                moves.append((src, os.path.join(target, ".state", slug + ext)))
        steps.append((p, target, moves))
    return steps, problems


def apply_steps(steps):
    for spec_path, target, moves in steps:
        os.makedirs(os.path.join(target, ".state"))
        os.rename(spec_path, os.path.join(target, "wakeup.json"))
        for src, dst in moves:
            os.rename(src, dst)


def running_monitors():
    """[(pid, argv)] of ambient-monitor processes owned by this user."""
    out = []
    for d in glob.glob("/proc/[0-9]*"):
        try:
            if os.stat(d).st_uid != os.getuid():
                continue
            argv = open(os.path.join(d, "cmdline"), "rb").read().split(b"\0")
        except OSError:
            continue
        argv = [a.decode(errors="replace") for a in argv if a]
        if any(os.path.basename(a) == "ambient-monitor" for a in argv[:2]) and "--inject-to" in argv:
            out.append((int(os.path.basename(d)), argv))
    return out


def restart_monitor(pid, argv):
    iddir = next(a for a in argv if a.startswith("/") and "/fleet/identities/" in a)
    name = os.path.basename(iddir.rstrip("/"))
    os.kill(pid, signal.SIGTERM)
    for _ in range(40):
        if not os.path.exists("/proc/%d" % pid):
            break
        time.sleep(0.25)
    else:
        print("  ! %s: monitor pid %d did not exit — not relaunching" % (name, pid))
        return
    logf = os.path.join(iddir, "ambient-monitor.log")
    with open(logf, "w") as lf:
        subprocess.Popen(argv, stdout=lf, stderr=lf, stdin=subprocess.DEVNULL, start_new_session=True)
    print("  restarted ambient monitor for %s" % name)


def main():
    apply = "--apply" in sys.argv
    total = 0
    for base in ("identities", "identities-archive"):
        for wdir in sorted(glob.glob(os.path.join(FLEET, base, "*", "wakeups"))):
            steps, problems = plan_identity(wdir)
            for spec_path, target, moves in steps:
                print("%s → %s/wakeup.json  (+%d state files)" % (spec_path, target, len(moves)))
            for pr in problems:
                print("  ! " + pr)
            total += len(steps)
            if apply and steps:
                apply_steps(steps)
    print("%d wake-up(s) %s." % (total, "converted" if apply else "to convert (dry run; pass --apply)"))
    mons = running_monitors()
    if not apply:
        print("%d running ambient monitor(s) would be restarted." % len(mons))
        return 0
    for pid, argv in mons:
        try:
            restart_monitor(pid, argv)
        except Exception as e:
            print("  ! monitor pid %d: %s" % (pid, e))
    return 0


if __name__ == "__main__":
    sys.exit(main())
