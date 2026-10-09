#!/usr/bin/env python3
"""role-file-watch.py — fourth ambient monitor: watch for edits to an identity's role file, identity file, id skill, AND runbooks.

The sibling of the relay receiver, the wake-up scheduler, and the context-watch.
The receiver wakes on a MESSAGE, the scheduler on the CLOCK, the context-watch on
CONTEXT PRESSURE — this fourth monitor wakes on a ROLE-FILE, IDENTITY-FILE, ID-SKILL,
OR RUNBOOK CHANGE, so mid-session edits become visible to a running identity
without needing a full recycle.

Why this exists: closes the mid-session gap where an agent's in-context copy of its
role file, its own identity file, the id skill, or a role-scope runbook has
diverged from disk. For the role file, that's a peer identity of the same role
editing it in another session. For the identity file, that's almost always user
editing it directly (cosmetic frontmatter changes, an identity-scope `remember`)
— peer sessions of the SAME identity are essentially impossible. For the id skill
(user-wide, distributed by fleet-substrate), the driver was the 2026-09-29
incident where a workstation agent grepped the current on-disk SKILL.md but
mis-read it against its in-context copy from a pre-rename version, spending
turns chasing a mismatch that was purely stale-memory. For runbooks, the driver
was the 2026-09-19 canonical-deploy-command update: an identity edited the deploy
runbook to include a load-bearing `-f` flag, and a peer identity deployed with
the OLD command minutes later because the runbook edit fired no ambient event
and stale memory of the command outweighed re-reading the updated runbook. Every
fresh /id load STILL reads role + identity + id skill + enumerates runbooks;
this is purely additive.

Runbook coverage extends to the sentinel file only — `~/fleet/roles/<role>/runbooks/<slug>/runbook.md`
per the id skill's runbook convention. Companion files in the same subfolder
(checklists, prompt archives, scripts) are IGNORED — their churn is not a signal
that the canonical procedure changed. Three runbook events fire (same shape rule
as role/identity — see _emit_event):
  - `📝 [runbook: <role>/<slug>] your <slug> runbook changed — <diff>` (small edit, inline)
  - `📝 [runbook: <role>/<slug>] your <slug> runbook changed — READ NOW before continuing — <path>` (large edit, spilled)
  - `📝 [runbook: <role>/<slug>] added — Read <path>` — new runbook appeared
  - `📝 [runbook: <role>/<slug>] deleted`  — runbook.md OR its parent slug folder removed

The watch is diff-first and dumb on purpose: it fires the unified diff of what
changed (inline when small, spilled to a file pointer when large), and lets the AGENT
decide whether the change is its own echo, a peer's, or user's. See the design
rationale in:
  .planning/shapes/shape-role-file-watch.md (in the app's source repo)

Vendored into the app's substrate and distributed to every host running agent substrate
via the substrate distributor. Stdlib + inotifywait subprocess only.

Usage:  python3 role-file-watch.py <identity_dir>
Env:    ROLE_WATCH_POLL_SEC (default 2) — fallback polling loop granularity (only
        engaged when inotifywait is not on PATH).
"""

import datetime
import hashlib
import os
import re
import shutil
import signal
import subprocess
import sys
import time
import traceback

# spill threshold matches recv.sh:152 — INLINE_MAX=460 keeps the whole event line
# comfortably under the ~500-char harness cap (recv.sh:137)
INLINE_MAX = 460

# ⚠ Every event MUST leave this script as exactly ONE line. ambient-monitor reads child
# stdout line-by-line and injects each line as a SEPARATE wake, so an N-line payload
# becomes N wakes, each costing the agent a full turn. A single `task:` field edit
# produced ~10 wakes in the field (2026-09-14, first VM-born agent on T800) because a
# unified diff is inherently multi-line and went out through one print(). Byte-capping
# does not prevent this on its own — a small multi-line diff sits well under INLINE_MAX
# and still fans out. See _flatten_diff.
POLL = int(os.environ.get("ROLE_WATCH_POLL_SEC", "2"))

# Self-edit suppression — settle window before diffing. When the agent's own
# tool call touches a watched file, the PostToolUse hook
# (self-edit-baseline-sync.sh) atomically refreshes the baseline and writes a
# sha256 marker at `<baseline>.self-edit-hash`. This settle window gives the
# hook time to complete before the watcher does its comparison; the hash-guard
# in _is_self_edit then confirms the current content matches what the hook
# recorded. Env-override so operators can tune without redeploy.
# Shape rationale: .planning/shapes/shape-stop-self-edit-events.md.
SELF_EDIT_SETTLE_MS = int(os.environ.get("ROLE_WATCH_SELF_EDIT_SETTLE_MS", "200"))

# Self-edit claims — the settle window alone only covers tool calls that
# return within it, because the PostToolUse hook fires when the WHOLE call
# returns. A Bash call that edits a watched file and then keeps running
# (`sed -i … && git log …`, an edit followed by a build) outlived it and the
# agent's own edit emitted. The PreToolUse side of the same hook drops
# `<baseline_dir>/claims/<baseline-name>.<tool_use_id>` for each watched file
# the call names; while a live claim exists on a CHANGED file we hold the
# comparison until the hook releases it (after syncing), then run the normal
# settle + hash-guard. Claims older than CLAIM_MAX_SEC are ignored — covers a
# call interrupted before any Post* hook could release it. 600s = the
# harness's max foreground Bash timeout.
CLAIM_MAX_SEC = int(os.environ.get("ROLE_WATCH_CLAIM_MAX_SEC", "600"))
CLAIM_POLL_SEC = 0.1

# Module-level inotifywait subprocess handle so signal handlers can clean it up.
_inotify_proc = None


# Role slug validation — mirrors ~fleet convention: lowercase kebab, must start
# with a letter, ≤64 chars. Applied per-item after parsing so a malformed entry
# in an otherwise valid list gets dropped rather than tainting the whole watch.
_ROLE_SLUG_RE = re.compile(r"^[a-z][a-z0-9-]{0,63}$")


def _parse_roles_from_frontmatter(identity_file_path):
    """Parse the `role:` (or `roles:`) key from YAML frontmatter into a list.

    Agents edit these files freely and don't always stick to one YAML shape,
    so this parser is deliberately tolerant. Accepts (all yield the same list):

      role: box-maintainer                     → ["box-maintainer"]
      role: "box-maintainer"                   → ["box-maintainer"]
      role: [foo, bar]                         → ["foo", "bar"]
      role: ["foo", "bar"]                     → ["foo", "bar"]
      role:                                    → ["foo", "bar"]
        - foo
        - bar
      role: foo, bar                           → ["foo", "bar"]   (bare comma-separated)
      roles: <any of the above>                → same              (plural alias)

    Each parsed name is slug-validated (`_ROLE_SLUG_RE`); invalid entries are
    dropped silently. Returns (list_of_slugs, None) on success, (None, err_msg)
    when no valid slug survives. The list preserves source order and de-duplicates.

    Frontmatter is the block between the FIRST two `---` lines.
    """
    try:
        with open(identity_file_path) as f:
            lines = f.readlines()
    except FileNotFoundError:
        return None, "identity file not found: %s" % identity_file_path
    except OSError as e:
        return None, "could not read identity file %s: %s" % (identity_file_path, e)

    # Find the two '---' fence lines.
    fence_indices = [i for i, ln in enumerate(lines) if ln.strip() == "---"]
    if len(fence_indices) < 2:
        return None, "no YAML frontmatter block found in %s" % identity_file_path
    start, end = fence_indices[0] + 1, fence_indices[1]

    # Locate the role: (or roles:) line and capture its inline value.
    key_line_idx = None
    inline_value = ""
    for i in range(start, end):
        m = re.match(r"^(role|roles):\s*(.*?)\s*(#.*)?$", lines[i].rstrip("\n"))
        if m:
            key_line_idx = i
            inline_value = m.group(2) or ""
            break
    if key_line_idx is None:
        return None, "no `role:` or `roles:` key found in frontmatter of %s" % identity_file_path

    raw_names = []
    if inline_value:
        v = inline_value.strip()
        # Strip surrounding brackets if flow-sequence shape.
        if v.startswith("[") and v.endswith("]"):
            v = v[1:-1].strip()
        # Split on commas; each part may be quoted.
        parts = v.split(",") if "," in v else [v]
        for part in parts:
            item = part.strip().strip('"').strip("'").strip()
            if item:
                raw_names.append(item)
    else:
        # Block sequence: subsequent lines starting with `- <value>` inside frontmatter.
        for j in range(key_line_idx + 1, end):
            stripped = lines[j].rstrip("\n").lstrip()
            if not stripped or stripped.startswith("#"):
                continue
            m2 = re.match(r"^-\s+(.+?)\s*(#.*)?$", stripped)
            if not m2:
                break  # end of block sequence
            item = m2.group(1).strip().strip('"').strip("'").strip()
            if item:
                raw_names.append(item)

    valid = []
    seen = set()
    for name in raw_names:
        if _ROLE_SLUG_RE.match(name) and name not in seen:
            valid.append(name)
            seen.add(name)

    if not valid:
        return None, "no valid role slug found in frontmatter of %s (raw: %r)" % (
            identity_file_path, raw_names,
        )
    return valid, None


def _single_instance(state_dir, ident_dir):
    """Newest-wins guard: kill any prior role-file-watch for THIS identity, claim the pidfile."""
    pf = os.path.join(state_dir, "role-file-watch.pid")
    try:
        old = int(open(pf).read().strip())
        if old != os.getpid():
            try:
                cmd = open("/proc/%d/cmdline" % old).read()
            except Exception:
                cmd = os.popen("ps -p %d -o command= 2>/dev/null" % old).read()
            if "role-file-watch" in cmd and ident_dir in cmd:
                os.kill(old, 15)
    except Exception:
        pass
    open(pf, "w").write(str(os.getpid()))


def _read_bytes(path):
    """Read file bytes, return None on any error."""
    try:
        with open(path, "rb") as f:
            return f.read()
    except OSError:
        return None


def _atomic_write_baseline(baseline_dir, last_snapshot_path, data):
    """Atomically write `data` bytes to last_snapshot_path via a temp file."""
    tmp_path = os.path.join(baseline_dir, "last-snapshot.tmp")
    with open(tmp_path, "wb") as f:
        f.write(data)
    os.replace(tmp_path, last_snapshot_path)


def _run_diff(baseline_path, role_file_path):
    """Run unified diff between baseline and current role file. Returns stdout str.
    diff exits 1 when files differ — that is the normal/expected case; capture anyway.

    --label flags replace the file paths in the `---`/`+++` header lines so the event
    doesn't leak the internal snapshot path (~150-250 chars of noise per event) into
    every wake. The agent only cares that the two sides are baseline vs current.
    """
    result = subprocess.run(
        [
            "diff", "-u",
            "--label", "baseline",
            "--label", "current",
            str(baseline_path),
            str(role_file_path),
        ],
        capture_output=True,
        text=True,
    )
    return result.stdout


def _flatten_diff(diff_stdout):
    """Collapse a unified diff into ONE line suitable for a single wake.

    Drops the `---` / `+++` / `@@` header lines (no value to the agent — the file and
    identity are already named in the event tag) and joins the remaining content lines
    with a visible separator so the +/- structure survives the flattening.

    Returns "(no textual change)" for an empty/whitespace-only diff rather than an
    empty string, so the emitted event is never a bare tag with nothing after it.
    """
    kept = []
    for raw in diff_stdout.splitlines():
        if raw.startswith(("---", "+++", "@@")):
            continue
        stripped = raw.rstrip()
        if not stripped:
            continue
        kept.append(stripped)
    if not kept:
        return "(no textual change)"
    return " ⏎ ".join(kept)


def _change_phrase(kind, label):
    """Return the natural-language "your X changed" phrase for each event kind.

    Makes the CHANGE the explicit subject of the event line, rather than leaving
    the agent to infer it from the tag + path — an inference some agents defer
    ("I'll read that after I finish what I'm doing") when the change might bear
    directly on what they're currently doing.

    For runbook, `label` is `<role>/<slug>` — we surface just the slug in the
    sentence since the tag already carries both.
    """
    if kind == "role-file":
        return "your role file"
    if kind == "identity-file":
        return "your identity file"
    if kind == "id-skill":
        return "your id skill"
    if kind == "user-claudemd":
        return "your user-wide CLAUDE.md"
    if kind == "runbook":
        slug = label.split("/", 1)[-1]
        return "your %s runbook" % slug
    return "the file"  # defensive; kinds are closed-set today


def _emit_event(kind, label, diff_stdout, spill_dir):
    """Emit one event line (or spill to file if over INLINE_MAX).

    `kind` is "role-file", "identity-file", or "runbook"; `label` is the role name,
    identity name, or `<role>/<slug>` respectively — the two together form the event
    tag the agent sees.

    Both shapes lead with "your X changed" so the agent doesn't have to infer the
    change from the tag/path alone.

    INLINE_MAX is a BYTE cap (the harness measures the emitted line in UTF-8 bytes),
    so we check `len(line.encode("utf-8"))` — not `len(line)`, which counts code points.
    Role/identity files routinely contain multi-byte chars (curly quotes, em-dashes,
    emoji in directives); a line at len==460 code points can be well over 460 bytes
    and get truncated by the harness — exactly the failure mode the spill exists to
    prevent.

    A unified diff is ALWAYS multi-line, so we cannot simply spill on line count —
    that would spill every event and force a file Read for even a one-word change,
    losing the whole point of inlining. Instead we FLATTEN the diff to a single line
    (newlines → ' ⏎ ') and inline it when the flattened form fits the byte budget.
    Only a genuinely large diff spills.

    Flattening also drops the `---`/`+++`/`@@` header lines: they carry no information
    the agent wants (the labels are already in the event tag, and hunk offsets are
    meaningless for a file it can just read) and they are most of the line budget on
    a small change.

    On spill we deliberately DO NOT include a preview snippet: if the diff was too
    big to inline, the agent has to Read the spill file anyway, so a truncated
    preview only clutters the line without informing the decision to read.
    """
    flat = _flatten_diff(diff_stdout)
    phrase = _change_phrase(kind, label)
    line = "📝 [%s: %s] %s changed — %s" % (kind, label, phrase, flat)
    if len(line.encode("utf-8")) <= INLINE_MAX:
        print(line, flush=True)
    else:
        # Spill: create spill_dir lazily, write full diff, emit pointer-only line.
        # Spill filenames include the kind so role + identity spills at the same
        # timestamp don't collide.
        os.makedirs(spill_dir, exist_ok=True)
        ts = datetime.datetime.utcnow().strftime("%Y-%m-%dT%H-%M-%SZ")
        spill_path = os.path.join(spill_dir, "%s.%s.diff" % (ts, kind))
        with open(spill_path, "w") as f:
            f.write(diff_stdout)
        print(
            "📝 [%s: %s] %s changed — READ NOW before continuing — %s"
            % (kind, label, phrase, spill_path),
            flush=True,
        )


def _is_self_edit(baseline_path, current_bytes):
    """Hash-guard for self-edit suppression. Returns True iff the sync hook
    (self-edit-baseline-sync.sh) recently recorded a fingerprint at
    <baseline_path>.self-edit-hash AND that fingerprint matches sha256 of the
    current file content — i.e. the agent's own tool call is what produced
    the change we're now looking at, AND nothing has changed since.

    Consumes the marker unconditionally (whether match or mismatch). Stale
    markers cannot linger and silently suppress a later peer edit.

    Rationale (why hash-guard, not just "marker exists"): the race we care
    about is `me edit → peer edit → my sync hook fires`. In that path, my
    sync hook would sync baseline to CURRENT content (which now includes
    peer's edit) and record a hash of that. The watcher's later comparison
    would find baseline==current, emit nothing, and the peer's edit would
    be silently absorbed. By comparing sha256(current) against what the
    hook actually observed at hook-time, we detect the "content changed
    again after hook ran" case and fall back to normal diff+emit. See
    .planning/shapes/shape-stop-self-edit-events.md § "peer edit during
    settle window".
    """
    marker_path = baseline_path + ".self-edit-hash"
    try:
        with open(marker_path) as f:
            recorded = f.read().strip()
    except OSError:
        return False
    matched = False
    if current_bytes is not None and recorded:
        current_hash = hashlib.sha256(current_bytes).hexdigest()
        matched = (recorded == current_hash)
    # Consume marker regardless — stale entries must not survive to affect
    # future events.
    try:
        os.remove(marker_path)
    except OSError:
        pass
    return matched


def _live_claims(baseline_path):
    """Claim files on this baseline younger than CLAIM_MAX_SEC (see
    CLAIM_MAX_SEC). Any OSError → treated as no claim (fail toward emitting)."""
    claim_dir = os.path.join(os.path.dirname(baseline_path), "claims")
    prefix = os.path.basename(baseline_path) + "."
    live = []
    try:
        names = os.listdir(claim_dir)
    except OSError:
        return live
    now = time.time()
    for name in names:
        if not name.startswith(prefix):
            continue
        try:
            if now - os.path.getmtime(os.path.join(claim_dir, name)) < CLAIM_MAX_SEC:
                live.append(name)
        except OSError:
            pass
    return live


def _wait_for_claim_release(target_path, baseline_path):
    """If the target has drifted from its baseline AND the agent's in-flight
    tool call has claimed it, block until the claim is released or goes stale.

    Only drifted files wait, so an event on one target never holds another
    target that merely got claimed by a call that hasn't written it yet. The
    loop is single-threaded, so other events queue behind the hold — they
    are delayed, never dropped."""
    current = _read_bytes(target_path)
    if current is None or current == _read_bytes(baseline_path):
        return
    claims = _live_claims(baseline_path)
    if not claims:
        return
    started = time.time()
    while claims:
        time.sleep(CLAIM_POLL_SEC)
        claims = _live_claims(baseline_path)
    print(
        "[role-file-watch] held %s %.1fs for in-flight tool call claim"
        % (os.path.basename(baseline_path), time.time() - started),
        file=sys.stderr,
        flush=True,
    )


def _diff_and_emit(kind, label, target_path, baseline_dir, baseline_path, spill_dir):
    """Compare current target file against its baseline; if different, emit event
    and update baseline. Returns True if target file is gone (caller should exit).

    Self-edit suppression: sleeps SELF_EDIT_SETTLE_MS before comparison so the
    PostToolUse sync hook has time to refresh the baseline and drop its
    hash marker. Then _is_self_edit checks whether the current content matches
    what the hook recorded — if yes, silent baseline refresh, no emit; if no
    (marker absent, or content changed since hook ran), fall through to normal
    diff + emit. A changed file claimed by an in-flight tool call is held
    first (see _wait_for_claim_release)."""
    _wait_for_claim_release(target_path, baseline_path)
    if SELF_EDIT_SETTLE_MS > 0:
        time.sleep(SELF_EDIT_SETTLE_MS / 1000.0)

    current = _read_bytes(target_path)
    if current is None:
        print(
            "⚠️ [role-file-watch] %s file disappeared: %s" % (kind, target_path),
            file=sys.stderr,
            flush=True,
        )
        return True  # signal caller to exit

    baseline = _read_bytes(baseline_path)

    # Consume any self-edit marker eagerly — stale markers must NOT linger
    # across events, or a stale hash from a prior tool call could silently
    # suppress an unrelated future peer edit whose content happens to match.
    is_self_edit = _is_self_edit(baseline_path, current)

    if baseline is None:
        # Baseline missing mid-run (unusual) — re-snapshot silently.
        _atomic_write_baseline(baseline_dir, baseline_path, current)
        return False

    if current != baseline:
        if is_self_edit:
            # Agent's own edit — refresh baseline silently, no wake.
            _atomic_write_baseline(baseline_dir, baseline_path, current)
            return False
        diff_stdout = _run_diff(baseline_path, target_path)
        _emit_event(kind, label, diff_stdout, spill_dir)
        _atomic_write_baseline(baseline_dir, baseline_path, current)

    return False


def _diff_and_emit_all(targets, baseline_dir, spill_dir):
    """Run _diff_and_emit for every target. Returns True if ANY target is gone."""
    for kind, label, target_path, baseline_path in targets:
        gone = _diff_and_emit(kind, label, target_path, baseline_dir, baseline_path, spill_dir)
        if gone:
            return True
    return False


# ---------------------------------------------------------------------------
# Runbook helpers (added 2026-09-19 alongside runbook coverage).
# ---------------------------------------------------------------------------

# Slug regex — kebab-case per the id skill's slug rule (shared with bounties +
# apps). Applied when reading subfolder names off disk to reject anything that
# would traverse or otherwise not correspond to a legitimate runbook slug (a
# subfolder named "..", spaces, or garbage). Defence in depth on top of "the
# folder exists and contains a runbook.md" — we simply skip anything the regex
# rejects, matching the sweep script's slug-injection defence.
_RUNBOOK_SLUG_RE = re.compile(r"^[a-z][a-z0-9-]*$")
_RUNBOOK_SLUG_MAX_LEN = 64  # generous vs 40-char app cap; runbook names skew descriptive


def _enumerate_runbook_slugs(runbooks_dir):
    """Return sorted list of slugs whose `<slug>/runbook.md` exists on disk.

    Slugs failing `_RUNBOOK_SLUG_RE` or exceeding `_RUNBOOK_SLUG_MAX_LEN` are
    skipped silently — a peer identity might have half-created a folder or
    dropped something oddly-named. The watch is deliberately conservative:
    ambiguous state means don't-watch, not surface-an-error.
    """
    if not os.path.isdir(runbooks_dir):
        return []
    slugs = []
    try:
        entries = sorted(os.listdir(runbooks_dir))
    except OSError:
        return []
    for entry in entries:
        if not _RUNBOOK_SLUG_RE.match(entry):
            continue
        if len(entry) > _RUNBOOK_SLUG_MAX_LEN:
            continue
        rb_path = os.path.join(runbooks_dir, entry, "runbook.md")
        if not os.path.isfile(rb_path):
            continue
        slugs.append(entry)
    return slugs


def _runbook_paths(runbooks_dir, baseline_dir, role, slug):
    """Return the (runbook.md path, per-role/per-slug baseline path) tuple.

    Baselines are namespaced by role — `last-snapshot.runbook.<role>.<slug>` —
    so an identity holding roles A and B whose runbook slugs happen to collide
    (both have a `deploy` runbook, say) don't stomp each other's baselines.
    """
    rb_path = os.path.join(runbooks_dir, slug, "runbook.md")
    base_path = os.path.join(baseline_dir, "last-snapshot.runbook.%s.%s" % (role, slug))
    return rb_path, base_path


def _existing_baseline_slugs(baseline_dir, role):
    """Return the set of runbook slugs currently baselined for `role`.

    Reads `last-snapshot.runbook.<role>.<slug>` files. Used at startup to detect
    runbooks that were deleted while we were down (baselines with no matching
    on-disk runbook.md).
    """
    prefix = "last-snapshot.runbook.%s." % role
    slugs = set()
    try:
        for name in os.listdir(baseline_dir):
            if name.startswith(prefix):
                slugs.add(name[len(prefix):])
    except OSError:
        pass
    return slugs


def _emit_runbook_added(role, slug, rb_path):
    """New-runbook event — points at the file rather than emitting a diff.

    Runbooks are documents meant to be read in full; a diff-from-empty would
    be either large + spilled (equivalent to the pointer) or small and still
    not useful as a `+`-prefixed diff. Match the recv.sh long-message idiom
    of PATH-before-preview so the agent has an obvious next step.
    """
    print(
        "📝 [runbook: %s/%s] added — Read %s" % (role, slug, rb_path),
        flush=True,
    )


def _emit_runbook_deleted(role, slug):
    """Runbook-deleted event — no diff possible, one honest line."""
    print("📝 [runbook: %s/%s] deleted" % (role, slug), flush=True)


def _slug_from_event(w_path, f_name, runbook_roles):
    """Given an inotify event's `%w` (watched dir) and `%f` (filename), return
    (role, slug) for the runbook involved, or (None, None) if the event is not
    on a runbook.md / slug-subfolder we care about.

    `runbook_roles` is a list of `(role, runbooks_dir)` — one per role the
    identity holds. Event routing walks the list and returns as soon as a
    match is found, so an event fired inside role A's runbooks tree is
    attributed to role A (never confused with role B).

    Two shapes we want to match, per role:
      1. `%w = runbooks_dir/<slug>`, `%f = runbook.md`  → returns (role, <slug>)
         (the sentinel file itself changed / was created / deleted)
      2. `%w = runbooks_dir`, `%f = <slug>` with ISDIR event
         → returns (role, <slug>) (the whole slug subfolder was created or removed)
    Everything else — companion files inside a slug folder, nested subdirs,
    events on unrelated paths — returns (None, None).
    """
    # Normalize trailing slash (inotifywait sometimes emits with trailing slash
    # on %w for -r-watched dirs).
    w_norm = w_path.rstrip("/")

    for role, runbooks_dir in runbook_roles:
        rb_root = runbooks_dir.rstrip("/")

        # Shape 1: event on <runbooks>/<slug>/runbook.md
        if f_name == "runbook.md":
            parent = os.path.dirname(w_norm)
            if parent == rb_root:
                slug = os.path.basename(w_norm)
                if _RUNBOOK_SLUG_RE.match(slug) and len(slug) <= _RUNBOOK_SLUG_MAX_LEN:
                    return role, slug
        # Shape 2: event on <runbooks>/<slug> directly (create/delete of folder)
        if w_norm == rb_root and f_name:
            if _RUNBOOK_SLUG_RE.match(f_name) and len(f_name) <= _RUNBOOK_SLUG_MAX_LEN:
                return role, f_name
    return None, None


def _handle_runbook_event(
    role, slug, events, tracked_slugs, runbooks_dir, baseline_dir, spill_dir,
):
    """Route a runbook event to add / edit / delete emission.

    `tracked_slugs` is a mutable set — the set of runbook slugs whose baseline
    exists in the state directory. This function mutates it in place:
      - Add: slug goes from untracked → tracked; write baseline, emit "added".
      - Edit: slug already tracked; diff baseline vs current, emit if changed.
      - Delete: slug goes from tracked → untracked; remove baseline, emit "deleted".

    Events we care about (uppercased set, matching inotifywait --format %e output):
      - CLOSE_WRITE / MODIFY / MOVED_TO on a runbook.md → edit or add depending
        on whether the slug was already tracked.
      - CREATE on a runbook.md (or MOVED_TO landing runbook.md into the folder)
        → same handling; the CLOSE_WRITE case covers the write-then-close path.
      - DELETE / MOVED_FROM on a runbook.md or on the slug subfolder → delete.
    """
    rb_path, base_path = _runbook_paths(runbooks_dir, baseline_dir, role, slug)

    is_delete = bool(events & {"DELETE", "MOVED_FROM"})
    is_write = bool(events & {"CLOSE_WRITE", "CREATE", "MOVED_TO", "MODIFY"})

    if is_delete:
        # Confirm on disk — inotifywait can fire DELETE on transient files that
        # were briefly present (editor swap files). If runbook.md is still
        # readable, treat as no-op.
        if os.path.isfile(rb_path):
            return
        if slug in tracked_slugs:
            try:
                os.remove(base_path)
            except OSError:
                pass
            tracked_slugs.discard(slug)
            _emit_runbook_deleted(role, slug)
        return

    if is_write:
        # Settle window: give the PostToolUse sync hook time to refresh the
        # baseline + drop its hash marker before we compare (matches
        # _diff_and_emit's settle for role/identity events), after holding
        # for any in-flight tool call that claimed this runbook.
        if slug in tracked_slugs:
            _wait_for_claim_release(rb_path, base_path)
        if SELF_EDIT_SETTLE_MS > 0:
            time.sleep(SELF_EDIT_SETTLE_MS / 1000.0)
        current = _read_bytes(rb_path)
        if current is None:
            # File vanished between event fire and our read — likely an editor
            # swap-file interaction. Skip silently; a real delete will fire
            # its own event.
            return
        baseline = _read_bytes(base_path) if slug in tracked_slugs else None
        # Consume any self-edit marker eagerly (see _is_self_edit).
        is_self_edit = _is_self_edit(base_path, current)
        if baseline is None:
            # New runbook (either we've never seen it, or the baseline was
            # cleaned up). Snapshot; emit "added" unless the sync hook
            # confirmed this is the agent's own creation.
            _atomic_write_baseline(baseline_dir, base_path, current)
            tracked_slugs.add(slug)
            if not is_self_edit:
                _emit_runbook_added(role, slug, rb_path)
            return
        if current != baseline:
            if is_self_edit:
                # Agent's own edit — refresh baseline silently, no wake.
                _atomic_write_baseline(baseline_dir, base_path, current)
                return
            diff_stdout = _run_diff(base_path, rb_path)
            _emit_event("runbook", "%s/%s" % (role, slug), diff_stdout, spill_dir)
            _atomic_write_baseline(baseline_dir, base_path, current)


def _make_signal_handler():
    """Return a SIGTERM/SIGINT handler that cleans up the inotifywait subprocess."""
    def _handler(signum, frame):
        global _inotify_proc
        if _inotify_proc is not None:
            try:
                _inotify_proc.terminate()
            except Exception:
                pass
        sys.exit(0)
    return _handler


def main():
    if len(sys.argv) < 2:
        print("usage: python3 role-file-watch.py <identity_dir>", file=sys.stderr)
        sys.exit(2)

    ident_dir = os.path.abspath(os.path.expanduser(sys.argv[1]))
    name = os.path.basename(ident_dir)

    # --- Resolve role name(s) from identity frontmatter ---
    identity_file_path = os.path.join(ident_dir, "%s.md" % name)
    roles, err = _parse_roles_from_frontmatter(identity_file_path)
    if err:
        # Watcher-health failures log to stderr only — box-maintainer notices via
        # the ambient-monitor log. The agent can't fix its own dead watcher
        # mid-turn, so waking it with a diagnostic it can't act on is noise.
        print("⚠️ [role-file-watch] %s" % err, file=sys.stderr, flush=True)
        sys.exit(1)

    # --- Resolve role file paths — one per role. Missing role files are logged
    # to stderr and skipped rather than fatal, so a typo in a multi-role list
    # doesn't kill the whole watcher (the other role's file still gets watched).
    role_files = []  # list of (role, role_file_path)
    for role in roles:
        role_file_path = os.path.expanduser("~/fleet/roles/%s/%s.md" % (role, role))
        if os.path.exists(role_file_path):
            role_files.append((role, role_file_path))
        else:
            print(
                "⚠️ [role-file-watch] role file not found for role '%s' (%s) — skipping"
                % (role, role_file_path),
                file=sys.stderr,
                flush=True,
            )
    if not role_files:
        print(
            "⚠️ [role-file-watch] no watchable role files for identity %s (roles=%r)"
            % (name, roles),
            file=sys.stderr,
            flush=True,
        )
        sys.exit(1)
    # Primary role: first in the list. Used for legacy baseline migration
    # (single-role installs get their old `last-snapshot.role` promoted onto
    # the first role in the new multi-role list).
    primary_role = role_files[0][0]

    # Identity file path already resolved above (identity_file_path).
    # Each target: (kind, label-for-emit, source-file, per-file-baseline).
    # Role baselines are per-role: `last-snapshot.role.<role>`.
    baseline_dir = os.path.join(ident_dir, "role-file-watch")
    identity_baseline_path = os.path.join(baseline_dir, "last-snapshot.identity")
    targets = []
    for role, role_file_path in role_files:
        role_baseline_path = os.path.join(baseline_dir, "last-snapshot.role.%s" % role)
        targets.append(("role-file", role, role_file_path, role_baseline_path))
    targets.append(
        ("identity-file", name, identity_file_path, identity_baseline_path)
    )

    # --- id skill target — user-wide, fleet-substrate-distributed. Watching
    # `~/.claude/skills/id/SKILL.md` catches the mid-session "in-context copy
    # drifted from disk" gap (2026-09-29 incident: workstation agent grepped
    # current on-disk file while running against pre-rename in-context copy).
    # Gated on file existence so a fresh box mid-distributor-install, or a
    # hermetic test env, doesn't fatal — same posture as runbooks_watched.
    # If the file lands later, the next watcher process pick it up on cold-start.
    id_skill_path = os.path.expanduser("~/.claude/skills/id/SKILL.md")
    id_skill_watched = os.path.isfile(id_skill_path)
    if id_skill_watched:
        id_skill_baseline_path = os.path.join(baseline_dir, "last-snapshot.id-skill")
        targets.append(("id-skill", "id", id_skill_path, id_skill_baseline_path))

    # --- user-wide CLAUDE.md target — the user's own always-on instruction file,
    # authored by the user (typically via the app's Gear → About you panel).
    # Loads at the start of every Claude session, so a mid-session edit means
    # every running identity's in-context copy has diverged from disk. Same
    # existence-gate as the id skill: on a fresh box where the user hasn't
    # authored one yet, this target is quietly skipped; if the file appears
    # later, the next watcher process picks it up on cold-start.
    user_claudemd_path = os.path.expanduser("~/.claude/CLAUDE.md")
    if os.path.isfile(user_claudemd_path):
        user_claudemd_baseline_path = os.path.join(
            baseline_dir, "last-snapshot.user-claudemd"
        )
        targets.append(
            ("user-claudemd", "user", user_claudemd_path, user_claudemd_baseline_path)
        )

    # --- Runbooks trees — role-scope; one dir per role. Empty or nonexistent
    # is fine (skipped). `runbook_roles` is the ordered list of (role, dir) that
    # actually exist on disk; `runbooks_watched` is true iff at least one does.
    runbook_roles = []
    for role, _ in role_files:
        rd = os.path.expanduser("~/fleet/roles/%s/runbooks" % role)
        if os.path.isdir(rd):
            runbook_roles.append((role, rd))
    runbooks_watched = len(runbook_roles) > 0

    # --- State dirs ---
    spill_dir = os.path.join(baseline_dir, "spilled")
    state_dir = os.path.join(baseline_dir, ".state")
    os.makedirs(state_dir, exist_ok=True)
    # `baseline_dir` may not exist yet on very first run (before role/identity
    # cold-start writes any baseline). Ensure it exists so runbook baselines
    # can be written even if the role/identity ones haven't landed yet.
    os.makedirs(baseline_dir, exist_ok=True)

    # --- Legacy baseline migrations — chained.
    # (1) Oldest: `last-snapshot` → `last-snapshot.role` (single-target → two-target scheme).
    # (2) Pre-multi-role: `last-snapshot.role` → `last-snapshot.role.<primary>`
    #     (single-role → per-role scheme). Promotes onto the primary role so
    #     existing single-role identities keep continuity.
    # (3) Runbook baselines: `last-snapshot.runbook.<slug>` (unprefixed, old
    #     single-role scheme) → `last-snapshot.runbook.<primary>.<slug>`. Old
    #     scheme has zero dots in the suffix; new scheme has one (role.slug),
    #     so we discriminate by checking for `.` in the suffix.
    # All migrations are best-effort — a failure logs to stderr and falls
    # through to cold-start (one silent snapshot instead of continuity).
    legacy_bare_baseline = os.path.join(baseline_dir, "last-snapshot")
    legacy_role_baseline = os.path.join(baseline_dir, "last-snapshot.role")
    primary_role_baseline = os.path.join(
        baseline_dir, "last-snapshot.role.%s" % primary_role
    )
    if os.path.exists(legacy_bare_baseline) and not os.path.exists(legacy_role_baseline):
        try:
            os.replace(legacy_bare_baseline, legacy_role_baseline)
        except OSError as e:
            print(
                "⚠️ [role-file-watch] legacy baseline migration (bare→role) failed: %s" % e,
                file=sys.stderr,
                flush=True,
            )
    if os.path.exists(legacy_role_baseline) and not os.path.exists(primary_role_baseline):
        try:
            os.replace(legacy_role_baseline, primary_role_baseline)
        except OSError as e:
            print(
                "⚠️ [role-file-watch] legacy baseline migration (role→role.<primary>) failed: %s"
                % e,
                file=sys.stderr,
                flush=True,
            )
    # Runbook baseline migration (old unprefixed slug → new role-namespaced).
    old_runbook_prefix = "last-snapshot.runbook."
    new_runbook_prefix = "last-snapshot.runbook.%s." % primary_role
    try:
        for entry in os.listdir(baseline_dir):
            if not entry.startswith(old_runbook_prefix):
                continue
            suffix = entry[len(old_runbook_prefix):]
            if "." in suffix:
                continue  # already role-namespaced (new scheme)
            new_entry = new_runbook_prefix + suffix
            src = os.path.join(baseline_dir, entry)
            dst = os.path.join(baseline_dir, new_entry)
            if os.path.exists(dst):
                continue  # don't clobber a new-scheme baseline
            try:
                os.replace(src, dst)
            except OSError as e:
                print(
                    "⚠️ [role-file-watch] runbook baseline migration failed for %s: %s"
                    % (entry, e),
                    file=sys.stderr,
                    flush=True,
                )
    except OSError:
        pass

    # --- Single-instance guard ---
    _single_instance(state_dir, ident_dir)

    # --- Signal handlers (register early) ---
    handler = _make_signal_handler()
    signal.signal(signal.SIGTERM, handler)
    signal.signal(signal.SIGINT, handler)

    # --- Orphan-monitor guard (added 2026-09-05 after Noelle ate a Nelly dispatch;
    # env-override added 2026-09-13 for the ambient-monitor launcher).
    # See wakeup-scheduler.py for the full comment; short version:
    #   1) if AMBIENT_MONITOR_HARNESS_PID is set (parent is the launcher), honor it.
    #   2) else fall back to the grandparent walk (standalone launch case).
    harness_pid = None
    env_override = os.environ.get("AMBIENT_MONITOR_HARNESS_PID")
    if env_override:
        try:
            p = int(env_override)
            if p > 1:
                harness_pid = p
        except ValueError:
            pass
    if harness_pid is None:
        try:
            with open("/proc/%d/status" % os.getppid()) as f:
                for line in f:
                    if line.startswith("PPid:"):
                        p = int(line.split()[1])
                        if p > 1:
                            harness_pid = p
                        break
        except (OSError, ValueError):
            pass
    if harness_pid is None:
        print(
            "role-file-watch: orphan-check disabled (couldn't resolve grandparent)",
            file=sys.stderr,
            flush=True,
        )

    # --- Cold-start rule: for each target, if no baseline, snapshot silently.
    # Otherwise diff at startup and emit if the file changed while we were down.
    # Cold start remains silent per shape invariant. This runs per-target
    # independently so a legacy install (role baseline exists, identity does not) does
    # the right thing: the role gets a startup diff, the identity gets a silent cold
    # snapshot.
    for kind, label, target_path, baseline_path in targets:
        if not os.path.exists(baseline_path):
            current = _read_bytes(target_path)
            if current is None:
                msg = "%s file unreadable at startup: %s" % (kind, target_path)
                print("⚠️ [role-file-watch] %s" % msg, file=sys.stderr, flush=True)
                sys.exit(1)
            _atomic_write_baseline(baseline_dir, baseline_path, current)
            # Emit NOTHING to stdout on cold start (shape file "silent on cold start" invariant)
        else:
            gone = _diff_and_emit(kind, label, target_path, baseline_dir, baseline_path, spill_dir)
            if gone:
                sys.exit(1)

    # --- Runbook cold-start / resume pass — per-role.
    # For each role, enumerate on-disk runbooks. For each: if no baseline →
    # snapshot silently (cold start); if baseline + file changed → emit edit
    # diff (resume); if baseline exists but file gone → emit "deleted"
    # (resume-delete). Runs BEFORE the inotifywait watch loop starts so events
    # landing during the watch's arming don't compete with cold-start baseline
    # writes. `tracked_runbook_slugs` is keyed by role so runbook slugs
    # colliding across roles don't share a set.
    tracked_runbook_slugs = {}
    for role, rb_dir in runbook_roles:
        tracked_runbook_slugs[role] = _existing_baseline_slugs(baseline_dir, role)
        on_disk_slugs = set(_enumerate_runbook_slugs(rb_dir))

        # (a) On-disk runbooks — diff or cold-snapshot.
        for slug in sorted(on_disk_slugs):
            rb_path, base_path = _runbook_paths(rb_dir, baseline_dir, role, slug)
            if slug not in tracked_runbook_slugs[role]:
                current = _read_bytes(rb_path)
                if current is None:
                    # Runbook file vanished between listdir and read — race
                    # with a peer identity's delete. Skip silently; the
                    # delete-side pass below cleans up any dangling baseline.
                    continue
                _atomic_write_baseline(baseline_dir, base_path, current)
                tracked_runbook_slugs[role].add(slug)
                # Silent cold-start — no emit (shape invariant).
            else:
                # Baseline exists → treat as resume. Diff if changed.
                current = _read_bytes(rb_path)
                if current is None:
                    continue  # will be handled by (b) below
                baseline = _read_bytes(base_path)
                # Consume any self-edit marker eagerly — even at cold-start, a
                # marker left over from a pre-restart sync-hook run tells us the
                # last change was ours.
                is_self_edit = _is_self_edit(base_path, current)
                if baseline is None:
                    _atomic_write_baseline(baseline_dir, base_path, current)
                    continue
                if current != baseline:
                    if is_self_edit:
                        _atomic_write_baseline(baseline_dir, base_path, current)
                        continue
                    diff_stdout = _run_diff(base_path, rb_path)
                    _emit_event(
                        "runbook", "%s/%s" % (role, slug), diff_stdout, spill_dir,
                    )
                    _atomic_write_baseline(baseline_dir, base_path, current)

        # (b) Baselines for slugs no longer on disk — the runbook was deleted
        # while we were down. Emit deletion + remove the baseline.
        for slug in sorted(tracked_runbook_slugs[role] - on_disk_slugs):
            _, base_path = _runbook_paths(rb_dir, baseline_dir, role, slug)
            try:
                os.remove(base_path)
            except OSError:
                pass
            tracked_runbook_slugs[role].discard(slug)
            _emit_runbook_deleted(role, slug)

    # --- Watch loop ---
    use_inotify = shutil.which("inotifywait") is not None
    if not use_inotify:
        print(
            "⚠️ [role-file-watch] inotifywait not found — falling back to %ds polling "
            "(set ROLE_WATCH_POLL_SEC to adjust)" % POLL,
            file=sys.stderr,
            flush=True,
        )

    global _inotify_proc

    if use_inotify:
        # inotifywait-based watch loop with `--format` output so we can route
        # events by path. Three watched surfaces:
        #   1. role.md + identity.md + id-skill SKILL.md — passed as explicit
        #      file arguments (id skill conditionally, when present on box).
        #      Events on any of these are dispatched to
        #      _diff_and_emit_all(targets, …); we re-diff every fixed target on
        #      any of their events (cheap, no per-file bookkeeping needed).
        #   2. runbooks/ (if it exists) — passed with `-r` so newly-created
        #      slug subfolders get their inotify watches added automatically.
        #      Per-event routing via _slug_from_event isolates runbook.md
        #      events + slug-subfolder create/delete from companion churn.
        #
        # Event set — union of what fixed targets and the runbook tree need:
        #   close_write: normal file save
        #   move_self:   fixed-target inode itself renamed away → respawn
        #   delete_self: fixed-target inode unlinked (backend atomic tmp+rename over
        #                the watched file unlinks the old inode; kernel fires
        #                DELETE_SELF on the OLD inode's watch, then IN_IGNORED
        #                auto-removes it). MOVE_SELF does NOT fire here — that's
        #                only for the watched inode being the SOURCE of a rename,
        #                whereas an atomic-rename-over makes it the DISPLACED
        #                target. Without delete_self + respawn, the watch dies
        #                silently and every subsequent edit is invisible.
        #   moved_to:    fixed-target replaced OR new file landed in runbooks/
        #   delete:      runbook.md removed OR slug subfolder removed
        #   create:      slug subfolder created OR runbook.md created
        #   moved_from:  runbook.md renamed out OR slug subfolder renamed out
        fixed_target_paths = [t[2] for t in targets]
        watched_args = list(fixed_target_paths)
        if runbooks_watched:
            for _role, rb_dir in runbook_roles:
                watched_args.append(rb_dir)
        inotify_events = "close_write,move_self,delete_self,moved_to,delete,create,moved_from"
        # Exponential backoff between failed inotifywait starts (reset on any
        # successful event). Guards against a hot fork/exec loop when e.g.
        # fs.inotify.max_user_instances is saturated — inotifywait dies
        # instantly, python sees EOF, and without a backoff we chew CPU
        # forever while silently deaf.
        inotify_backoff_sec = 0
        INOTIFY_BACKOFF_MIN = 1
        INOTIFY_BACKOFF_MAX = 60
        failure_emitted = False
        while True:
            # Orphan check
            if harness_pid is not None:
                try:
                    os.kill(harness_pid, 0)
                except OSError:
                    sys.exit(0)

            if inotify_backoff_sec > 0:
                time.sleep(inotify_backoff_sec)

            try:
                _inotify_proc = subprocess.Popen(
                    [
                        "inotifywait", "-m",
                    ] + (["-r"] if runbooks_watched else []) + [
                        "-e", inotify_events,
                        "--format", "%w|%f|%e",
                    ] + watched_args,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    text=True,
                )
                for event_line in _inotify_proc.stdout:
                    # Any event = healthy inotifywait. Reset backoff and emit
                    # a recovery event if the previous cycle surfaced a failure.
                    if failure_emitted:
                        print(
                            "⚠️ [role-file-watch] inotifywait recovered — watching resumed",
                            file=sys.stderr,
                            flush=True,
                        )
                        failure_emitted = False
                    inotify_backoff_sec = 0

                    # Orphan check inside inner loop
                    if harness_pid is not None:
                        try:
                            os.kill(harness_pid, 0)
                        except OSError:
                            if _inotify_proc is not None:
                                try:
                                    _inotify_proc.terminate()
                                except Exception:
                                    pass
                            sys.exit(0)

                    event_line = event_line.rstrip("\n").rstrip("\r")
                    if not event_line:
                        continue

                    # Parse `%w|%f|%e`. inotifywait guarantees these three
                    # fields separated by `|`; on rare malformed lines (e.g.
                    # rotated stderr leaking in), skip silently.
                    parts = event_line.split("|", 2)
                    if len(parts) != 3:
                        continue
                    w_path, f_name, e_str = parts
                    events = set(e_str.split(","))

                    # (A) Route fixed-target events (role.md / identity.md / id-skill SKILL.md).
                    # inotifywait emits `%w = <full file path>`, `%f = ""` when
                    # the watched target is a file argument (not a directory).
                    if not f_name and w_path in fixed_target_paths:
                        # MOVE_SELF: watched inode itself was renamed AWAY. New
                        # content may already be at the path (atomic-rename
                        # patterns overwriting the file), so emit any diff then
                        # respawn to re-arm on whatever inode now sits at the
                        # path.
                        #
                        # DELETE_SELF: watched inode was unlinked. Fires in two
                        # cases: (1) backend atomic tmp+rename over the file —
                        # a new inode is already at the path with new content;
                        # (2) genuine deletion (no replacement). If a file
                        # exists at the path shortly after the event, treat as
                        # case 1 (emit diff + respawn); otherwise treat as
                        # case 2 (fatal — the target is gone). This mirrors
                        # MOVE_SELF's respawn semantics: never silently deaf.
                        if "MOVE_SELF" in events or "DELETE_SELF" in events:
                            if _diff_and_emit_all(targets, baseline_dir, spill_dir):
                                # Target actually gone — fatal exit (same as
                                # pre-fix DELETE_SELF behavior). _diff_and_emit
                                # returns True when the file is unreadable.
                                sys.exit(1)
                            # Respawn to re-arm on new inode.
                            try:
                                _inotify_proc.terminate()
                            except Exception:
                                pass
                            _inotify_proc = None
                            break
                        if _diff_and_emit_all(targets, baseline_dir, spill_dir):
                            sys.exit(1)
                        continue

                    # (B) Route runbook-tree events. Only fires when we're
                    # actually watching at least one runbooks dir. `_slug_from_event`
                    # walks every role's runbooks tree and returns the (role, slug)
                    # match — event routing stays role-scoped even with multiple
                    # roles active.
                    if runbooks_watched:
                        rb_role, slug = _slug_from_event(w_path, f_name, runbook_roles)
                        if slug is not None:
                            rb_dir = next(d for r, d in runbook_roles if r == rb_role)
                            _handle_runbook_event(
                                rb_role, slug, events, tracked_runbook_slugs[rb_role],
                                rb_dir, baseline_dir, spill_dir,
                            )
                            continue

                    # Anything else is companion churn or events on an
                    # unrelated path — ignore.

                # for-loop exited: either _inotify_proc is None (controlled
                # respawn via MOVE_SELF/DELETE_SELF above) or inotifywait died
                # on its own (EOF on stdout). In the death case, capture exit
                # code + stderr so a saturated inotify limit surfaces to the
                # agent instead of hot-looping deaf.
                if _inotify_proc is not None:
                    try:
                        exit_code = _inotify_proc.wait(timeout=5)
                    except subprocess.TimeoutExpired:
                        try:
                            _inotify_proc.terminate()
                        except Exception:
                            pass
                        exit_code = -1
                    if exit_code != 0:
                        stderr_text = ""
                        try:
                            if _inotify_proc.stderr is not None:
                                stderr_text = _inotify_proc.stderr.read() or ""
                        except Exception:
                            pass
                        stderr_snippet = stderr_text.strip().replace("\n", " ⏎ ")[:200]
                        if not failure_emitted:
                            print(
                                "⚠️ [role-file-watch] inotifywait exited %d — "
                                "watcher deaf until this resolves. stderr: %s"
                                % (exit_code, stderr_snippet or "(empty)"),
                                file=sys.stderr,
                                flush=True,
                            )
                            failure_emitted = True
                        if inotify_backoff_sec == 0:
                            inotify_backoff_sec = INOTIFY_BACKOFF_MIN
                        else:
                            inotify_backoff_sec = min(
                                INOTIFY_BACKOFF_MAX, inotify_backoff_sec * 2
                            )

            except Exception:
                traceback.print_exc(file=sys.stderr)
                sys.exit(1)

    else:
        # Fallback: mtime polling loop over both targets.
        try:
            last_mtimes = {t[2]: os.path.getmtime(t[2]) for t in targets}
        except OSError as e:
            print(
                "⚠️ [role-file-watch] target unreadable in polling loop: %s" % e,
                file=sys.stderr,
                flush=True,
            )
            sys.exit(1)

        while True:
            # Orphan check
            if harness_pid is not None:
                try:
                    os.kill(harness_pid, 0)
                except OSError:
                    sys.exit(0)

            time.sleep(POLL)
            changed = False
            for kind, label, target_path, baseline_path in targets:
                try:
                    cur_mtime = os.path.getmtime(target_path)
                except OSError:
                    print(
                        "⚠️ [role-file-watch] %s file disappeared: %s"
                        % (kind, target_path),
                        file=sys.stderr,
                        flush=True,
                    )
                    sys.exit(1)
                if cur_mtime != last_mtimes[target_path]:
                    last_mtimes[target_path] = cur_mtime
                    changed = True

            if changed:
                if _diff_and_emit_all(targets, baseline_dir, spill_dir):
                    sys.exit(1)


if __name__ == "__main__":
    try:
        main()
    except Exception:
        traceback.print_exc(file=sys.stderr)
        sys.exit(1)
