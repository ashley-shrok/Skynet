# Shape: Onboarding a new AI+ executive end to end

**Opened:** 2026-09-04
**Vehicle:** inline this session, tracked via harness tasks

## What this is

The full recipe for standing up a new non-admin executive on the AI+ deployment. One ask ("onboard <exec>") turns into a completed handoff — the exec has an account on the central chat surface with password and multi-factor enrolled, they have their own small private compute box in the appropriate cloud neighborhood with an assistant already alive and reachable on it, that box is registered under their account so they see it (and only it) when they log in, and the operator handing off has verified end-to-end that the whole picture works before it goes to the exec.

The runbook produced is the operator-facing document that walks a cold-start executor through the whole arc. The furnishing script referenced from inside the runbook is the one real code artifact — everything mechanical about turning an empty box into a warm assistant-hosting environment lives there. Everything else in the runbook is plain-english steps the operator does by hand or coordinates with the human touchpoints in the flow.

## Shape

Six moments in order, three of them involving a specific human handoff.

**Mint the seat.** Create the executive's account on the central chat surface using their company email as their login, generate an initial password, enroll multi-factor authentication (the operator generates the shared secret, computes the first confirmation code locally, feeds it back). Existing central-surface endpoints do all of this; no new endpoints get built. Capture the credentials plus the shared secret for the final handoff step.

**Issue a per-executive access key.** The operator, running as an administrator, creates an access token scoped specifically to the newly-minted executive's seat. This token exists so the operator can act *as* the executive in the later step where the executive's private box gets registered — the registration has to land under the executive's ownership, not the administrator's.

**Coordinate the birth of the private box.** The operator hands the ask to the infrastructure coordinator — right now that's Ivy exclusively, who has the whole AI+ project context; post-standup that becomes a designated coordinator who dispatches to whichever of her team is free. She provisions a small ARM compute instance in the appropriate cloud neighborhood, installs the SSH access needed for the operator to reach it, and hands back the private address of a running-but-empty box.

**Furnish the box.** The operator connects into the fresh box, does the browser-based authentication step for the assistant runtime (this touchpoint stays with the account owner for now, until the model of who-owns-the-subscription evolves), then runs the furnishing script. The script installs the runtime, the shell surface, the assistant itself, the supervisor that keeps things warm, the identity machinery, the receiver that lets the box hear messages, the wake-up scheduler, the context-pressure watcher, plus a starter configuration file that heads off a well-known first-launch trap. The script is idempotent — re-runnable from top on failure, no state file, no resume machinery. The script also seeds the executive's initial world: one general-purpose assistant role, one identity to hold it, a marker that keeps that identity always-on, and a user-wide preamble that tells the assistant who its user is by name and basic context. When the script exits clean, the supervisor picks up the seeded identity, the identity's ambient plumbing starts, and the box goes from empty to warm.

**Register the box with the central chat surface.** Using the access token from earlier, the operator records the newly-furnished box as a host — the record lands under the executive's ownership. From that moment on, the central surface's existing per-user scoping does the isolation work: the executive sees this box in their host list, no one else sees it, no code changes were required to make that true.

**Verify and hand over.** The operator (the account owner personally, for now) logs into the central chat surface as the newly-minted executive, confirms the box shows up, opens it, sees the general-purpose assistant already alive and reachable, verifies the whole picture is coherent. Then packages up the executive's login, initial password, and shared multi-factor secret into the shared credential vault, uses the vault's own mechanism to share that entry with the executive, and the runbook is done. The executive is on their own from there.

Three human touchpoints inside the runbook, in order: infrastructure coordinator for the box birth, account owner for the assistant-runtime authentication step during furnishing, account owner again at the end for the vault-share and the final look-over.

## Philosophy

The deliberate stance is that **the isolation is already free and we are not building it here.** The central chat surface already scopes every host operation to its owning user; every executive seeing only their own box is a property that exists today, not a feature we implement. This runbook is the conveyor belt that puts each executive's world into place cleanly, using primitives that already exist.

The deliberate stance on shape is **runbook, not orchestrator.** No new backend endpoints get added to the central surface. No provisioning subsystem gets built. No automation swallows all six moments into one command. The runbook is a plain document the operator follows, with one script buried inside it for the genuinely mechanical furnishing step. If the runbook grows a rough edge in a specific step, the answer is to iterate on the runbook there, not to promote it into a program.

The deliberate stance on failure is **trust the operator to problem-solve breakage in the moment**, don't build a recovery framework. The furnishing script is idempotent so a re-run is safe; everything else is human-in-the-loop where a smart operator can diagnose. That matches how the fleet already operates.

The deliberate stance on seat-minting is that **we discover we don't need new endpoints for it** — existing ones are sufficient, and the operator computes the multi-factor confirmation code locally, the same pattern the fleet already uses today for existing accounts.

## Prior context

A proof-of-concept validated the multi-VM shape end-to-end the day before this shape was written — an ARM compute instance was provisioned in the target cloud neighborhood, the substrate was installed cleanly, an executive-like identity was loaded through the central surface, and the per-user scoping proved out. The box was torn down afterward. Two artifacts came out of the proof-of-concept: confidence that this direction actually works, and one polish item — the starter configuration file needs a specific setting pre-written to head off an interactive prompt at first launch that would otherwise trip the supervisor's blind-drive.

The current feature landing table for the AI+ project had already dissolved one adjacent feature (the per-user authentication plumbing) into this feature after the isolation pivot. This shape effectively dissolves a second adjacent feature (the account-creation-plus-multi-factor feature) into this feature too — the endpoints that feature was going to build turn out to be unnecessary, and the enrollment steps become runbook steps here. Both dissolutions will need banners applied to the corresponding files in the project folder as follow-up documentation cleanup.

The infrastructure coordination model has two phases. Right now, during the build of this feature and through initial standup, the sole point of contact on the infrastructure side is Ivy — she has the whole project context and she's the one to sanity-check the SSH handoff mechanism against, since she was in the loop for the proof-of-concept. Post-standup, the point of contact becomes a designated coordinator (Isabella) who dispatches to whichever of her team is free at the time. The runbook has to be written so a cold-start operator on her side could execute it clean — it can't assume the operator remembers last week's onboarding.

The one-person-owns-the-assistant-subscription model is what we're doing now — the account owner holds the browser-authentication step during furnishing on each new box. This is expected to evolve later; for now, don't over-engineer around it.

## What would make it wrong

The account owner explicitly declined to enumerate failure modes upfront — iteration on the runbook as it gets used is the intended guard, not preemptive defense against imagined future breakage. The stance is: ship the plausible-good-enough runbook, then refine through actual operation.

## Scope edges

**In scope.** The runbook document itself, in the role folder alongside the other runbooks the box-maintainer role already holds — written in general "user" language rather than project-specific "executive" language since the runbook is durable on-disk and this pattern will apply to other Skynet instances too, not just this project's. The furnishing script, alongside the substrate it bundles in the box-maintainer role's substrate staging area on this box (moves into the central chat surface's repository when the fleet distributor phase lands, per the account owner's call). A dry-run end-to-end verification against a scratch compute instance that gets torn down at the end — same shape as the proof-of-concept, but exercising the shipped runbook rather than manual steps.

**Out of scope.** Actual production onboarding of real executives — that's operational usage of the shipped runbook later, when the infrastructure coordinator has a production compute slot ready. Any ongoing update mechanism for the substrate installed on the executive's box — that's the fleet-distributor feature's job, separately. Any handholding of the executive after the vault-share hands them their credentials.

**Deferred.** Documentation cleanup on the two adjacent-feature files that this shape dissolves — will get banner treatment separately after this ships. Anything about the post-standup coordination model with the infrastructure coordinator dispatcher — for now, all infrastructure coordination goes through Ivy exclusively.

**Tempting but no.** A one-command orchestrator that swallows the whole runbook end-to-end. A backend endpoint for the seat-minting or multi-factor enrollment steps. A resume-from-state recovery framework for the furnishing script. An admin UI for any of this. All would add code without paying for themselves.

## Vehicle notes

**Inline this session, tracked via harness tasks.** A GSD phase was considered and declined — too many parts of this shape are not code-writing (the runbook is a document, the Ivy coordination is a conversation, the dissolution-banner cleanup is documentation), and GSD's pipeline is shaped for code work. Harness tasks preserve the ordered-work discipline without imposing pipeline ceremony on the parts that don't need it.

Handoff to a downstream implementer is not part of the vehicle plan — the account owner said the session has plenty of runway to complete in place.

Key references the implementer wants to keep close:
- The AI+ project folder in the role folder (holds the feature-XX files, decisions, open-questions, and PROJECT overview)
- The role file's runbook section, where the new runbook eventually gets listed
- The vendored substrate staging area on this box, for what the furnishing script bundles
- The proof-of-concept's tear-down learnings for what worked and what needed the settings-file polish

The identity doing the work is tiffany, on this box, on the current branch. Sub-agents don't deploy — deploy motion (if any code lands and needs shipping) is orchestrator scope per standing rules. The deploy-window boundary sits at the push moment, not at the recreate moment — no push happens without a fresh "may I?" from the account owner.
