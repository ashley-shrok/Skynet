// The roles window's new-role form: picture first (generate three to pick
// from, or upload), then name, description, colour and host. Creating from
// the library lands on the new role; from the new-conversation dialog's
// "New role…" it goes back there (the window decides — see onCreated).

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, Sparkles, Upload } from "lucide-react";
import { ModalBody, ModalFoot, ModalHead } from "@/components/modal";
import {
  KitAvatar,
  KitBanner,
  KitButton,
  KitField,
  KitHostPicker,
  KitInput,
  KitTextarea,
  kitConfirm,
} from "@/components/kit";
import type { Host } from "@/types/ui-types";
import {
  createRole,
  postGenerateAvatarBatch,
  postManualAvatarCandidate,
  RoleAlreadyExistsError,
  type AvatarCandidate,
} from "@/api/identities-api";
import { ColorPicker } from "../pickers/ColorPicker";
import { previewSlugFromPrettyName } from "@/lib/pretty-name-slug-preview";
import { roleAvatarColor, type LeaveGuard } from "./RolesWindow";

// Every new role gets this voice. Set explicitly rather than by leaving
// `voice` unset — the omitted-voice fallback is the TTS provider's default,
// and changing that would retint every existing voiceless role.
const DEFAULT_ROLE_VOICE = "Danielle";

const MIME_TO_EXT: Record<string, string> = {
  "image/webp": "webp",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
};

export function NewRoleView({
  flatHosts,
  initialHostId,
  backLabel,
  onBack,
  onHueDraft,
  onCreated,
  registerGuard,
}: {
  flatHosts: Host[];
  initialHostId: number | null;
  backLabel: string;
  onBack: () => void;
  onHueDraft: (hue: number | null) => void;
  onCreated: (result: { role: string; host: Host; description: string }) => void | Promise<void>;
  registerGuard: (g: LeaveGuard | null) => void;
}): JSX.Element {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [colorHue, setColorHue] = useState(() => Math.floor(Math.random() * 360));
  const [selectedHost, setSelectedHost] = useState<Host | null>(
    () =>
      flatHosts.find((h) => Number(h.id) === initialHostId) ?? (flatHosts.length === 1 ? flatHosts[0] : null),
  );
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const [candidates, setCandidates] = useState<AvatarCandidate[]>([]);
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [genLoading, setGenLoading] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [manualPreviewUrl, setManualPreviewUrl] = useState<string | null>(null);
  const [uploadLoading, setUploadLoading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const manualUrlRef = useRef<string | null>(null);
  const manualFileRef = useRef<File | null>(null);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (flatHosts.length === 1) setSelectedHost(flatHosts[0]);
  }, [flatHosts]);

  // The window tints to the colour being picked.
  useEffect(() => {
    onHueDraft(colorHue);
  }, [colorHue, onHueDraft]);

  useEffect(
    () => () => {
      if (manualUrlRef.current) URL.revokeObjectURL(manualUrlRef.current);
    },
    [],
  );

  // Leaving with anything typed or picked asks first.
  const touched = name.trim() !== "" || description.trim() !== "" || pickedId != null;
  const touchedRef = useRef(touched);
  touchedRef.current = touched;
  const submittingRef = useRef(false);
  useEffect(() => {
    registerGuard(async () => {
      if (submittingRef.current || !touchedRef.current) return true;
      return kitConfirm({
        title: "Discard this new role?",
        body: "What you've filled in so far won't be kept.",
        confirmLabel: "Discard",
        destructive: true,
      });
    });
    return () => registerGuard(null);
  }, [registerGuard]);

  const title = name.trim();
  const slugPreview = previewSlugFromPrettyName(name);
  const nameValid = title.length > 0 && title.length <= 80 && slugPreview.length > 0;
  const nameError =
    title.length > 0 && !nameValid
      ? title.length > 80
        ? "Name must be 80 characters or fewer"
        : "Name must contain at least one letter"
      : undefined;
  const descriptionValid = description.trim().length > 0;
  const canGenerate = !genLoading && !submitting && nameValid && descriptionValid;
  const canCreate = nameValid && descriptionValid && selectedHost != null && pickedId != null && !submitting;

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

  function clearManual(): void {
    if (manualUrlRef.current) URL.revokeObjectURL(manualUrlRef.current);
    manualUrlRef.current = null;
    manualFileRef.current = null;
    setManualPreviewUrl(null);
  }

  async function handleGenerate(): Promise<void> {
    if (!canGenerate) return;
    clearManual();
    setUploadError(null);
    setGenLoading(true);
    setGenError(null);
    try {
      const cands = await postGenerateAvatarBatch({ name: title, title, brief: description, colorHue });
      setCandidates(cands);
      setPickedId(null);
    } catch (e) {
      setGenError(e instanceof Error ? e.message : "generation failed");
    } finally {
      setGenLoading(false);
    }
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploadLoading(true);
    setUploadError(null);
    try {
      const data = await postManualAvatarCandidate({ file });
      setCandidates([]);
      setGenError(null);
      clearManual();
      const url = URL.createObjectURL(file);
      manualUrlRef.current = url;
      manualFileRef.current = file;
      setManualPreviewUrl(url);
      setPickedId(data.id);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "upload failed");
    } finally {
      setUploadLoading(false);
    }
  }

  async function resolveAvatarFile(): Promise<File | null> {
    if (!pickedId) return null;
    if (manualFileRef.current) return manualFileRef.current;
    const picked = candidates.find((c) => c.id === pickedId);
    if (!picked) return null;
    // External candidate URL — plain fetch (no build header to a third party).
    const res = await fetch(picked.url);
    if (!res.ok) throw new Error(`Failed to fetch avatar candidate (HTTP ${res.status})`);
    const blob = await res.blob();
    const mime = blob.type || "image/webp";
    return new File([blob], `${slugPreview || "role"}.${MIME_TO_EXT[mime] ?? "webp"}`, { type: mime });
  }

  async function handleCreate(): Promise<void> {
    if (!canCreate || !selectedHost) return;
    setSubmitting(true);
    submittingRef.current = true;
    setSubmitError(null);
    const hostId = parseInt(String(selectedHost.id), 10);
    try {
      const avatarFile = await resolveAvatarFile();
      const result = await createRole(
        {
          displayName: title,
          description: description.trim(),
          hostId,
          cosmetics: { colorHue, voice: DEFAULT_ROLE_VOICE },
        },
        avatarFile,
      );
      console.info({ operation: "role_created", hostId, roleName: result.name });
      await onCreated({ role: result.name, host: selectedHost, description: description.trim() });
    } catch (err) {
      submittingRef.current = false;
      console.warn({
        operation: "role_create_failed",
        hostId,
        errMessage: err instanceof Error ? err.message : String(err),
      });
      setSubmitError(
        err instanceof RoleAlreadyExistsError
          ? `A role named "${title}" could not be created on ${selectedHost.name}.`
          : err instanceof Error
            ? err.message
            : "Couldn't create the role.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  const preview =
    candidates.length > 0 ? (
      <div className="flex gap-3.5 justify-center" role="radiogroup" aria-label="Picture">
        {candidates.map((c) => {
          const picked = pickedId === c.id;
          return (
            <button
              key={c.id}
              type="button"
              role="radio"
              aria-checked={picked}
              data-candidate-id={c.id}
              disabled={submitting}
              onClick={() => setPickedId(c.id)}
              className={`size-[76px] rounded-full overflow-hidden bg-[var(--k-s2)] outline-2 outline-solid outline-offset-[3px] cursor-pointer disabled:opacity-50 focus-visible:outline-[var(--k-acc)] ${
                picked ? "outline-[var(--k-acc)]" : "outline-transparent hover:outline-[var(--k-hair2)]"
              }`}
            >
              <img src={c.url} alt={`Picture option ${c.id}`} className="w-full h-full object-cover" />
            </button>
          );
        })}
      </div>
    ) : (
      <KitAvatar
        src={manualPreviewUrl}
        fallback={(title || "?").charAt(0).toUpperCase()}
        color={roleAvatarColor(colorHue)}
        size={76}
        data-testid="new-role-preview"
      />
    );

  return (
    <>
      <ModalHead
        title="New role"
        subtitle={<span className="max-sm:hidden">A role is expertise your agents adopt.</span>}
        closeTestId="roles-window-close"
        leading={
          <KitButton variant="plain" size="sm" onClick={onBack} data-testid="roles-window-back" data-modal-back="">
            <ChevronLeft /> {backLabel}
          </KitButton>
        }
      />
      <ModalBody>
        <div className="max-w-[520px] mx-auto flex flex-col gap-[18px]">
          <div className="flex flex-col items-center gap-3">
            {preview}
            <div className="flex flex-wrap justify-center gap-2">
              <KitButton
                size="sm"
                disabled={!canGenerate || uploadLoading}
                busy={genLoading}
                onClick={() => void handleGenerate()}
              >
                <Sparkles />
                {genLoading ? "Generating…" : candidates.length > 0 ? "Regenerate" : "Generate picture"}
              </KitButton>
              <input
                ref={uploadInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="sr-only"
                tabIndex={-1}
                aria-hidden="true"
                disabled={submitting || uploadLoading || genLoading}
                onChange={(e) => void handleUpload(e)}
              />
              <KitButton
                size="sm"
                variant="plain"
                disabled={submitting || genLoading}
                busy={uploadLoading}
                aria-label="Upload a picture"
                onClick={() => uploadInputRef.current?.click()}
              >
                <Upload />
                {uploadLoading ? "Uploading…" : "Upload…"}
              </KitButton>
            </div>
            {candidates.length > 0 && pickedId == null ? (
              <span className="k-help text-center">Pick one.</span>
            ) : !nameValid || !descriptionValid ? (
              <span className="k-help text-center">Name and describe the role to generate a picture.</span>
            ) : null}
            {genError && <span className="k-err">{genError}</span>}
            {uploadError && <span className="k-err">{uploadError}</span>}
          </div>

          <KitField label="Name" error={nameError}>
            <KitInput
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Meal Planner"
              disabled={submitting}
              data-testid="new-role-name"
            />
          </KitField>
          <KitField
            label="Description"
            help="Shown under the role's name. It also starts the role file — the first agent to hold the role fleshes out the rest."
          >
            <KitTextarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Plans the week's meals around what's in the fridge."
              disabled={submitting}
              rows={3}
              data-testid="new-role-description"
            />
          </KitField>
          <KitField label="Colour" htmlFor="new-role-color">
            <ColorPicker value={colorHue} onChange={(v) => !submitting && setColorHue(v)} id="new-role-color" disabled={submitting} />
          </KitField>
          {flatHosts.length !== 1 && (
            <KitField label="Host" htmlFor="new-role-host-search">
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
                searchId="new-role-host-search"
                emptyText={flatHosts.length === 0 ? "No hosts available" : undefined}
              />
            </KitField>
          )}
          {submitError && <KitBanner tone="danger">{submitError}</KitBanner>}
        </div>
      </ModalBody>
      <ModalFoot>
        <KitButton onClick={onBack} disabled={submitting} data-testid="new-role-cancel">
          Cancel
        </KitButton>
        <KitButton
          variant="primary"
          onClick={() => void handleCreate()}
          disabled={!canCreate}
          busy={submitting}
          data-testid="new-role-create"
        >
          {submitting ? "Creating role…" : "Create role"}
        </KitButton>
      </ModalFoot>
    </>
  );
}
