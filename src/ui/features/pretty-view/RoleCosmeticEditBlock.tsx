/**
 * Phase 90 Plan 90-04 Task 1 — RoleCosmeticEditBlock
 *
 * D-01 (LOCKED — Ashley 2026-09-09, resolves Phase 86 deferral):
 *   The role modal's role-file tab grows the same cosmetic edit block the
 *   identity modal has (Title text input, ColorPicker, VoicePicker, avatar
 *   generator) MINUS the Phase-86 inherit/override affordance layer — no
 *   *-pending revert flags, no "from role" ghost hints, no revert-to-default
 *   buttons. A role IS the source of truth for its cosmetic values; there
 *   is no upward inheritance to indicate, and undo has no defined target.
 *
 * Signature: RoleCosmeticEditBlock({ roleName, hostId, initial, onDraftChange,
 * saving }). Parent (RoleModal, Task 3) accumulates drafts via onDraftChange
 * and applies them on Save alongside the RoleFileTab textarea body — this
 * component surfaces drafts but does NOT own the Save button.
 *
 * Avatar generator flow mirrors CreateRoleDialog.tsx (Phase 86, already
 * role-seeded). Change vs CreateRoleDialog: on file-pick this component
 * fires onDraftChange({avatar: <filename>}) so the parent can splice it
 * into the role-file frontmatter block at save time — CreateRoleDialog
 * uses its own multipart submit path (createRole) which we don't have
 * here (role already exists).
 */

import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import {
  postGenerateAvatarBatch,
  postManualAvatarCandidate,
  roleAvatarUrl,
  type AvatarCandidate,
} from "@/api/identities-api";
import { ColorPicker } from "./pickers/ColorPicker";
import { VoicePicker } from "./pickers/VoicePicker";

// D-05 fallback hue (app accent) — used when the role file's frontmatter has
// no colorHue key (edge case only — should not occur for roles created
// through the UI per Phase 86 invariant, but the read side handles it
// defensively per plan Task 1 <behavior> Test H).
const FALLBACK_HUE = 190;

export interface RoleCosmeticEditBlockProps {
  /** Role slug — used for the avatar preview URL + as a stable filename
   *  suffix when the user picks a manual avatar upload. */
  roleName: string;
  /** SSH host id — threads into roleAvatarUrl for the preview img src. */
  hostId: number;
  /** Sourced from the role file's frontmatter (Plan 90-01's extended
   *  RoleSummary). All keys optional — empty frontmatter is the edge case
   *  handled by the neutral fallbacks in the local state seeds below. */
  initial: {
    title?: string;
    colorHue?: number;
    voice?: string;
    avatar?: string;
  };
  /** Fires on ANY field change. Parent (RoleModal) accumulates the patch
   *  and applies it on Save alongside the RoleFileTab body. */
  onDraftChange: (
    patch: {
      title?: string;
      colorHue?: number;
      voice?: string;
      avatar?: string;
      // Raw File captured from a manual upload — parent (RoleModal) ships
      // this in the multipart write at save time (Plan 90-04 D-08.3 shape
      // to be settled by the eventual save handler; for now the parent
      // holds onto it as `avatarFile`).
      avatarFile?: File;
    },
  ) => void;
  /** Disables inputs while a save is in flight. */
  saving: boolean;
}

// Mimetype → extension map mirrored from CreateRoleDialog.tsx L121-126 so
// generated-candidate File reconstruction picks a sane filename extension.
const MIME_TO_EXT: Record<string, string> = {
  "image/webp": "webp",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
};

export function RoleCosmeticEditBlock({
  roleName,
  hostId,
  initial,
  onDraftChange,
  saving,
}: RoleCosmeticEditBlockProps) {
  // ── Draft state ─────────────────────────────────────────────────────────
  // Seeded from `initial` on mount. NO *Reverting slots (D-01 rejection).
  // NO committed* mirrors either — the parent RoleModal owns the "what to
  // save" state via the onDraftChange stream; this component is a controlled
  // surface for the pickers.
  const [titleDraft, setTitleDraft] = useState<string>(initial.title ?? "");
  const [colorHueDraft, setColorHueDraft] = useState<number>(
    initial.colorHue ?? FALLBACK_HUE,
  );
  const [voiceDraft, setVoiceDraft] = useState<string>(initial.voice ?? "");

  // ── Avatar generator state (mirrors CreateRoleDialog L180-197) ───────────
  const [candidates, setCandidates] = useState<AvatarCandidate[]>([]);
  const [pickedCandidateId, setPickedCandidateId] = useState<string | null>(null);
  const [genLoading, setGenLoading] = useState<boolean>(false);
  const [genError, setGenError] = useState<string | null>(null);

  const [manualPreviewUrl, setManualPreviewUrl] = useState<string | null>(null);
  const [uploadLoading, setUploadLoading] = useState<boolean>(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const manualUrlRef = useRef<string | null>(null);
  const manualFileRef = useRef<File | null>(null);

  // Object-URL cleanup on unmount (CreateRoleDialog L271-278 pattern).
  useEffect(() => {
    return () => {
      if (manualUrlRef.current) {
        URL.revokeObjectURL(manualUrlRef.current);
        manualUrlRef.current = null;
      }
    };
  }, []);

  const hasGeneratedOnce = candidates.length > 0;
  const canGenerate =
    !genLoading &&
    !saving &&
    roleName.length > 0 &&
    titleDraft.trim().length > 0;

  // ── Avatar generate handler ──────────────────────────────────────────────
  async function handleGenerate(): Promise<void> {
    if (genLoading) return;
    // Mutual exclusion: clear any manual upload state when generating.
    if (manualUrlRef.current) {
      URL.revokeObjectURL(manualUrlRef.current);
      manualUrlRef.current = null;
    }
    setManualPreviewUrl(null);
    manualFileRef.current = null;
    setUploadError(null);
    setGenLoading(true);
    setGenError(null);
    try {
      const cands = await postGenerateAvatarBatch({
        name: roleName,
        title: titleDraft,
        // description doubles as brief per Phase 86 CreateRoleDialog L339 —
        // we don't have the role's description here, so use the title as
        // a fallback prompt seed. The generator is prompt-driven; the role
        // file's own body would be a richer seed but that's owned by the
        // parent RoleFileTab textarea (which we don't read from).
        brief: titleDraft,
        colorHue: colorHueDraft,
      });
      setCandidates(cands);
      // On regen, clear the picked candidate — user must re-pick from the
      // fresh set (mirrors CreateRoleDialog L344-345).
      setPickedCandidateId(null);
    } catch (e) {
      setGenError(e instanceof Error ? e.message : "generation failed");
    } finally {
      setGenLoading(false);
    }
  }

  // ── Manual upload handler ────────────────────────────────────────────────
  async function handleManualUpload(
    e: React.ChangeEvent<HTMLInputElement>,
  ): Promise<void> {
    const file = e.target.files?.[0];
    if (!file) return;
    // Reset the input value so re-picking the same file re-fires change.
    e.target.value = "";
    setUploadLoading(true);
    setUploadError(null);
    try {
      const data = await postManualAvatarCandidate({ file });
      // Mutual exclusion: clear generated candidates.
      setCandidates([]);
      setGenError(null);
      // Revoke prior object URL before creating a new one.
      if (manualUrlRef.current) {
        URL.revokeObjectURL(manualUrlRef.current);
      }
      const objectUrl = URL.createObjectURL(file);
      manualUrlRef.current = objectUrl;
      setManualPreviewUrl(objectUrl);
      manualFileRef.current = file;
      setPickedCandidateId(data.id);
      // Notify parent — the file will be written at save time and the
      // resulting filename becomes the role-file's `avatar:` frontmatter.
      const ext = MIME_TO_EXT[file.type] ?? "webp";
      onDraftChange({ avatar: `${roleName}.${ext}`, avatarFile: file });
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "upload failed");
    } finally {
      setUploadLoading(false);
    }
  }

  // ── Candidate pick handler (generated batch) ─────────────────────────────
  async function handlePickCandidate(candidate: AvatarCandidate): Promise<void> {
    setPickedCandidateId(candidate.id);
    // Fetch the candidate bytes and re-package as a File so the parent can
    // ship it in the eventual multipart save (mirrors CreateRoleDialog
    // resolveAvatarFile at L393-410).
    try {
      const res = await fetch(candidate.url);
      if (!res.ok) {
        throw new Error(`Failed to fetch avatar candidate (HTTP ${res.status})`);
      }
      const blob = await res.blob();
      const mime = blob.type || "image/webp";
      const ext = MIME_TO_EXT[mime] ?? "webp";
      const file = new File([blob], `${roleName}.${ext}`, { type: mime });
      onDraftChange({ avatar: `${roleName}.${ext}`, avatarFile: file });
    } catch {
      // Silently swallow — the user can re-pick / regenerate. Genuine
      // save-side errors surface through the parent's saveError instead.
    }
  }

  // ── Avatar preview src ───────────────────────────────────────────────────
  // Priority: manual upload preview > picked generated candidate > current
  // role avatar from the server (roleAvatarUrl) > null (absent state).
  const avatarPreviewSrc: string | null = manualPreviewUrl
    ? manualPreviewUrl
    : pickedCandidateId
      ? candidates.find((c) => c.id === pickedCandidateId)?.url ?? null
      : initial.avatar
        ? roleAvatarUrl(hostId, roleName)
        : null;

  return (
    <div className="flex flex-col gap-3 mb-4 pb-4 border-b border-white/10">
      <h3 className="text-xs uppercase tracking-wide text-[var(--color-pv-fg-muted)]">
        Cosmetics
      </h3>

      {/* Avatar preview + picker row */}
      <div className="flex items-center gap-3">
        {avatarPreviewSrc ? (
          <img
            src={avatarPreviewSrc}
            alt=""
            data-testid="role-cosmetic-avatar-preview"
            className="shrink-0 object-cover"
            style={{
              width: 40,
              height: 40,
              borderRadius: "50%",
              boxShadow: `0 4px 12px rgba(0,0,0,0.6), inset 0 2px 0 rgba(255,235,190,0.35), 0 0 24px hsla(${colorHueDraft}, 65%, 55%, 0.4)`,
            }}
            draggable={false}
          />
        ) : (
          <div
            data-testid="role-cosmetic-avatar-absent"
            className="shrink-0"
            style={{
              width: 40,
              height: 40,
              borderRadius: "50%",
              background: `hsla(${colorHueDraft}, 45%, 30%, 0.45)`,
              border: "1px solid rgba(255,255,255,0.10)",
            }}
          />
        )}
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={!canGenerate}
            onClick={() => { void handleGenerate(); }}
            aria-label={hasGeneratedOnce ? "Regenerate" : "Generate"}
            className="text-xs px-2 py-1 rounded border border-white/10 bg-black/20 text-[#e8e4d8] disabled:opacity-40 disabled:cursor-not-allowed hover:bg-black/30 transition-colors cursor-pointer"
          >
            {genLoading ? (
              <span className="inline-flex items-center gap-1.5">
                <Loader2 className="size-3 animate-spin" />
                Generating…
              </span>
            ) : hasGeneratedOnce ? "Regenerate" : "Generate"}
          </button>

          <label className="flex">
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="sr-only"
              disabled={saving || uploadLoading}
              onChange={(e) => { void handleManualUpload(e); }}
            />
            <button
              type="button"
              disabled={saving || uploadLoading}
              aria-label="Upload avatar"
              onClick={(e) => {
                const input = (e.currentTarget.parentElement as HTMLLabelElement)
                  ?.querySelector("input[type='file']") as HTMLInputElement | null;
                input?.click();
              }}
              className="text-xs px-2 py-1 rounded border border-white/10 bg-black/20 text-[#e8e4d8] disabled:opacity-40 disabled:cursor-not-allowed hover:bg-black/30 transition-colors cursor-pointer"
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

      {/* Inline errors (avatar generator only — cosmetic fields don't error
          at draft time; the parent RoleModal surfaces save-side errors). */}
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

      {/* Generated candidate row (mirrors CreateRoleDialog L705-730). Picks
          are surfaced up via onDraftChange in handlePickCandidate. */}
      {candidates.length > 0 && (
        <div className="flex gap-2">
          {candidates.map((c) => (
            <button
              key={c.id}
              type="button"
              data-candidate-id={c.id}
              aria-selected={pickedCandidateId === c.id}
              disabled={saving}
              onClick={() => { void handlePickCandidate(c); }}
              className={`flex-1 rounded overflow-hidden border-2 transition-all disabled:opacity-50 cursor-pointer ${
                pickedCandidateId === c.id
                  ? "border-[color:var(--color-pv-code-fg)] ring-1 ring-[color:var(--color-pv-code-fg)]"
                  : "border-transparent hover:border-white/20"
              }`}
              style={{ maxWidth: 80 }}
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

      {/* Title input — mirrors IdentityModal L1943-1966 pattern MINUS the
          titleInherited badge + revert affordance from L1937-1941 (D-01). */}
      <div className="flex flex-col gap-1">
        <label
          htmlFor="role-cosmetic-title"
          className="text-xs text-[var(--color-pv-fg-muted)]"
        >
          Title
        </label>
        <input
          id="role-cosmetic-title"
          type="text"
          value={titleDraft}
          onChange={(e) => {
            setTitleDraft(e.target.value);
            onDraftChange({ title: e.target.value });
          }}
          disabled={saving}
          style={{
            width: "100%",
            background: "rgba(255,255,255,0.06)",
            border: "1px solid rgba(220,225,245,0.15)",
            borderRadius: 6,
            padding: "6px 10px",
            color: "#f0ebe0",
            fontSize: "0.875rem",
            outline: "none",
          }}
        />
      </div>

      {/* Voice picker — reused verbatim from pickers/VoicePicker (D-01 same-
          call-shape). Change handler is bare — no revert-pending logic. */}
      <div className="flex flex-col gap-1">
        <label
          htmlFor="role-voice-picker"
          className="text-xs text-[var(--color-pv-fg-muted)]"
        >
          Voice
        </label>
        <VoicePicker
          id="role-voice-picker"
          ariaLabel="Voice"
          value={voiceDraft}
          onChange={(next) => {
            setVoiceDraft(next);
            onDraftChange({ voice: next });
          }}
          disabled={saving}
        />
      </div>

      {/* Color picker — reused verbatim from pickers/ColorPicker (D-01
          same-call-shape). Change handler is bare — no revert-pending flag. */}
      <div className="flex flex-col gap-1">
        <label
          htmlFor="role-color-picker"
          className="text-xs text-[var(--color-pv-fg-muted)]"
        >
          Color
        </label>
        <ColorPicker
          id="role-color-picker"
          value={colorHueDraft}
          onChange={(next) => {
            setColorHueDraft(next);
            onDraftChange({ colorHue: next });
          }}
          disabled={saving}
        />
      </div>
    </div>
  );
}
