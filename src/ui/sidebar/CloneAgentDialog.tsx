// ─── CloneAgentDialog ────────────────────────────────────────────────────────
// Phase 22 (SRIC-03): the clone-identity modal launched from the
// PrettyConversationRow context-menu "Clone" item. Provisions a new fleet
// identity on the SAME host as the source (host is LOCKED per D-CONTEXT §UX
// rules) via POST /identities/clone (identity-clone.ts).
//
// Fields (from D-CONTEXT §Frontend surfaces):
//   - Name (required, blank; validated by IDENTITY_KEY_RE)
//   - Title (editable, pre-filled from source identity)
//   - Voice (editable, pre-filled from source; uses shared VoicePicker)
//   - Avatar (pre-filled with source's avatar preview; Regenerate button
//     fires postGenerateAvatarBatch seeded from name+title — brief=title
//     per plan Action step 1 decision)
//
// LOCKED fields (D-CONTEXT §UX plan-checker BLOCK if exposed):
//   - Host (same as source; passed via `hostId` prop from panel)
//   - Role (auto-preserved by backend via resolveRoleForIdentity two-step)
//   - Color (auto-preserved by backend from sourceRow.colorHue)
//
// Chain hook is NOT provided — clone is a one-shot flow. No `onChainToXxx`
// prop. Success invokes `onCloned` (optional) then `onClose`.
//
// Zero new npm deps. Reuses Dialog wrapper (@/components/dialog), Button
// (@/components/button), Input (@/components/input), lucide-react icons,
// VoicePicker (@/features/pretty-view/pickers/VoicePicker), and the newly-
// added cloneIdentity API client with IdentityCloneCollisionError typed 409.

import { Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/dialog";
import { Button } from "@/components/button";
import { Input } from "@/components/input";
import { VoicePicker } from "@/features/pretty-view/pickers/VoicePicker";
import {
  cloneIdentity,
  postGenerateAvatarBatch,
  postManualAvatarCandidate,
  IdentityCloneCollisionError,
  // Phase 66 Plan 05: hostId threading — Plan 03's GET /:id/avatar requires
  // hostId query param; dialog's hostId prop supplies it for the source-avatar
  // preview render at L548.
  avatarUrlWithHost,
  type AvatarCandidate,
  type Identity,
} from "@/api/identities-api";
import type { NewSessionOnCreateOpts } from "@/sidebar/NewSessionDialog";
import type { Host } from "@/types/ui-types";

// Identity name pattern — matches backend IDENTITY_KEY_RE at
// identity-artifact-reader.ts:88 exactly (/^[a-z0-9_-]{1,64}$/).
// Defense-in-depth: backend re-validates before any SSH/SFTP work.
export const CLONE_NAME_PATTERN = /^[a-z0-9_-]{1,64}$/;

export interface CloneAgentDialogProps {
  /** Whether the dialog is open. Controlled by the caller. */
  open: boolean;
  /** Called when the dialog wants to close (success, cancel, or dismiss). */
  onClose: () => void;
  /**
   * Source identity being cloned. Panel resolves via useIdentities().byKey.get
   * at the row context. Null when no valid source (dialog renders empty state
   * safely — but the panel only opens the dialog when this is non-null).
   */
  sourceIdentity: Identity | null;
  /**
   * Host to clone onto — LOCKED to the source's host per D-CONTEXT §UX rules.
   * Not exposed as an editable field in the UI (Test 18 asserts absence of
   * host picker). Threaded through as-is to the backend.
   */
  hostId: number | null;
  /**
   * Source Host object — same origin as `hostId` (both come from the panel's
   * row.host). Threaded so the auto-route-into-new-session callback
   * (`onCreateSession` below) can build a full NewSessionOnCreateOpts payload
   * without the panel having to re-resolve the host. Optional so callers that
   * don't want auto-routing (or don't have the host yet) can omit it.
   *
   * quick-260806-bz7: added for clone-modal auto-route parity with birth's
   * focus-follow.
   */
  sourceHost?: Host | null;
  /** Optional callback invoked with the new Identity after successful clone. */
  onCloned?: (result: Identity) => void;
  /**
   * Optional callback fired after a successful clone (AFTER `onCloned` runs,
   * BEFORE `onClose`). AppShell's onCreateSession consumes this to open a
   * terminal tab on the newly-cloned identity's tmux session — parity with
   * identity-birth's focus-follow. Fires only when BOTH this callback and
   * `sourceHost` are provided (both are needed to build a valid opts payload
   * with the widened `identityMode: "existing"` variant).
   *
   * Wrapped in try/catch at the call site so a routing failure never blocks
   * the modal close — the user can still find the new row in the sidebar.
   *
   * quick-260806-bz7.
   */
  onCreateSession?: (opts: NewSessionOnCreateOpts) => void;
}

export function CloneAgentDialog({
  open,
  onClose,
  sourceIdentity,
  hostId,
  sourceHost,
  onCloned,
  onCreateSession,
}: CloneAgentDialogProps) {
  const { t } = useTranslation();

  // ─── State ────────────────────────────────────────────────────────────────
  const [name, setName] = useState<string>("");
  const [title, setTitle] = useState<string>("");
  const [voice, setVoice] = useState<string>("");
  // Working directory on the target host for the new identity's sessions.
  // Required; defaults to "~/" (mirrors birth's NewSessionDialog default) so
  // clones don't inherit the source identity's cwd (patty from poppy was
  // silently landing in poppy's project dir before this field existed).
  const [path, setPath] = useState<string>("~/");

  const [candidates, setCandidates] = useState<AvatarCandidate[]>([]);
  const [pickedCandidateId, setPickedCandidateId] = useState<string | null>(null);
  const [genLoading, setGenLoading] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);

  // Manual avatar upload state
  const [manualPreviewUrl, setManualPreviewUrl] = useState<string | null>(null);
  const [uploadLoading, setUploadLoading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  // Ref to track latest manualPreviewUrl for cleanup on unmount (avoids stale-closure)
  const manualUrlRef = useRef<string | null>(null);

  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // ─── Reset on open/close ──────────────────────────────────────────────────
  // On open: seed title/voice from source; name blank; clear candidates + errors.
  // On close: reset everything so re-open is fresh (Test 23).
  useEffect(() => {
    if (open) {
      setName("");
      setTitle(sourceIdentity?.title ?? "");
      setVoice(sourceIdentity?.voice ?? "");
      setPath("~/");
      setCandidates([]);
      setPickedCandidateId(null);
      setGenLoading(false);
      setGenError(null);
      // Revoke any prior manual URL on re-open
      if (manualUrlRef.current) {
        URL.revokeObjectURL(manualUrlRef.current);
        manualUrlRef.current = null;
      }
      setManualPreviewUrl(null);
      setUploadLoading(false);
      setUploadError(null);
      setSubmitError(null);
      setSubmitting(false);
    } else {
      setName("");
      setTitle("");
      setVoice("");
      setPath("~/");
      setCandidates([]);
      setPickedCandidateId(null);
      setGenLoading(false);
      setGenError(null);
      // Revoke any live manual URL on close
      if (manualUrlRef.current) {
        URL.revokeObjectURL(manualUrlRef.current);
        manualUrlRef.current = null;
      }
      setManualPreviewUrl(null);
      setUploadLoading(false);
      setUploadError(null);
      setSubmitError(null);
      setSubmitting(false);
    }
  }, [open, sourceIdentity]);

  // Keep manualUrlRef in sync for unmount cleanup (avoids stale closures).
  useEffect(() => {
    manualUrlRef.current = manualPreviewUrl;
  }, [manualPreviewUrl]);

  // Unmount cleanup: revoke any live manual object URL.
  useEffect(() => {
    return () => {
      if (manualUrlRef.current) {
        URL.revokeObjectURL(manualUrlRef.current);
        manualUrlRef.current = null;
      }
    };
  }, []);

  // ─── Validation ───────────────────────────────────────────────────────────
  const nameValid = name.length > 0 && CLONE_NAME_PATTERN.test(name);
  const titleValid = title.trim().length > 0;
  const pathValid = path.trim().length > 0;
  const canSubmit =
    !submitting &&
    nameValid &&
    titleValid &&
    pathValid &&
    sourceIdentity !== null &&
    hostId !== null;

  // ─── Handlers ─────────────────────────────────────────────────────────────

  async function handleGenerate(): Promise<void> {
    if (genLoading) return;
    // Guard: generate requires name + title (brief seeds from title per
    // plan Action step 1 decision — simpler than fetching role description).
    if (!name || !title.trim()) return;
    // Mutual exclusion: clear manual upload state when generating
    if (manualUrlRef.current) {
      URL.revokeObjectURL(manualUrlRef.current);
      manualUrlRef.current = null;
    }
    setManualPreviewUrl(null);
    setUploadError(null);
    setGenLoading(true);
    setGenError(null);
    try {
      const cands = await postGenerateAvatarBatch({
        name,
        title,
        brief: title, // Plan Action step 1: use title as brief seed.
      });
      setCandidates(cands);
      // Clear pick so user must pick from the fresh set.
      setPickedCandidateId(null);
    } catch (e) {
      setGenError(e instanceof Error ? e.message : "generation failed");
    } finally {
      setGenLoading(false);
    }
  }

  // Manual avatar upload handler
  async function handleManualUpload(e: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = e.target.files?.[0];
    if (!file) return;
    // Reset the input value so re-picking the same file re-fires the change event
    e.target.value = "";
    setUploadLoading(true);
    setUploadError(null);
    try {
      const data = await postManualAvatarCandidate({ file });
      // Mutual exclusion: clear generated candidates
      setCandidates([]);
      setGenError(null);
      // Revoke prior object URL before creating a new one
      if (manualUrlRef.current) {
        URL.revokeObjectURL(manualUrlRef.current);
      }
      const objectUrl = URL.createObjectURL(file);
      manualUrlRef.current = objectUrl;
      setManualPreviewUrl(objectUrl);
      setPickedCandidateId(data.id);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "upload failed");
    } finally {
      setUploadLoading(false);
    }
  }

  async function handleSubmit(): Promise<void> {
    if (!canSubmit || !sourceIdentity || hostId === null) return;
    setSubmitting(true);
    setSubmitError(null);
    // Normalize path once — reused for both the cloneIdentity call and the
    // auto-route onCreateSession payload (quick-260806-bz7) so they can't
    // disagree.
    const normalizedPath = path.trim();
    try {
      const result = await cloneIdentity({
        sourceIdentityKey: sourceIdentity.identityKey,
        hostId,
        newName: name,
        title: title.trim(),
        voice: voice.length > 0 ? voice : null,
        // colorHue is LOCKED-from-source in the UI (no picker). Passing it in
        // the wire so the backend can persist it to the cloned identity's
        // on-disk frontmatter (Phase 66 /close 2026-09-01 follow-up).
        colorHue: sourceIdentity.colorHue,
        avatarCandidateId: pickedCandidateId,
        path: normalizedPath,
      });
      if (onCloned) {
        try {
          onCloned(result);
        } catch {
          // Callback failures don't block close
        }
      }
      // quick-260806-bz7: auto-route into a new terminal tab on the cloned
      // identity's tmux session — parity with identity-birth's focus-follow.
      // Fires only when both onCreateSession AND sourceHost are provided
      // (both are required to build a valid identityMode:"existing" opts
      // payload). Wrapped in try/catch so a routing failure never blocks the
      // modal close — the user can still click the new sidebar row manually.
      if (onCreateSession && sourceHost) {
        try {
          onCreateSession({
            host: sourceHost,
            sessionName: result.identityKey,
            path: normalizedPath,
            identityMode: "existing",
            identityName: result.identityKey,
            identityId: result.id,
          });
        } catch {
          // Best-effort — swallow so onClose still fires.
        }
      }
      onClose();
    } catch (err) {
      if (err instanceof IdentityCloneCollisionError) {
        // 409 covers two collision surfaces: a matching (userId, identityKey)
        // row already in the Skynet DB (backend step 2b precheck), or a
        // matching folder already on the target host (backend step 7 FS
        // probe). Either way the user's next move is the same — pick a
        // different name — so keep the message location-agnostic.
        setSubmitError(
          `Name "${name}" is already in use — pick a different name.`,
        );
      } else {
        setSubmitError(err instanceof Error ? err.message : "clone failed");
      }
    } finally {
      setSubmitting(false);
    }
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  const dialogTitle = sourceIdentity
    ? `Clone ${sourceIdentity.displayName}`
    : "Clone identity";
  const dialogDescription = sourceIdentity
    ? `Create a new identity based on ${sourceIdentity.displayName}. Host, role, and color are preserved automatically.`
    : "Clone an existing identity.";

  const cancelLabel = t("common.cancel", { defaultValue: "Cancel" });
  const createLabel = t("common.clone", { defaultValue: "Clone" });

  const hasCandidates = candidates.length > 0;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{dialogTitle}</DialogTitle>
          <DialogDescription>{dialogDescription}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3 py-2">
          {/* Name input (required, blank) */}
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="clone-name"
              className="text-[10px] font-bold uppercase tracking-widest text-[color:var(--color-pv-fg-muted)]"
            >
              Name
            </label>
            <Input
              id="clone-name"
              aria-label="Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={
                sourceIdentity ? `${sourceIdentity.identityKey}-2` : "new-name"
              }
              disabled={submitting}
            />
            {name.length > 0 && !nameValid && (
              <span className="text-xs text-[color:var(--color-pv-code-fg)]">
                Use lowercase letters, digits, underscore, or hyphen (max 64
                chars).
              </span>
            )}
          </div>

          {/* Title input (editable, pre-filled from source) */}
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="clone-title"
              className="text-[10px] font-bold uppercase tracking-widest text-[color:var(--color-pv-fg-muted)]"
            >
              Title
            </label>
            <Input
              id="clone-title"
              aria-label="Title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Research Assistant"
              disabled={submitting}
            />
          </div>

          {/* Path input (required, defaults to "~/"). Working dir for the new
              identity on the target host — mirrors birth's path field. Without
              this the new session inherits the source's cwd (e.g. a poppy
              clone would silently land in poppy's project dir). */}
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="clone-path"
              className="text-[10px] font-bold uppercase tracking-widest text-[color:var(--color-pv-fg-muted)]"
            >
              Path
            </label>
            <Input
              id="clone-path"
              aria-label="Path"
              value={path}
              onChange={(e) => setPath(e.target.value)}
              placeholder="~/"
              disabled={submitting}
            />
            {!pathValid && (
              <span className="text-xs text-[color:var(--color-pv-code-fg)]">
                Path is required.
              </span>
            )}
          </div>

          {/* Voice picker — reused from pretty-view/pickers */}
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="clone-voice"
              className="text-[10px] font-bold uppercase tracking-widest text-[color:var(--color-pv-fg-muted)]"
            >
              Voice
            </label>
            <VoicePicker
              value={voice}
              onChange={(v) => !submitting && setVoice(v)}
              id="clone-voice"
              ariaLabel="Voice"
              disabled={submitting}
            />
          </div>

          {/* Avatar preview + Regenerate + Upload… buttons.
              Source avatar is shown by default; if user hits Regenerate, a
              candidate row appears and they pick one to override. If user
              hits Upload…, a manually-chosen image is used instead.
              Manual and generated are mutually exclusive. */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-1">
              <span className="text-[10px] font-bold uppercase tracking-widest text-[color:var(--color-pv-fg-muted)]">
                Avatar
              </span>
              <div className="flex gap-1">
                <button
                  type="button"
                  disabled={
                    submitting || genLoading || !name || !title.trim()
                  }
                  onClick={() => {
                    void handleGenerate();
                  }}
                  className="text-xs px-2 py-1 rounded border border-[color:var(--color-pv-border-quiet)] bg-[color:var(--color-pv-surface-quiet)] text-[color:var(--color-pv-fg)] disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[color:var(--color-pv-surface)] transition-colors"
                  aria-label={hasCandidates ? "Regenerate" : "Regenerate"}
                >
                  {genLoading ? (
                    <span className="inline-flex items-center gap-1.5">
                      <Loader2 className="size-3 animate-spin" />
                      Generating…
                    </span>
                  ) : (hasCandidates ? "Regenerate" : "Regenerate")}
                </button>

                {/* Upload… button — label+sr-only input pattern */}
                <label className="flex">
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    className="sr-only"
                    disabled={submitting || uploadLoading}
                    onChange={(e) => { void handleManualUpload(e); }}
                  />
                  <button
                    type="button"
                    disabled={submitting || uploadLoading}
                    aria-label="Upload avatar"
                    onClick={(e) => {
                      const input = (e.currentTarget.parentElement as HTMLLabelElement)?.querySelector("input[type='file']") as HTMLInputElement | null;
                      input?.click();
                    }}
                    className="text-xs px-2 py-1 rounded border border-[color:var(--color-pv-border-quiet)] bg-[color:var(--color-pv-surface-quiet)] text-[color:var(--color-pv-fg)] disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[color:var(--color-pv-surface)] transition-colors"
                  >
                    {uploadLoading ? (
                      <span className="inline-flex items-center gap-1.5">
                        <Loader2 className="size-3 animate-spin" />
                        Uploading…
                      </span>
                    ) : "Upload…"}
                  </button>
                </label>
              </div>
            </div>

            {genError && (
              <span className="text-xs text-[color:var(--color-pv-code-fg)]">
                {genError}
              </span>
            )}

            {uploadError && (
              <span className="text-xs text-[color:var(--color-pv-code-fg)]">
                {uploadError}
              </span>
            )}

            {/* Manual upload preview — takes priority over source avatar when set */}
            {manualPreviewUrl && !hasCandidates && (
              <div className="flex justify-center">
                <button
                  type="button"
                  aria-selected={true}
                  data-manual-avatar="true"
                  disabled={submitting}
                  className="w-16 h-16 rounded overflow-hidden border-2 border-[color:var(--color-pv-code-fg)] ring-1 ring-[color:var(--color-pv-code-fg)] transition-all disabled:opacity-50"
                >
                  <img
                    src={manualPreviewUrl}
                    alt="Manual avatar preview"
                    className="w-full h-full object-cover"
                  />
                </button>
              </div>
            )}

            {/* Default preview — source's avatar (rendered when no candidate
                and no manual upload).
                Phase 66 Plan 05: hostId threading — Plan 03's GET /:id/avatar
                requires hostId query param. dialog's hostId prop (declared at
                L75 as `number | null`) is the source-identity's home box; we
                already gate the render on the surrounding `sourceIdentity`
                truthiness AND the outer submit path requires hostId !== null
                (L211/L274), so when this branch renders we're safe to route
                through avatarUrlWithHost. Guard on hostId != null anyway for
                defense-in-depth (edge race: sourceIdentity resolved before
                hostId picker completes). */}
            {!hasCandidates && !manualPreviewUrl && sourceIdentity && (
              <div className="flex justify-center">
                <img
                  src={
                    hostId != null
                      ? avatarUrlWithHost(sourceIdentity, hostId)
                      : sourceIdentity.avatarUrl
                  }
                  alt={`Avatar for ${sourceIdentity.displayName}`}
                  className="w-16 h-16 rounded object-cover"
                />
              </div>
            )}

            {/* Candidate row — horizontal flex of buttons */}
            {hasCandidates && (
              <div className="flex gap-2 justify-center">
                {candidates.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    data-candidate-id={c.id}
                    aria-selected={pickedCandidateId === c.id}
                    disabled={submitting}
                    onClick={() =>
                      !submitting && setPickedCandidateId(c.id)
                    }
                    className={`flex-1 rounded overflow-hidden border-2 transition-all disabled:opacity-50 ${
                      pickedCandidateId === c.id
                        ? "border-[color:var(--color-pv-code-fg)] ring-1 ring-[color:var(--color-pv-code-fg)]"
                        : "border-transparent hover:border-[color:var(--color-pv-border-quiet)]"
                    }`}
                  >
                    <img
                      src={c.url}
                      alt={`Avatar candidate ${c.id}`}
                      className="w-full aspect-square object-cover"
                    />
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* quick-260806-dwe: subtext during the slow await so the modal
              doesn't feel hung. cloneIdentity now blocks for ~25s while the
              backend runs the harness-start sequence (trust-flag pre-write,
              claude launch, 2s sleep, 7-Enter train × 3s, /id <newName>).
              role="status" + aria-live="polite" so screen readers announce
              it without stealing focus. Mutually exclusive with submitError
              (both live in the same visual slot; error only renders after
              submitting flips false). Positioned BEFORE the error span so
              on failure the error is what remains visible. */}
          {submitting && (
            <span
              role="status"
              aria-live="polite"
              className="text-xs text-[color:var(--color-pv-fg-muted)]"
            >
              Preparing session… (this can take ~25s while the new agent's
              Claude harness starts up)
            </span>
          )}

          {/* Inline submit error (Test 22 collision surface + generic errors) */}
          {submitError && (
            <span className="text-xs text-[color:var(--color-pv-code-fg)]">
              {submitError}
            </span>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => {
              if (!submitting) onClose();
            }}
            disabled={submitting}
          >
            {cancelLabel}
          </Button>
          <Button
            variant="outline"
            className="text-[color:var(--color-pv-code-fg)] hover:opacity-90 disabled:opacity-50"
            onClick={() => {
              void handleSubmit();
            }}
            disabled={!canSubmit}
          >
            {submitting ? "Creating..." : createLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
