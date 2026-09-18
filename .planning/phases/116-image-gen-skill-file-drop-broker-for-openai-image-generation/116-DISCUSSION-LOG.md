# Phase 116: image-gen-skill — Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-09-18
**Phase:** 116-image-gen-skill-file-drop-broker-for-openai-image-generation
**Areas discussed:** Wire protocol details, Skill invocation shape, PHI/compliance directive, Backend worker concurrency + rate limiting

---

## Wire protocol details

### Q1: Reference-image transport (image-to-image use case)
| Option | Description | Selected |
|--------|-------------|----------|
| Companion file next to request | Caller writes `<uuid>.ref.<ext>` alongside `<uuid>.json`; request JSON's `ref` field names it | ✓ |
| Base64 embedded in the request JSON | One file per request; ~40% payload bloat for ref image | |

**User's choice:** Companion file.
**Notes:** Symmetry with the response side (already JSON + companion PNG); no base64 encode/decode step.

### Q2: Multi-image response layout when caller sets `n>1`
| Option | Description | Selected |
|--------|-------------|----------|
| One success bundle, multiple image files | Single `<uuid>.success.json` with `images: [...]` array + N companion PNGs | ✓ |
| N independent success bundles | Separate `<uuid>.success.0.json` + `.success.0.png` pair per image | |

**User's choice:** One success bundle.
**Notes:** Matches "one request → one response event"; OpenAI's `n` param returns all N atomically anyway.

### Q3: Skill-side polling timeout window
| Option | Description | Selected |
|--------|-------------|----------|
| 3 minutes | Matches Phase 99 identity-birth | |
| 5 minutes | Extra headroom for image gen's longer worst case | ✓ |
| 10+ minutes | Very generous; caller blocks longer on real hangs | |

**User's choice:** 5 minutes.
**Notes:** Conditional on parallelized workers (see Area 4 Q1). Ashley: *"as long as we are parallelizing the image generation itself then i'm okay with five minutes."*

### Q4: Request folder path on the box
| Option | Description | Selected |
|--------|-------------|----------|
| `~/fleet/image-gen-requests/` | Mirrors `~/fleet/spawn-requests/` naming pattern | ✓ |
| `~/fleet/requests/image-gen/` | Nested under shared `requests/` root for future factoring | |
| `~/fleet/broker/image-gen/` | Same nested pattern with explicit "broker" name | |

**User's choice:** `~/fleet/image-gen-requests/`.
**Notes:** Matches Phase 99 naming convention exactly; factor the shared broker pattern later if a third instance emerges.

---

## Skill invocation shape

### Q1: How the agent actually fires the skill
| Option | Description | Selected |
|--------|-------------|----------|
| Bash recipe embedded in skill body | Every invocation regenerates ~30 lines of shell (uuidgen, write, poll, cleanup) | |
| Helper script shipped alongside skill | Skill body invokes `image-gen <args>`; helper handles plumbing | ✓ |
| Hybrid | Skill body has walk-through AND ships a helper | |

**User's choice:** Helper script.
**Notes:** File-drop-then-poll dance is too much for a repeated skill-body recipe; helper keeps call site one line and skill body focuses on caller-facing concerns.

### Q2: Argument shape at the call site
| Option | Description | Selected |
|--------|-------------|----------|
| Positional prompt + flags for the rest | `image-gen "cat" --size 1024x1024 --n 2` — CLI-familiar | |
| JSON on stdin | `echo '{...}' \| image-gen` — one channel, no shell quoting | |
| Both — positional + flags + `--json <file>` escape hatch | Best of both | ✓ |

**User's choice:** Positional + flags + `--json` escape hatch.
**Notes:** 90% of calls are `image-gen "prompt"` or with a size/n flag; escape hatch keeps door open for ref-image case without cluttering common path.

### Q3: Helper output on success
| Option | Description | Selected |
|--------|-------------|----------|
| Paths only (one per line) | Agent glues them into its message; no metadata | |
| Paths + small JSON footer | Machine-parseable + optional metadata | |
| Whole response JSON to stdout | Agent parses if it wants details | |
| Paths on stdout, full JSON on stderr | Clean happy-path parse + debugging fallback | ✓ |

**User's choice:** Paths on stdout, full JSON on stderr (this was the "my lean" that Ashley greenlit; the fourth option assembled during discussion).
**Notes:** Machine-parseable success (`exit 0` + N lines stdout); human-readable failure (non-zero exit + failure JSON on stderr).

### Q4: Default output location + wire-folder cleanup
| Option | Description | Selected |
|--------|-------------|----------|
| Leave in wire folder, print those paths | Simplest; mixes user output with wire scratch | |
| Move to dedicated output dir + clean up wire files | Wire folder tidy per-call; predictable spot | ✓ |
| Caller-required `--out`, no default | Forces explicit destination decision | |

**User's choice:** Move to `~/fleet/image-gen-outputs/`, overridable with `--out`; wire files cleaned up per call.
**Notes:** Ashley: *"let's make sure that the out put directory is in the fleet folder still if you think that's a good idea."* Under `~/fleet/` per the fleet rule against `/tmp` for anything worth surviving reboots.

---

## PHI/compliance directive

### Q1: Draft wording
| Option | Description | Selected |
|--------|-------------|----------|
| Original 5-paragraph draft | Full with examples, patient-name illustration, "if unsure" fallback | |
| Minimal 3-sentence version | "Your prompt leaves this deployment. MUST NOT include PHI... Paraphrase; if unsure, don't send." | ✓ |

**User's choice:** Minimal 3-sentence version.
**Notes:** Ashley: *"give me a version that is as minimal as possible."*

### Q2: Placement + prominence
| Option | Description | Selected |
|--------|-------------|----------|
| Very top of SKILL.md | First thing after frontmatter | (partial) |
| Above invocation syntax, below one-line "what this is" | Reader gets one sentence of context first | |
| Callout in the middle | Visual callout near invocation section | |
| Top + inline echo at invocation section | Redundancy at both ends per research | ✓ |

**User's choice:** Top + inline echo at invocation section, with `MUST NOT` phrasing.
**Notes:** Ashley asked for research on instruction ordering before deciding. Findings from spawned research subagent: Liu et al. 2024 "Lost in the Middle" + Guo et al. 2024 serial-position effects + 2025 hierarchical-safety-adherence benchmark + Anthropic's own skill-authoring guidance. Middle-of-file is measurably weakest; top + inline echo is best per combined evidence. `MUST NOT` phrasing per Anthropic's skill-authoring docs.

### Q3: `content_blocked` failure guidance in skill body
| Option | Description | Selected |
|--------|-------------|----------|
| Say nothing | Failure JSON is self-documenting | |
| One-liner in failure-handling section | "Rephrase and retry, or tell the user the request isn't something the provider will generate" | ✓ |
| Fuller guidance | Content classes that trip it, rephrasing patterns | |

**User's choice:** One-liner.
**Notes:** Enough for agent to know what action is called for without turning skill body into a rewrite of OpenAI's content-policy docs.

---

## Backend worker concurrency + rate limiting

### Q1: Worker pool concurrency N
| Option | Description | Selected |
|--------|-------------|----------|
| N=3 | Conservative; small burst | |
| N=5 | Middle ground; typical fleet burst | ✓ |
| N=10 | Aggressive; approaches OpenAI tier-1 limits | |
| Unbounded | Only OpenAI rate limit caps effective concurrency | |

**User's choice:** N=5.
**Notes:** Well under any OpenAI tier past new-account; backend memory bounded (~50MB worst case).

### Q2: OpenAI rate-limit handling
| Option | Description | Selected |
|--------|-------------|----------|
| Immediate fail with `rate_limited` | Caller decides retry; matches Phase 99 D-15 no-retry principle | (partial) |
| Backoff-and-retry inside worker (jittered exp, 3-5 attempts) | Absorbs transient spikes; hides latency | |
| Backoff-and-retry infinitely | Respects `Retry-After`; only fails on caller timeout | |
| Add proactive backend self-throttle to never hit OpenAI's limit | Token bucket + queue upstream of the OpenAI call | ✓ |

**User's choice:** Self-throttle via token bucket, env-configurable RPM (default 30), workers block on tokens; only if a 429 slips through do we return `rate_limited` (signals our own misconfiguration).
**Notes:** Ashley: *"can we have like something in place on the back end that deliberately rate limits lower than whatever we think open a i does so that we never actually hit that from them and maybe there could be like a queue or something."*

### Q3: TTL on queued requests (when caller's 5-min skill-side timeout fires while their request is still in the queue)
| Option | Description | Selected |
|--------|-------------|----------|
| Process them anyway | Backend doesn't know caller gave up; wastes API call | |
| Backend TTL = 5 min from `requested_at` | Drops with `reason: expired`; matches caller assumption | ✓ |
| Caller writes abandon marker | Explicit but adds coordination protocol | |

**User's choice:** Backend TTL = 5 min from `requested_at`; expired → `reason: expired`.
**Notes:** No wasted API calls; response folder ends up consistent.

### Q4: Final failure `reason` enum list
| Option | Description | Selected |
|--------|-------------|----------|
| 7-value enum (`content_blocked`, `rate_limited`, `provider_unavailable`, `not_configured`, `malformed`, `expired`, `unknown`) | Small closed set; only `malformed` gets descriptive message | ✓ |

**User's choice:** 7-value enum as proposed.
**Notes:** Matches Phase 99 D-10 pattern of "small closed enum + optional message, with descriptive message only for the class the caller can iterate on."

---

## Claude's Discretion

- **Number of plans + wave breakdown** — planner's call based on file overlap and test coupling. 4-5 plans in 2-3 waves is likely reasonable.
- **Exact bucket capacity for the token bucket** — recommendation: `capacity = RPM × 5 seconds`.
- **Log-instrumentation placement** — planner instruments per standing directive ("log at every meaningful state transition").
- **Shell for the atomic read-and-delete exec** — planner picks portable form.
- **Exact backend module layout** — mirror `src/backend/spawn-requests/` structure.
- **Test surface breakdown** — unit tests per module + end-to-end wire test per Phase 99 D-22 pattern.
- **Helper script's retry-poll cadence** — recommendation: 500ms for first 30s, back off to 2s after.
- **Where the throttle-rate config lives** — decided inline: env var (`SKYNET_IMAGE_GEN_RPM`) alongside `OPENAI_API_KEY`, NOT in branding.json.
- **Helper script install path on box** — follow substrate convention (`~/.local/bin/image-gen`).

## Deferred Ideas

- Second provider path (Bedrock) for BAA-restricted deployments — Bedrock research completed but v1 uses PHI directive instead
- Per-caller attribution / metering / rate limiting
- Post-processing on skill side (gamma, style, watermark)
- Avatar-flow bleed-in
- Model choice as caller-facing param
- Multiple simultaneous providers per host
- Long-running async / job-handle pattern
- Cross-provider param abstraction
- Admin surface on backend for on-the-fly provider reconfig
- Response-file aging / auto-reaper on Skynet side
- Broker-pattern factoring into shared infrastructure (Phase 116 clones Phase 99; factor when 3rd instance emerges)
- Bounded token-bucket burst-capacity tuning based on measured arrival patterns
- Per-host quota inside the fleet
