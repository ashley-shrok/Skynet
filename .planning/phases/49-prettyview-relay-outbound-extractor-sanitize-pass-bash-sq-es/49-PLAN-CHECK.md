# Phase 49 — Plan Check

**Checker:** gsd-plan-checker (goal-backward, adversarial stance)
**Checked:** 2026-08-20
**Plan under review:** `49-01-PLAN.md`
**Verdict:** ## CHECK PASS (with 3 non-blocking warnings)

---

## Goal-backward verification

Phase goal: *"PrettyView relay-outbound extractor sanitize pass — bash sq-escape idiom preprocessing to eliminate body truncation on apostrophe-bearing messages."*

For the phase to be delivered, the plan must produce:

| # | Required outcome | Where the plan delivers it | Verdict |
|---|---|---|---|
| 1 | Working `sanitizeBashSqEscapeIdioms(cmd)` that replaces BOTH `'"'"'` AND `'\''` with `U+E000` | Task 1 § (A)(2) — exact function body: `return cmd.replace(/'"'"'/g, APOS_MARKER).replace(/'\\''/g, APOS_MARKER);`. Both idioms covered, order preserved for parity with `parsers.py:108`. Regex `/'\\''/g` correctly matches the 4-char idiom `'\''` (source pair `\\` = literal `\`). | PASS |
| 2 | Working `restoreApostrophes(body)` that swaps `U+E000` → `'` | Task 1 § (A)(3) — `if (body === null) return null; return body.replaceAll(APOS_MARKER, "'");`. Handles null passthrough per `parsers.py:112`. | PASS |
| 3 | ALL 4 sq-strategy regexes simplified + ALL 4 `.replace(/'\\''/g, "'")` calls dropped | Task 1 § (C) enumerates 4 regex sites (BODY-sq @ 228, MSG-sq @ 254, TEXT/MESSAGE-sq @ 280, jq-arg-inline-sq @ 320-321) with FROM→TO diffs. Task 1 § (D) enumerates 4 `.replace` drop sites (230, 256, 282, 324). Line numbers cross-verified against the actual `session-file-parser.ts` — all four match byte-for-byte. | PASS |
| 4 | NELLY-SHAPE fixture expects full apostrophe-bearing body | Task 2 § (A) — fixture cmd contains `BODY='Relaying Ashley'"'"'s reply: hi'` in a valid outbound curl command; expectedBody: `"Relaying Ashley's reply: hi"` (26 chars, apostrophe restored). | PASS |
| 5 | SELF-REFERENTIAL KNOWN-LIMITATION test documents (not asserts fix) | Task 2 § (B) — new `describe("extractOutboundBody — known limitations")` block; `expect(extractOutboundBody(cmd)).toBe("relaying Ashley")` — documents current substring-bleed behavior. Deferred rationale cited from CONTEXT.md § Deferred Ideas. | PASS |
| 6 | PRIORITY-REGRESSION test preserved byte-for-byte | Task 2 § (C) explicit prohibition: "The PRIORITY-REGRESSION describe block at line 361 — passes unchanged." Acceptance criterion `grep -c 'PRIORITY-REGRESSION' ... == 1` guards against accidental duplication or deletion. | PASS |
| 7 | Every task's verify requires full-suite green | Task 1 verify: `npx tsc --noEmit && npx vitest run src/backend/claude-session/session-file-parser.outbound-body.test.ts && npx vitest run`. Task 2 verify: `npx vitest run src/backend/claude-session/session-file-parser.outbound-body.test.ts && npx vitest run src/... -t NELLY-SHAPE && npx vitest run`. Task 3 verify: `npx vitest run && test -f ... && git log ... && git status ...`. All three tasks include full-suite `npx vitest run` as a gate. | PASS |
| 8 | Zero deploy motions | Task 1 explicit "Do NOT run any deploy commands. Do NOT edit ~/skynet-patches.md. Do NOT push. Do NOT touch RelayOutboundBubble.tsx." Task 2 identical prohibition. Task 3 § (E) enumerates: NO push, NO docker build, NO docker cp, NO docker compose, NO patch-catalog edit, NO Matrix coord post. Acceptance criterion checks `dist-backend/.../session-file-parser.js` mtime unchanged. | PASS |
| 9 | `autonomous: true` on plan | Line 11 of frontmatter: `autonomous: true`. | PASS |

---

## Anti-goal verification

| Anti-goal | Plan compliance |
|---|---|
| No scope creep beyond the two target files | Task 1 modifies ONLY `session-file-parser.ts` (files element line 112). Task 2 modifies ONLY `session-file-parser.outbound-body.test.ts` (line 199). Task 3 writes `49-01-SUMMARY.md` (planning artifact) and commits. Explicit DO-NOT lists cover `RelayOutboundBubble.tsx`, nginx configs, Dockerfile, docker-compose.yml, `package.json`. Phase-level verification § 8 enumerates "no frontend files, no backend files other than session-file-parser.ts, no test files other than session-file-parser.outbound-body.test.ts, no nginx configs, no Dockerfile, no docker-compose.yml, no package.json, no lockfile changes, no CLAUDE.md, no ROADMAP.md, no STATE.md." COMPLIANT. |
| No attempt to fix deferred self-referential heredoc-content-bleed | Task 2 § (B) SELF-REFERENTIAL test explicitly asserts current-behavior `toBe("relaying Ashley")` with in-code comment "documented, not fixed by Phase 49" and cites CONTEXT.md § Deferred Ideas. No reorder of strategy priority in Task 1. No heredoc-content pre-mask logic added. COMPLIANT. |
| No placeholder other than U+E000 | CONTEXT.md § Placeholder character locks `U+E000`. Task 1 § (A)(1) uses `` (private-use area codepoint) as the string constant value. COMPLIANT. |
| No `--no-verify` or test-skipping | Task 3 § (C) explicit: "Do NOT use `--no-verify`, `--amend`, or `-i`." Every task verify runs `npx vitest run` full suite. No `.skip` / `.only` mentioned anywhere in plan. COMPLIANT. |
| `<read_first>` and `<acceptance_criteria>` on every task | Task 1: both present (lines 113-118, 175-188). Task 2: both present (lines 200-205, 271-282). Task 3: both present (lines 294-298, 358-371). COMPLIANT. |

---

## Dimension-by-dimension

**D1 Requirement Coverage:** Phase requirements are empty in frontmatter (`requirements: []`); phase 49 exists per its stated goal, not by REQ-XX IDs (this is fleet-local box-maintainer work, not a ROADMAP.md-tracked user-facing feature). Coverage measured against `<success_criteria>` block in the plan — 7 success criteria, all mapped to tasks 1/2/3. PASS.

**D2 Task Completeness:** Every `<task>` element has `<name>`, `<files>`, `<read_first>`, `<action>` (or `<behavior>`+`<action>` for tdd tasks), `<verify>` with `<automated>`, `<done>`, and `<acceptance_criteria>`. Tasks 1 and 2 are `type="auto" tdd="true"` and include the required `<behavior>` element. Task 3 is `type="auto"` (non-TDD). All elements populated with concrete, actionable content — no vague verbs like "implement auth". PASS.

**D3 Dependency Correctness:** Single plan (`49-01`) with `depends_on: []` and `wave: 1`. No graph to validate. Task-level ordering within the plan is enforced by test/commit gating (Task 3 depends on Task 1 + Task 2 tests being green). PASS.

**D4 Key Links Planned:** `must_haves.key_links` enumerates 3 wirings: `extractOutboundBody → sanitizeBashSqEscapeIdioms` (call site pattern), `extractOutboundBody return path → restoreApostrophes` (wrap pattern), and `strategies 1/3/5a/7 → simplified [^']* regex` (pattern shape). Task 1 § (B)(1)+(B)(3) implement the first two; Task 1 § (C) implements the third. Every artifact created has a wiring task, not just isolated creation. PASS.

**D5 Scope Sanity:** 3 tasks, 2 modified source files + 1 planning artifact + 1 commit. Well within budget (target 2-3 tasks/plan). Task 1 is the heaviest (10 s.match substitutions + 4 regex simplifications + 4 .replace drops + 10 return-wraps + 3 new declarations) but all mechanical and enumerated line-by-line; scope is bounded within a single ~200-line function body. PASS.

**D6 Verification Derivation:** `must_haves.truths` are user-observable and testable: "extractOutboundBody rescues Nelly's shape...", "PRIORITY-REGRESSION test continues to pass byte-for-byte", "Full `npx vitest run` exits 0". No implementation-focused truths like "APOS_MARKER declared". Artifacts map to truths; key_links cover the critical wiring. PASS.

**D7 Context Compliance:** Every locked CONTEXT.md decision has a task implementing it:
- Fix design (sanitize+restore+refactor) → Task 1 § (A)+(B) ✓
- Placeholder = U+E000 → Task 1 § (A)(1) ✓
- Simplify 4 sq regexes → Task 1 § (C) ✓
- Drop 4 per-strategy `.replace` → Task 1 § (D) ✓
- Leave double-quoted strategies unchanged → Task 1 § (E) ✓
- Leave heredoc strategies unchanged → Task 1 § (E) ✓
- Leave inline-json unchanged → Task 1 § (E) ✓
- Priority ordering unchanged → Task 1 preserves strategy order; Task 2 preserves PRIORITY-REGRESSION test ✓
- NELLY-SHAPE fixture → Task 2 § (A) ✓
- SELF-REFERENTIAL as KNOWN-LIMITATION (documents, not fixes) → Task 2 § (B) ✓

No task implements Deferred Ideas (self-referential fix, unextractable-by-design, heredoc-first reorder). No task contradicts a locked decision. PASS.

**D7b Scope Reduction Detection:** Scanned for `"v1"`, `"v2"`, `"static for now"`, `"placeholder"`, `"basic version"`, `"minimal"`, `"stub"`, `"not wired to"`, `"future enhancement"`, `"too complex"`. **Zero matches** in Task 1 or Task 2 actions. Task 3 § (D) contains the word "Optionally" but for a purely-informational SUMMARY commit-sha field, not for delivering a decision. No scope reduction. PASS.

**D7c Architectural Tier Compliance:** N/A — no Architectural Responsibility Map in RESEARCH.md (this is a pure backend refactor within a single module). SKIPPED.

**D8 Nyquist Compliance:** No `## Validation Architecture` section in RESEARCH.md; VALIDATION.md not present. SKIPPED per D8 skip condition. (Note: every task's `<automated>` command runs vitest, which is unit-test-level fast feedback — inherently Nyquist-compliant in spirit.)

**D9 Cross-Plan Data Contracts:** Single plan, no cross-plan data pipelines. N/A.

**D10 CLAUDE.md Compliance:** No `./CLAUDE.md` at repo root (checked). SKIPPED.

**D11 Research Resolution:** RESEARCH.md has no `## Open Questions` section — the entire "Nothing else needs research" section at RESEARCH.md:205-213 explicitly resolves the design space (consumer unchanged, wire type unchanged, classifier unchanged, unextractable-tail out of scope, self-referential deferred). PASS.

**D12 Pattern Compliance:** No PATTERNS.md for this phase. SKIPPED.

---

## Non-blocking warnings

**W1 (minor — self-inconsistency between action and acceptance grep):** Task 1 § (B)(2) tells the executor they may rename the `cmd` parameter at their discretion, but Task 1 acceptance criterion #4 is `grep -c "sanitizeBashSqEscapeIdioms(cmd)" ... outputs 1`. If executor renames, the grep returns 0 and acceptance fails. **Recommendation:** Executor should keep the parameter name `cmd` — the plan strongly implies this is the safer choice via the must_haves.key_links pattern `sanitizeBashSqEscapeIdioms\(cmd\)`. Not a blocker; the executor will discover the tension and default to keeping the name.

**W2 (minor — miscounted Shape B fallback):** Task 1 acceptance criterion #5 says Shape B ("single-funnel wrap") should show `grep -c "restoreApostrophes("` >= 2. In practice Shape B as described in the action ("keep each strategy assigning to a local body variable, replace each return body; with return restoreApostrophes(body);") is functionally identical to Shape A (10 wrap sites, not 1 funnel). Actual expected count under either shape is 11+. The "Shape B >= 2" allowance would only make sense if there were a single-exit refactor collecting all strategy results into one variable — but the action text does not describe that shape. **Recommendation:** Executor uses Shape A (10 per-site wraps + 1 definition = 11 hits, or 12 if the final `return null` is also wrapped). Not a blocker; the counting rubric is loose enough that both interpretations pass.

**W3 (minor — fragile shell-escaped acceptance grep):** Task 1 acceptance criteria #6 and #7 use heavily shell-escaped grep patterns (`grep -cE "'\(\?:'\\\\\\\\''\|\[\^'\]\)\*'"`) intended to prove the old sq-alternation regex and old `.replace(/'\''/g` calls are gone from executable code. The escaping is correct in intent but shell-quoting-brittle across invocation environments. **Recommendation:** If an acceptance grep silently returns 0 for the wrong reason (miscounted escaping), executor should also confirm via a direct visual diff (`git diff src/backend/claude-session/session-file-parser.ts | grep -E '^\-'`). Not a blocker.

---

## Summary

The plan is executable as-is. All 9 concrete pass criteria in `<check_goals>` are addressed by concrete tasks with correct file/line references, correct regex idioms, correct scope discipline (only 2 target files touched), correct deploy-motion prohibition (matches box-maintainer role-file directive), and correct treatment of the deferred self-referential bug (documented via KNOWN-LIMITATION test, not fixed). The 3 warnings above are minor internal inconsistencies in acceptance-grep wording that will not prevent Phase 49 from delivering its stated goal — worst case, executor spends 30 seconds re-reading the action text and picking the compliant path.

**No blockers. No scope creep. No decision contradictions. No deferred-idea leakage.**

## CHECK PASS
