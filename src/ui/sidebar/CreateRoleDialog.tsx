// ─── CreateRoleDialog ─────────────────────────────────────────────────────────
// Phase 22 (SRIC-04): the create-role modal launched from the
// PrettyConversationsPanel header's `+ New role` button. Provisions a new
// role folder on the picked target host via POST /roles (roles-create.ts).
//
// Fields:
//   - Name (required, kebab-case-lowercase; validated by ROLE_NAME_PATTERN)
//   - Description (required, multi-line textarea)
//   - Host picker (same visual pattern as NewSessionDialog's inline listbox;
//     suppressed when only one pickable host — auto-selected in-place)
//
// Chain hook: `onChainToCreateIdentity({role, host, description})` is an
// OPTIONAL callback prop invoked UNCONDITIONALLY on successful submit —
// roles-without-identities is a modeling accident the UI no longer advertises,
// so the primary button always advances to the identity dialog on success.
// The prop is optional and undefined-safe (guard-checked before invocation);
// PrettyConversationsPanel wires it to open NewSessionDialog with role/host/
// description pre-filled.
//
// Not touched: NewSessionDialog surface, PrettyConversationRow.tsx, existing
// clone/identity flows. This dialog is a standalone leaf next to
// NewSessionDialog in the sidebar layer.
//
// ─── Phase 84 (D-CONTEXT items 1-6, 8) ─────────────────────────────────
// UX pass: header blurb below title, required-caption dropped,
// "Then create an agent" checkbox deleted from DOM, primary button
// ALWAYS advances to create-agent (chain callback unconditional),
// modal title conforms to "New role" dropdown label, host picker
// hidden when only one pickable host (single host still auto-picked).
// Item 7 (sibling NewSessionDialog title conform) lives in Plan 84-02.
//
// ─── Phase 86 (D-CTX-86-surface-3, D-CTX-86-empty-not-scenario) ────────
// Cosmetics migrate to role level: this dialog is now the primary AUTHORING
// surface for the four cosmetic frontmatter fields (title, colorHue, voice,
// avatar). Added below the Description textarea and above the Host picker:
//   - Title input (labelled "Title", id `create-role-title`)
//   - VoicePicker (imported from `@/features/pretty-view/pickers/VoicePicker`,
//     id `create-role-voice`)
//   - ColorPicker (imported from `@/features/pretty-view/pickers/ColorPicker`,
//     id `create-role-color`, seeded randomly per open)
//   - Avatar generator: Generate/Regenerate button + Upload button + 3-candidate
//     carousel + manual preview. Batch generator inlined per D-CTX-86-surface-3
//     "planner's discretion (b) — only one caller remains post-phase; extraction
//     can happen later if a third caller emerges".
//
// Submission blocks until Name + Description + Host + Title + Voice +
// ColorHue + a picked/uploaded avatar are ALL set (D-CTX-86-empty-not-scenario:
// "roles can't have empty cosmetics with the flows that we have set up").
//
// Avatar transport (LOCKED — D-CTX-86-surface-3): raw File in multipart. For a
// generated candidate, we `fetch(candidate.url).blob()` and re-package as a
// File; for a manual upload, we hold onto the raw File in a ref. CreateRoleDialog
// does NOT have a birth stream (unlike NewSessionDialog's identity flow), so we
// must ship the File directly in the widened createRole() multipart call.
//
// Zero new npm deps. Reuses the fork's Dialog wrapper (@/components/dialog),
// Button (@/components/button), Input (@/components/input), lucide-react icons
// (Search + Loader2), and the ColorPicker/VoicePicker components from
// pretty-view/pickers.

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Search, Loader2 } from "lucide-react";

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
import type { Host, HostFolder } from "@/types/ui-types";
import {
  createRole,
  postGenerateAvatarBatch,
  postManualAvatarCandidate,
  RoleAlreadyExistsError,
  type AvatarCandidate,
} from "@/api/identities-api";
// Phase 86 (D-CTX-86-surface-3): reused cosmetic pickers from pretty-view.
// Same call shape as NewSessionDialog L1232-1254 and IdentityModal L1763-1772.
import { VoicePicker } from "@/features/pretty-view/pickers/VoicePicker";
import { ColorPicker } from "@/features/pretty-view/pickers/ColorPicker";

// ─── Type-guard + host DFS (duplicated from NewSessionDialog L82-99) ─────────
// Kept inline pending RESEARCH F1 recommendation ("extract into reusable
// HostPickerList"). Extracting is a scope-creep change for this plan — see
// F1 for the deferred refactor rationale.

function isFolder(item: Host | HostFolder): item is HostFolder {
  return "children" in item;
}

function collectAllHosts(children: (Host | HostFolder)[]): Host[] {
  const out: Host[] = [];
  for (const child of children) {
    if (isFolder(child)) {
      out.push(...collectAllHosts(child.children));
    } else {
      out.push(child);
    }
  }
  return out;
}

// ─── Role name validation ────────────────────────────────────────────────────
// Matches backend ROLE_NAME_PATTERN (identity-birth-orchestrator.ts:72) —
// kebab-case-lowercase: /^[a-z0-9-]+$/. Stricter subset of IDENTITY_KEY_RE
// (no dots, slashes, plus, equals, underscores). Defense-in-depth: backend
// re-validates before any SSH/SFTP work.
export const ROLE_NAME_PATTERN = /^[a-z0-9-]+$/;

// ─── Phase 86: mimetype → file-extension map for generated-candidate File
// reconstruction. The batch generator returns image URLs; we fetch bytes and
// re-package as a File. Default to `webp` (what the batch generator emits)
// when the response header omits Content-Type. Kept local to this dialog per
// D-CTX-86-surface-3 "extract later if a third caller emerges" precedent.
const MIME_TO_EXT: Record<string, string> = {
  "image/webp": "webp",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
};

// ─── Component ───────────────────────────────────────────────────────────────

export interface CreateRoleDialogProps {
  /** Whether the dialog is open. Controlled by the caller. */
  open: boolean;
  /** Called when the dialog wants to close (success, cancel, or dismiss). */
  onClose: () => void;
  /** Host tree to populate the picker. Null while the caller is still loading. */
  hostTree: HostFolder | null;
  /**
   * Optional success callback — invoked with {name, description, host} after
   * the POST /roles round-trip returns 201. Independent of the chain callback
   * so callers can react to creation without adopting the chain.
   */
  onCreated?: (result: { name: string; description: string; host: Host }) => void;
  /**
   * Chain hook — invoked UNCONDITIONALLY with {role, host, description} after
   * a successful 201. The prop is optional and undefined-safe (guard-checked
   * before invocation). `description` is the same text captured in the role's
   * description field — pre-fills the agent brief in NewSessionDialog since
   * they're usually the same thing.
   */
  onChainToCreateIdentity?: (opts: { role: string; host: Host; description: string }) => void;
}

export function CreateRoleDialog({
  open,
  onClose,
  hostTree,
  onCreated,
  onChainToCreateIdentity,
}: CreateRoleDialogProps) {
  const { t } = useTranslation();

  // ─── State ───────────────────────────────────────────────────────────────
  const [name, setName] = useState<string>("");
  const [description, setDescription] = useState<string>("");
  const [selectedHost, setSelectedHost] = useState<Host | null>(null);
  const [search, setSearch] = useState<string>("");
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // ─── Phase 86 (D-CTX-86-surface-3) cosmetic state ────────────────────────
  // Mirrors NewSessionDialog L317-337 shape. All EPHEMERAL until submit.
  // colorHue seeded randomly per open so never-touched roles aren't all cyan
  // (matches NewSessionDialog L320's Math.floor(Math.random() * 360) seed).
  const [title, setTitle] = useState<string>("");
  const [voice, setVoice] = useState<string>("");
  const [colorHue, setColorHue] = useState<number>(() =>
    Math.floor(Math.random() * 360),
  );

  // Avatar batch state
  const [candidates, setCandidates] = useState<AvatarCandidate[]>([]);
  const [pickedCandidateId, setPickedCandidateId] = useState<string | null>(null);
  const [genLoading, setGenLoading] = useState<boolean>(false);
  const [genError, setGenError] = useState<string | null>(null);

  // Manual avatar upload state
  const [manualPreviewUrl, setManualPreviewUrl] = useState<string | null>(null);
  const [uploadLoading, setUploadLoading] = useState<boolean>(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  // Ref to track latest manualPreviewUrl for cleanup (mirrors NewSessionDialog L337).
  const manualUrlRef = useRef<string | null>(null);
  // Phase 86 (D-CTX-86-surface-3): raw File captured at input.change time.
  // CreateRoleDialog ships this File directly in the createRole multipart call
  // (no birth-stream indirection — unlike NewSessionDialog). Held in a ref
  // rather than state because the File itself never re-renders anything and
  // we want to avoid stale-closure inside handleSubmit.
  const manualFileRef = useRef<File | null>(null);

  // ─── Derived: flat host list + filtered ──────────────────────────────────
  // Matches NewSessionDialog L294-317 — flatten via DFS, filter out RDP-only
  // hosts (mirrors the sibling picker's Patch #111 F4 predicate for surface
  // parity).
  const flatHosts = useMemo(
    () =>
      collectAllHosts(hostTree?.children ?? []).filter(
        (h) => h.enableRdp !== true,
      ),
    [hostTree],
  );

  const filteredHosts = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return flatHosts;
    return flatHosts.filter((h) => {
      const hay = `${h.name} ${h.username ?? ""} ${h.ip ?? ""}`.toLowerCase();
      return hay.includes(q);
    });
  }, [flatHosts, search]);

  // ─── Effect: seed on open / reset on close ─────────────────────────────
  // Phase 86 code-review fix (M3): SPLIT what used to be one effect keyed on
  // [open, flatHosts]. That combined effect re-fired mid-authoring whenever
  // flatHosts reference changed (e.g., a host coming online), clobbering the
  // user's already-picked colorHue with a fresh random value. Split into:
  //   (a) an open-transition seed effect (keyed on `open` alone) that seeds
  //       colorHue once when the dialog opens, and resets all state on close;
  //   (b) an auto-select effect (keyed on `flatHosts`) that picks the single
  //       host when there's exactly one, but never touches colorHue.
  useEffect(() => {
    if (open) {
      // Phase 86: re-seed colorHue on each OPEN transition (never-touched
      // roles vary in hue). Not re-run on flatHosts updates — see M3.
      setColorHue(Math.floor(Math.random() * 360));
    } else {
      setName("");
      setDescription("");
      setSelectedHost(null);
      setSearch("");
      setSubmitting(false);
      setSubmitError(null);
      // Phase 86: reset cosmetic + avatar state on close so re-open is fresh.
      setTitle("");
      setVoice("");
      setCandidates([]);
      setPickedCandidateId(null);
      setGenLoading(false);
      setGenError(null);
      setUploadLoading(false);
      setUploadError(null);
      if (manualUrlRef.current) {
        URL.revokeObjectURL(manualUrlRef.current);
        manualUrlRef.current = null;
      }
      setManualPreviewUrl(null);
      manualFileRef.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Phase 86 code-review fix (M3, part b): auto-select the single available
  // host when only one exists. Runs both on open (via flatHosts reference)
  // and when the host list changes mid-authoring — but no longer clobbers
  // colorHue or any other cosmetic the user may have touched.
  useEffect(() => {
    if (open && flatHosts.length === 1) {
      setSelectedHost(flatHosts[0]);
    }
  }, [open, flatHosts]);

  // Cleanup: revoke any dangling object URL on unmount.
  useEffect(() => {
    return () => {
      if (manualUrlRef.current) {
        URL.revokeObjectURL(manualUrlRef.current);
        manualUrlRef.current = null;
      }
    };
  }, []);

  // ─── Validation ──────────────────────────────────────────────────────────
  const nameValid = name.length > 0 && ROLE_NAME_PATTERN.test(name);
  const nameShowError = name.length > 0 && !nameValid;
  const descriptionValid = description.trim().length > 0;
  const hostValid = selectedHost !== null;
  // Phase 86 (D-CTX-86-empty-not-scenario): cosmetic fields are REQUIRED.
  // Roles can't have empty cosmetics with the flows we have set up.
  // colorHue is always non-null (seeded randomly); voice + title + avatar
  // are user-set gates.
  const titleValid = title.trim().length > 0;
  const voiceValid = voice.length > 0;
  const avatarValid = pickedCandidateId !== null;
  // canOpen predicate — enables the Create button. Extended in Phase 86 to
  // also require the four cosmetic gates (title + voice + colorHue + avatar).
  const canOpen =
    nameValid &&
    descriptionValid &&
    hostValid &&
    titleValid &&
    voiceValid &&
    avatarValid &&
    !submitting;

  // ─── Phase 86: form-disabled predicate for cosmetic inputs ─────────────
  // Mirrors NewSessionDialog's formDisabled — inputs go read-only during
  // submission or generate/upload loading so the user can't mutate state
  // out from under an in-flight request.
  const formDisabled = submitting;
  const hasGeneratedOnce = candidates.length > 0;
  const canGenerate =
    !genLoading &&
    !formDisabled &&
    name.length > 0 &&
    title.trim().length > 0 &&
    description.trim().length > 0;

  // ─── Phase 86: avatar generate handler (inlined per D-CTX-86-surface-3) ──
  // Mirrors NewSessionDialog L654-676 with role-scoped seeds:
  //   name = role name (kebab-case)
  //   title = role title
  //   brief = role description (existing textarea doubles as brief per
  //     D-CTX-86-surface-3 — no duplicate freeform text input)
  //   colorHue = role colorHue
  async function handleGenerate() {
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
        name,
        title,
        brief: description,
        colorHue,
      });
      setCandidates(cands);
      // Force re-pick — on explicit Regen, clear picked candidate so user
      // must pick from the fresh set (mirrors NewSessionDialog L668-670).
      setPickedCandidateId(null);
    } catch (e) {
      setGenError(e instanceof Error ? e.message : "generation failed");
    } finally {
      setGenLoading(false);
    }
  }

  // ─── Phase 86: avatar manual upload handler (inlined) ───────────────────
  // Mirrors NewSessionDialog L678-704. Preserves mutual exclusion:
  // uploading clears generated candidates and vice versa.
  async function handleManualUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    // Reset the input value so re-picking the same file re-fires the change event.
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
      // Phase 86: hold onto the raw File so handleSubmit can pass it directly
      // to the multipart createRole() call (no candidateId indirection —
      // CreateRoleDialog does not have a birth-stream to hand off to).
      manualFileRef.current = file;
      setPickedCandidateId(data.id);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "upload failed");
    } finally {
      setUploadLoading(false);
    }
  }

  // ─── Phase 86: derive avatar File for the createRole multipart call ─────
  // For a manual upload: the File is already in manualFileRef (captured at
  // input.change time). For a generated candidate: fetch the candidate URL,
  // .blob() it, re-package as a File with a role-name-based filename.
  // Returns null if no avatar picked (submit is gated on pickedCandidateId
  // so this path only triggers with an unexpected state).
  async function resolveAvatarFile(): Promise<File | null> {
    if (!pickedCandidateId) return null;
    // Manual upload path — the File is already held.
    if (manualFileRef.current) return manualFileRef.current;
    // Generated candidate path — fetch bytes and re-package.
    const picked = candidates.find((c) => c.id === pickedCandidateId);
    if (!picked) return null;
    const res = await fetch(picked.url);
    if (!res.ok) {
      throw new Error(
        `Failed to fetch avatar candidate (HTTP ${res.status})`,
      );
    }
    const blob = await res.blob();
    const mime = blob.type || "image/webp";
    const ext = MIME_TO_EXT[mime] ?? "webp";
    return new File([blob], `${name}.${ext}`, { type: mime });
  }

  // ─── Submit handler ──────────────────────────────────────────────────────
  async function handleSubmit() {
    if (!canOpen || !selectedHost) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const hostIdNum = parseInt(String(selectedHost.id), 10);
      // Phase 86: resolve the avatar File BEFORE the createRole call so any
      // fetch-error surfaces inline without leaving the role folder half-
      // created on the server. The widened createRole() from Plan 86-01 Task 3
      // accepts an optional File; we always pass one because canOpen gates on
      // pickedCandidateId being set.
      const avatarFile = await resolveAvatarFile();
      await createRole(
        {
          name,
          description,
          hostId: hostIdNum,
          cosmetics: {
            title,
            colorHue,
            voice,
          },
        },
        avatarFile,
      );

      // Phase 84 (D-CONTEXT items 4 + 5): the primary button always advances to
      // the create-agent modal on success. No branching, no gating. Role name
      // + description pre-fill carry via this callback unconditionally. The
      // checkbox that used to gate this call is gone (D-CONTEXT item 3). The
      // callback prop remains optional and undefined-safe for callers that
      // don't opt in to the chain (test-only pattern; production panel wires
      // it — see PrettyConversationsPanel.tsx chainPrefill).
      if (onChainToCreateIdentity) {
        onChainToCreateIdentity({ role: name, host: selectedHost, description });
      }
      if (onCreated) {
        onCreated({ name, description, host: selectedHost });
      }
      onClose();
    } catch (err) {
      // 409 → inline "already exists" message (Test 19).
      if (err instanceof RoleAlreadyExistsError) {
        setSubmitError(
          `A role named \`${name}\` already exists on ${selectedHost.name}`,
        );
      } else {
        setSubmitError(err instanceof Error ? err.message : "create role failed");
      }
    } finally {
      setSubmitting(false);
    }
  }

  // ─── I18n strings (with defaultValue fallbacks) ──────────────────────────
  // Phase 84 (D-CONTEXT item 6): modal title conforms DOWN to the dropdown
  // label at PrettyConversationsPanel.tsx:2037 ("New role"). Same i18n key,
  // only the English defaultValue changes in place — no new key. Existing
  // translations continue to render "Create a role" until re-translated;
  // English is the source-of-truth locale for this bounty (per Copy-guard
  // LOCKED in 84-CONTEXT.md).
  const startTitle = t("nav.createRoleTitle", {
    defaultValue: "New role",
  });
  const searchPlaceholder = t("nav.createRoleSearchHosts", {
    defaultValue: "Search hosts",
  });
  const nameLabel = t("nav.createRoleNameLabel", {
    defaultValue: "Name",
  });
  const namePlaceholder = t("nav.createRoleNamePlaceholder", {
    defaultValue: "box-maintainer",
  });
  const nameErrorText = t("nav.createRoleNameError", {
    defaultValue: "Name must be kebab-case-lowercase (a-z, 0-9, hyphen only)",
  });
  const descriptionLabel = t("nav.createRoleDescriptionLabel", {
    defaultValue: "Description",
  });
  const descriptionPlaceholder = t("nav.createRoleDescriptionPlaceholder", {
    defaultValue: "What is this role responsible for?",
  });
  const cancelLabel = t("common.cancel", { defaultValue: "Cancel" });
  const openLabel = t("common.create", { defaultValue: "Create" });
  const emptyHostsLabel = t("nav.newSessionNoHosts", {
    defaultValue: "No hosts available",
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent
        className="w-[calc(100vw-2rem)] sm:max-w-md max-h-[90vh] overflow-y-auto"
        style={{ "--pv-hue": "190", "--color-pv-code-fg": "#92eafc" } as React.CSSProperties}
      >
        <DialogHeader>
          <DialogTitle>{startTitle}</DialogTitle>
          {/*
           * Phase 84 (D-CONTEXT item 1): one-sentence header blurb explaining
           * what a role IS. Paired vocabulary with the future create-agent
           * blurb (create-agent-modal-ux-pass bounty carries the sibling copy:
           * "An agent is one specific worker doing a role, with its own name
           * and history."). Product language, not engineering terms — see
           * shape file §Philosophy.
           *
           * Phase 84 (D-CONTEXT item 2): the prior <DialogDescription> that
           * said "Provision a new role folder on the picked host. Name and
           * description are required." is DELETED — the fields themselves
           * already signal required state, no separate caption needed.
           */}
          <DialogDescription>
            A role is what an agent does and how it thinks — many agents can share one.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          {/* Name field */}
          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-bold uppercase tracking-widest text-[color:var(--color-pv-fg-muted)]">
              {nameLabel}
            </span>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={namePlaceholder}
              disabled={submitting}
              aria-invalid={nameShowError || undefined}
              aria-describedby={nameShowError ? "create-role-name-error" : undefined}
              className="text-xs"
            />
            {nameShowError && (
              <span
                id="create-role-name-error"
                role="alert"
                className="text-[10px] text-red-500"
              >
                {nameErrorText}
              </span>
            )}
          </label>

          {/* Description field — multi-line textarea per RESEARCH Open Q 4 */}
          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-bold uppercase tracking-widest text-[color:var(--color-pv-fg-muted)]">
              {descriptionLabel}
            </span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={descriptionPlaceholder}
              disabled={submitting}
              rows={4}
              className="text-xs bg-[color:var(--color-pv-surface-quiet)] border border-[color:var(--color-pv-border-quiet-strong)] rounded-sm px-2 py-1 outline-none placeholder:text-[color:var(--color-pv-fg-dim)] text-[color:var(--color-pv-fg)] disabled:opacity-50 resize-y"
            />
          </label>

          {/*
           * Phase 86 (D-CTX-86-surface-3): cosmetic authoring controls inserted
           * between Description and Host picker. Order mirrors NewSessionDialog
           * L1186-1366 (Title → Voice → Color → Avatar) so the two dialogs feel
           * consistent to a wearer who's used to authoring identity cosmetics.
           */}

          {/* Title field (Phase 86) */}
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="create-role-title"
              className="text-[10px] font-bold uppercase tracking-widest text-[color:var(--color-pv-fg-muted)]"
            >
              Title
            </label>
            <Input
              id="create-role-title"
              aria-label="Title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Box Maintainer"
              disabled={formDisabled}
              className="text-xs"
            />
          </div>

          {/* Voice picker (Phase 86) — reused from pretty-view/pickers */}
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="create-role-voice"
              className="text-[10px] font-bold uppercase tracking-widest text-[color:var(--color-pv-fg-muted)]"
            >
              Voice
            </label>
            <VoicePicker
              value={voice}
              onChange={(v) => !formDisabled && setVoice(v)}
              id="create-role-voice"
              ariaLabel="Voice"
              disabled={formDisabled}
            />
          </div>

          {/* Color picker (Phase 86) — reused from pretty-view/pickers */}
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="create-role-color"
              className="text-[10px] font-bold uppercase tracking-widest text-[color:var(--color-pv-fg-muted)]"
            >
              Color
            </label>
            <ColorPicker
              value={colorHue}
              onChange={(v) => !formDisabled && setColorHue(v)}
              id="create-role-color"
              disabled={formDisabled}
            />
          </div>

          {/* Avatar section (Phase 86) — mirrors NewSessionDialog L1257-1366 */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-widest text-[color:var(--color-pv-fg-muted)]">
                Avatar
              </span>
              <button
                type="button"
                disabled={!canGenerate}
                onClick={() => { void handleGenerate(); }}
                className="text-xs px-2 py-1 rounded border border-[color:var(--color-pv-border-quiet)] bg-[color:var(--color-pv-surface-quiet)] text-[color:var(--color-pv-fg)] disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[color:var(--color-pv-surface)] transition-colors"
                aria-label={hasGeneratedOnce ? "Regenerate" : "Generate"}
              >
                {genLoading ? (
                  <span className="inline-flex items-center gap-1.5">
                    <Loader2 className="size-3 animate-spin" />
                    Generating…
                  </span>
                ) : (hasGeneratedOnce ? "Regenerate" : "Generate")}
              </button>

              {/* Upload… button — label+sr-only input pattern (IdentityModal:1083-1106) */}
              <label className="flex">
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="sr-only"
                  disabled={formDisabled || uploadLoading}
                  onChange={(e) => { void handleManualUpload(e); }}
                />
                <button
                  type="button"
                  disabled={formDisabled || uploadLoading}
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

            {/* Inline generation error */}
            {genError && (
              <span className="text-xs text-[color:var(--color-pv-code-fg)]">
                {genError}
              </span>
            )}

            {/* Inline upload error */}
            {uploadError && (
              <span className="text-xs text-[color:var(--color-pv-code-fg)]">
                {uploadError}
              </span>
            )}

            {/* Candidate row — horizontal flex of 3 buttons */}
            {candidates.length > 0 && (
              <div className="flex gap-2 justify-center">
                {candidates.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    data-candidate-id={c.id}
                    aria-selected={pickedCandidateId === c.id}
                    disabled={formDisabled}
                    onClick={() => !formDisabled && setPickedCandidateId(c.id)}
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

            {/* Manual upload preview — shown when no generated candidates */}
            {candidates.length === 0 && manualPreviewUrl && (
              <div className="flex justify-center">
                <button
                  type="button"
                  aria-selected={true}
                  data-manual-avatar="true"
                  disabled={formDisabled}
                  className="flex-1 rounded overflow-hidden border-2 border-[color:var(--color-pv-code-fg)] ring-1 ring-[color:var(--color-pv-code-fg)] transition-all disabled:opacity-50 max-w-[80px]"
                >
                  <img
                    src={manualPreviewUrl}
                    alt="Manual avatar preview"
                    className="w-full aspect-square object-cover"
                  />
                </button>
              </div>
            )}
          </div>

          {/*
           * Phase 84 (D-CONTEXT item 8): hide the host search input + host listbox
           * entirely when the user has exactly one pickable host. The existing
           * open-effect above (unchanged by this phase) still auto-selects
           * that sole host into `selectedHost`, so submission still works. When
           * the user has zero or ≥2 hosts, both the search box and the listbox
           * render as before. Rationale: Aither Health users (target segment)
           * provision one dedicated VM per user and hit this case constantly;
           * Ashley hits it herself. Matched by Plan 84-02 for NewSessionDialog.
           */}
          {flatHosts.length !== 1 && (
            <>
              {/* Host search + picker (same shape as NewSessionDialog L638-696) */}
              <div className="flex items-center gap-2 px-2.5 h-7 bg-[color:var(--color-pv-surface-quiet)] border border-[color:var(--color-pv-border-quiet-strong)] rounded-sm">
                <Search className="size-3 text-[color:var(--color-pv-fg-dim)] shrink-0" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={searchPlaceholder}
                  aria-label={searchPlaceholder}
                  disabled={submitting}
                  className="flex-1 text-xs bg-transparent outline-none placeholder:text-[color:var(--color-pv-fg-dim)] text-[color:var(--color-pv-fg)] min-w-0 disabled:opacity-50"
                />
              </div>

              <div
                className="flex flex-col max-h-56 overflow-y-auto border border-[color:var(--color-pv-border-quiet)] rounded-sm"
                role="listbox"
                aria-label={t("nav.createRoleHostList", { defaultValue: "Hosts" })}
              >
                {filteredHosts.length === 0 ? (
                  <div className="px-3 py-4 text-xs text-[color:var(--color-pv-fg-dim)] text-center">
                    {emptyHostsLabel}
                  </div>
                ) : (
                  filteredHosts.map((h) => {
                    const selected = selectedHost?.id === h.id;
                    return (
                      <button
                        key={h.id}
                        type="button"
                        role="option"
                        aria-selected={selected}
                        disabled={submitting}
                        onClick={() => !submitting && setSelectedHost(h)}
                        className={`flex items-center gap-2 px-3 py-2 text-xs text-left transition-colors border-b border-[color:var(--color-pv-border-quiet)] last:border-b-0 disabled:opacity-50 ${
                          selected
                            ? "bg-[hsla(var(--pv-hue,190),45%,28%,0.42)] text-[color:var(--color-pv-fg)]"
                            : "hover:bg-[hsla(var(--pv-hue,190),40%,25%,0.18)] text-[color:var(--color-pv-fg)]"
                        }`}
                      >
                        <span
                          className={`size-1.5 rounded-full shrink-0 ${
                            h.online ? "bg-green-500" : "bg-[color:var(--color-pv-fg-dim)]"
                          }`}
                        />
                        <span className="flex-1 truncate">{h.name}</span>
                        {h.username && (
                          <span className="text-[10px] text-[color:var(--color-pv-fg-dim)] shrink-0">
                            {h.username}
                          </span>
                        )}
                      </button>
                    );
                  })
                )}
              </div>
            </>
          )}

          {/* Inline submit error (409 collision OR generic) */}
          {submitError && (
            <div
              role="alert"
              className="text-xs text-red-500 border border-red-500/40 rounded-sm px-3 py-2 bg-red-500/5"
            >
              {submitError}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={onClose}
            disabled={submitting}
            className="text-xs"
          >
            {cancelLabel}
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!canOpen}
            className="text-xs"
          >
            {openLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
