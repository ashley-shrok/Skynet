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

import { useEffect, useState } from "react";
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
  IdentityCloneCollisionError,
  type AvatarCandidate,
  type Identity,
} from "@/api/identities-api";

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
  /** Optional callback invoked with the new Identity after successful clone. */
  onCloned?: (result: Identity) => void;
}

export function CloneAgentDialog({
  open,
  onClose,
  sourceIdentity,
  hostId,
  onCloned,
}: CloneAgentDialogProps) {
  const { t } = useTranslation();

  // ─── State ────────────────────────────────────────────────────────────────
  const [name, setName] = useState<string>("");
  const [title, setTitle] = useState<string>("");
  const [voice, setVoice] = useState<string>("");

  const [candidates, setCandidates] = useState<AvatarCandidate[]>([]);
  const [pickedCandidateId, setPickedCandidateId] = useState<string | null>(null);
  const [genLoading, setGenLoading] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);

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
      setCandidates([]);
      setPickedCandidateId(null);
      setGenLoading(false);
      setGenError(null);
      setSubmitError(null);
      setSubmitting(false);
    } else {
      setName("");
      setTitle("");
      setVoice("");
      setCandidates([]);
      setPickedCandidateId(null);
      setGenLoading(false);
      setGenError(null);
      setSubmitError(null);
      setSubmitting(false);
    }
  }, [open, sourceIdentity]);

  // ─── Validation ───────────────────────────────────────────────────────────
  const nameValid = name.length > 0 && CLONE_NAME_PATTERN.test(name);
  const titleValid = title.trim().length > 0;
  const canSubmit =
    !submitting &&
    nameValid &&
    titleValid &&
    sourceIdentity !== null &&
    hostId !== null;

  // ─── Handlers ─────────────────────────────────────────────────────────────

  async function handleGenerate(): Promise<void> {
    if (genLoading) return;
    // Guard: generate requires name + title (brief seeds from title per
    // plan Action step 1 decision — simpler than fetching role description).
    if (!name || !title.trim()) return;
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

  async function handleSubmit(): Promise<void> {
    if (!canSubmit || !sourceIdentity || hostId === null) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const result = await cloneIdentity({
        sourceIdentityKey: sourceIdentity.identityKey,
        hostId,
        newName: name,
        title: title.trim(),
        voice: voice.length > 0 ? voice : null,
        avatarCandidateId: pickedCandidateId,
      });
      if (onCloned) {
        try {
          onCloned(result);
        } catch {
          // Callback failures don't block close
        }
      }
      onClose();
    } catch (err) {
      if (err instanceof IdentityCloneCollisionError) {
        setSubmitError(
          `Name "${name}" already exists on the source host`,
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

          {/* Avatar preview + Regenerate button. Source avatar is shown by
              default; if user hits Regenerate, a candidate row appears and
              they pick one to override. If no candidate picked, backend
              reuses source's avatarData buffer verbatim (Test 9 in the
              backend suite). */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-widest text-[color:var(--color-pv-fg-muted)]">
                Avatar
              </span>
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
                {hasCandidates ? "Regenerate" : "Regenerate"}
              </button>
            </div>

            {genError && (
              <span className="text-xs text-[color:var(--color-pv-code-fg)]">
                {genError}
              </span>
            )}

            {/* Default preview — source's avatar (rendered whenever no
                candidate is picked) */}
            {!hasCandidates && sourceIdentity && (
              <div className="flex justify-center">
                <img
                  src={sourceIdentity.avatarUrl}
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
            onClick={() => {
              void handleSubmit();
            }}
            disabled={!canSubmit}
          >
            {createLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
