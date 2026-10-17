// ─── CreateRoleDialog ─────────────────────────────────────────────────────────
// Phase 22 (SRIC-04): the create-role modal launched from the
// PrettyConversationsPanel header's `+ New role` button. Provisions a new
// role folder on the picked target host via POST /roles (roles-create.ts).
//
// Fields:
//   - Name (required, free text; slugified for disk, kept raw as the `title`
//     cosmetic — see slugifyRoleName)
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
// identity flows. This dialog is a standalone leaf next to
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
//   - ColorPicker (imported from `@/features/pretty-view/pickers/ColorPicker`,
//     id `create-role-color`, seeded randomly per open)
//   - Avatar generator: Generate/Regenerate button + Upload button + 3-candidate
//     carousel + manual preview. Batch generator inlined per D-CTX-86-surface-3
//     "planner's discretion (b) — only one caller remains post-phase; extraction
//     can happen later if a third caller emerges".
//
// Submission blocks until Name + Description + Host + a picked/uploaded avatar
// are ALL set (D-CTX-86-empty-not-scenario: "roles can't have empty cosmetics
// with the flows that we have set up"). Title derives from Name and voice is a
// fixed default, so neither is a separate gate.
//
// Avatar transport (LOCKED — D-CTX-86-surface-3): raw File in multipart. For a
// generated candidate, we `fetch(candidate.url).blob()` and re-package as a
// File; for a manual upload, we hold onto the raw File in a ref. CreateRoleDialog
// does NOT have a birth stream (unlike NewSessionDialog's identity flow), so we
// must ship the File directly in the widened createRole() multipart call.
//
// apple-ux (shape-ux-foundation): every control comes from the kit
// (@/components/kit) — KitField + KitInput/KitTextarea for the text fields,
// KitButton for actions, KitHostPicker for the host list, kit tokens for the
// avatar candidate grid — plus the ColorPicker from pretty-view/pickers.

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { Modal, ModalHead, ModalBody, ModalFoot } from "@/components/modal";
import {
  KitBanner,
  KitButton,
  KitField,
  KitHostPicker,
  KitInput,
  KitTextarea,
} from "@/components/kit";
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
import { ColorPicker } from "@/features/pretty-view/pickers/ColorPicker";
import { previewSlugFromPrettyName } from "@/lib/pretty-name-slug-preview";

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

// The Name field accepts free text (any capitalization/spacing).
//
// Pretty-names shape (2026-09-30): the frontend no longer slugifies before
// submit — the backend derives the slug via the shared derivePrettyNameSlug
// helper. slugifyRoleName is kept here only because SkillsEditorModal still
// imports it (out of this shape's scope per § Scope edges: skills — OUT).
// For role creation itself, the dialog uses previewSlug (see Validation
// section below) which mirrors the backend recipe.
//
// Diacritics are folded rather than dropped so "Café Ops" yields `cafe-ops`,
// not `caf-ops`.
export function slugifyRoleName(raw: string): string {
  return raw
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
    .replace(/-+$/g, "");
}

// ─── Phase 86: mimetype → file-extension map for generated-candidate File
// reconstruction. The batch generator returns image URLs; we fetch bytes and
// re-package as a File. Default to `webp` (what the batch generator emits)
// when the response header omits Content-Type. Kept local to this dialog per
// D-CTX-86-surface-3 "extract later if a third caller emerges" precedent.
// Every new role gets this voice. Set explicitly rather than by leaving `voice`
// unset — the omitted-voice fallback is the TTS provider's default (Joanna on
// Polly), and changing that would retint every existing voiceless role. On an
// instance using another provider this saved Polly voice is simply skipped.
const DEFAULT_ROLE_VOICE = "Danielle";

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
  /** Host to pre-pick on open (still editable) — set by the new-agent dialog's "New role…" hop. */
  initialHost?: Host | null;
}

export function CreateRoleDialog({
  open,
  onClose,
  hostTree,
  onCreated,
  onChainToCreateIdentity,
  initialHost = null,
}: CreateRoleDialogProps) {
  const { t } = useTranslation();

  // ─── State ───────────────────────────────────────────────────────────────
  const [name, setName] = useState<string>("");
  const [description, setDescription] = useState<string>("");
  const [selectedHost, setSelectedHost] = useState<Host | null>(null);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // ─── Phase 86 (D-CTX-86-surface-3) cosmetic state ────────────────────────
  // Mirrors NewSessionDialog L317-337 shape. All EPHEMERAL until submit.
  // colorHue seeded randomly per open so never-touched roles aren't all cyan
  // (matches NewSessionDialog L320's Math.floor(Math.random() * 360) seed).
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
  const uploadInputRef = useRef<HTMLInputElement | null>(null);

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

  const hostOptions = useMemo(
    () =>
      flatHosts.map((h) => ({
        id: String(h.id),
        name: h.name,
        detail: h.username || undefined,
        status: h.online ? ("ok" as const) : ("off" as const),
        searchText: `${h.username ?? ""} ${h.ip ?? ""}`,
      })),
    [flatHosts],
  );

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
      if (initialHost) setSelectedHost(initialHost);
    } else {
      setName("");
      setDescription("");
      setSelectedHost(null);
      setSubmitting(false);
      setSubmitError(null);
      // Phase 86: reset cosmetic + avatar state on close so re-open is fresh.
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
  // Pretty-names shape (2026-09-30): `name` is the free-form typed pretty
  // name. Backend derives the slug — shared preview helper at
  // @/lib/pretty-name-slug-preview mirrors the recipe so this dialog +
  // NewSessionDialog + CreateProjectModal all gate on the same rule.
  const title = name.trim();
  const slugPreview = previewSlugFromPrettyName(name);
  const nameValid = title.length > 0 && title.length <= 80 && slugPreview.length > 0;
  const nameShowError = name.trim().length > 0 && !nameValid;
  const nameErrorReason: "empty-slug" | "too-long" =
    title.length > 80 ? "too-long" : "empty-slug";
  const descriptionValid = description.trim().length > 0;
  const hostValid = selectedHost !== null;
  // Phase 86 (D-CTX-86-empty-not-scenario): cosmetic fields are REQUIRED.
  // colorHue is always non-null (seeded randomly); voice is a fixed default;
  // title now derives from the Name field, so only avatar remains a user gate.
  const avatarValid = pickedCandidateId !== null;
  const canOpen =
    nameValid &&
    descriptionValid &&
    hostValid &&
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
    nameValid &&
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
      // Name and title are one concept now, so the drafter gets the same
      // human-readable string for both — it reads better in a prompt than the
      // slug would ("Box Maintainer", not "box-maintainer").
      const cands = await postGenerateAvatarBatch({
        name: title,
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
    // Phase 111 SKEW-04: SKIPPED (external URL — pravatar/gravatar avatar
    // candidate). We do NOT wrap this with stampedFetch because
    // X-Skynet-Client-Build would leak to a third-party server and it's
    // not our origin anyway. Keep raw fetch().
    const res = await fetch(picked.url);
    if (!res.ok) {
      throw new Error(
        `Failed to fetch avatar candidate (HTTP ${res.status})`,
      );
    }
    const blob = await res.blob();
    const mime = blob.type || "image/webp";
    const ext = MIME_TO_EXT[mime] ?? "webp";
    // Pretty-names shape: backend derives the real on-disk avatar filename
    // from the server-side slug + ext. Client filename is informational.
    return new File([blob], `${slugPreview || "role"}.${ext}`, { type: mime });
  }

  // ─── Submit handler ──────────────────────────────────────────────────────
  // Pretty-names shape (2026-09-30): submit the typed pretty name as
  // `displayName`; the backend derives the slug (and may auto-suffix on
  // collision). Use the derived slug returned by the server (`result.name`)
  // for any downstream chain, so the whole system agrees on the real slug.
  async function handleSubmit() {
    if (!canOpen || !selectedHost) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const hostIdNum = parseInt(String(selectedHost.id), 10);
      const avatarFile = await resolveAvatarFile();
      const result = await createRole(
        {
          displayName: title,
          description,
          hostId: hostIdNum,
          cosmetics: {
            colorHue,
            voice: DEFAULT_ROLE_VOICE,
          },
        },
        avatarFile,
      );
      const derivedSlug = result.name;

      if (onChainToCreateIdentity) {
        onChainToCreateIdentity({ role: derivedSlug, host: selectedHost, description });
      }
      if (onCreated) {
        onCreated({ name: derivedSlug, description, host: selectedHost });
      }
      onClose();
    } catch (err) {
      // Pretty-names shape: backend auto-suffixes on collision, so 409
      // "already exists" is no longer expected. Keep the branch for safety
      // against older peer backends but with a generic message.
      if (err instanceof RoleAlreadyExistsError) {
        setSubmitError(
          `A role named \`${title}\` could not be created on ${selectedHost.name}`,
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
  const nameLabel = t("nav.createRoleNameLabel", {
    defaultValue: "Name",
  });
  const namePlaceholder = t("nav.createRoleNamePlaceholder", {
    defaultValue: "Meal Planner",
  });
  const nameErrorText =
    nameErrorReason === "empty-slug"
      ? t("nav.createRoleNameError", {
          defaultValue: "Name must contain at least one letter",
        })
      : t("nav.createRoleNameErrorTooLong", {
          defaultValue: "Name must be 80 characters or fewer",
        });
  const descriptionLabel = t("nav.createRoleDescriptionLabel", {
    defaultValue: "Description",
  });
  const descriptionPlaceholder = t("nav.createRoleDescriptionPlaceholder", {
    defaultValue: "What is this role responsible for?",
  });
  const openLabel = t("common.create", { defaultValue: "Create" });
  const emptyHostsLabel = t("nav.newSessionNoHosts", {
    defaultValue: "No hosts available",
  });

  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      size="md"
    >
      {/*
       * Phase 88 (paired-blurb revision — see
       * .planning/phases/88-create-agent-modal-ux-pass-…/88-CONTEXT.md
       * §Verbatim copy): the role side says agents ADOPT expertise, the
       * agent side says each agent ADOPTS a role. The canonical ModalHead
       * carries the title (and a subtitle via DialogPrimitive.Description
       * when one is set). Do NOT drop the text.
       */}
      <ModalHead title={startTitle} />

      <ModalBody className="flex flex-col gap-4">
        {/* Name field */}
        <KitField label={nameLabel} error={nameShowError ? nameErrorText : undefined}>
          <KitInput
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={namePlaceholder}
            disabled={submitting}
          />
        </KitField>

        {/* Description field — multi-line per RESEARCH Open Q 4 */}
        <KitField label={descriptionLabel}>
          <KitTextarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={descriptionPlaceholder}
            disabled={submitting}
            rows={4}
          />
        </KitField>

        {/*
         * Phase 86 (D-CTX-86-surface-3): cosmetic authoring controls between
         * Description and Host picker (Color → Avatar), mirroring the
         * new-agent dialog's order.
         */}

        {/* Color picker (Phase 86) — reused from pretty-view/pickers */}
        <KitField label="Color" htmlFor="create-role-color">
          <ColorPicker
            value={colorHue}
            onChange={(v) => !formDisabled && setColorHue(v)}
            id="create-role-color"
            disabled={formDisabled}
          />
        </KitField>

        {/* Avatar section (Phase 86) — Generate/Regenerate + Upload…, then
            the candidate grid (or the uploaded preview). */}
        <div className="k-field">
          <div className="flex items-center justify-between gap-2">
            <span className="k-label">Avatar</span>
            <div className="flex items-center gap-2">
              <KitButton
                size="sm"
                disabled={!canGenerate}
                busy={genLoading}
                onClick={() => { void handleGenerate(); }}
                aria-label={hasGeneratedOnce ? "Regenerate" : "Generate"}
              >
                {genLoading ? "Generating…" : hasGeneratedOnce ? "Regenerate" : "Generate"}
              </KitButton>
              <input
                ref={uploadInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="sr-only"
                tabIndex={-1}
                aria-hidden="true"
                disabled={formDisabled || uploadLoading}
                onChange={(e) => { void handleManualUpload(e); }}
              />
              <KitButton
                size="sm"
                disabled={formDisabled}
                busy={uploadLoading}
                aria-label="Upload avatar"
                onClick={() => uploadInputRef.current?.click()}
              >
                {uploadLoading ? "Uploading…" : "Upload…"}
              </KitButton>
            </div>
          </div>

          {/* Inline generation / upload errors */}
          {genError && <span className="k-err">{genError}</span>}
          {uploadError && <span className="k-err">{uploadError}</span>}

          {/* Candidate grid — three pickable tiles on kit tokens */}
          {candidates.length > 0 && (
            <div className="grid grid-cols-3 gap-2 mt-1">
              {candidates.map((c) => {
                const picked = pickedCandidateId === c.id;
                return (
                  <button
                    key={c.id}
                    type="button"
                    data-candidate-id={c.id}
                    aria-selected={picked}
                    disabled={formDisabled}
                    onClick={() => !formDisabled && setPickedCandidateId(c.id)}
                    className={`rounded-xl overflow-hidden bg-[var(--k-s2)] outline-offset-2 transition-[outline-color,opacity] disabled:opacity-50 cursor-pointer focus-visible:outline-2 focus-visible:outline-[var(--k-acc)] ${
                      picked
                        ? "outline-2 outline-[var(--k-acc)]"
                        : "outline-2 outline-transparent hover:outline-[var(--k-hair2)]"
                    }`}
                  >
                    <img
                      src={c.url}
                      alt={`Avatar candidate ${c.id}`}
                      className="w-full aspect-square object-cover"
                    />
                  </button>
                );
              })}
            </div>
          )}

          {/* Manual upload preview — shown when no generated candidates */}
          {candidates.length === 0 && manualPreviewUrl && (
            <div className="flex justify-center mt-1">
              <button
                type="button"
                aria-selected={true}
                data-manual-avatar="true"
                disabled={formDisabled}
                className="w-20 rounded-xl overflow-hidden outline-2 outline-offset-2 outline-[var(--k-acc)] disabled:opacity-50"
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
         * Phase 84 (D-CONTEXT item 8): hide the host picker entirely when the
         * user has exactly one pickable host — the open-effect above still
         * auto-selects that sole host into `selectedHost`, so submission
         * still works. With zero or ≥2 hosts, the kit host picker renders
         * (search + rows with a status dot).
         */}
        {flatHosts.length !== 1 && (
          <KitField
            label={t("nav.createRoleHostLabel", { defaultValue: "Host" })}
            htmlFor="create-role-host-search"
          >
            <KitHostPicker
              hosts={hostOptions}
              selectedId={selectedHost ? String(selectedHost.id) : null}
              onSelect={(id) => {
                if (submitting) return;
                const h = flatHosts.find((x) => String(x.id) === id);
                if (h) setSelectedHost(h);
              }}
              disabled={submitting}
              searchable
              searchId="create-role-host-search"
              emptyText={flatHosts.length === 0 ? emptyHostsLabel : undefined}
            />
          </KitField>
        )}

        {/* Inline submit error (409 collision OR generic) */}
        {submitError && <KitBanner tone="danger">{submitError}</KitBanner>}
      </ModalBody>

      <ModalFoot>
        <KitButton
          variant="primary"
          onClick={() => { void handleSubmit(); }}
          disabled={!canOpen}
          busy={submitting}
        >
          {submitting ? "Creating role…" : openLabel}
        </KitButton>
      </ModalFoot>
    </Modal>
  );
}
