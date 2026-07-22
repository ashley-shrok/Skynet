import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pencil, Plus, RefreshCw, Trash2, Upload, Users } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/button";
import { Input } from "@/components/input";
import { AccordionSection } from "./AdminSettingsShared";
import {
  applyIdentityChange,
  refreshIdentities,
  useIdentities,
} from "@/state/identities-store";
import {
  createIdentity,
  deleteIdentity,
  updateIdentity,
  type Identity,
} from "@/api/identities-api";

// 40-hue palette at 9° gaps. Denser than the original 12 so a fleet with
// many identities can hand-pick distinct pane hues without collisions
// (with only 12 slots, four+ identities routinely landed on the same
// hue). Slot names are picked for hover-tooltip clarity; the actual
// rendered bubble at `hsla(H, 50%, 38%)` blurs perceptually-adjacent
// hues in dark realm, so some near-adjacent picks may look similar in
// the message stream even though their swatches look distinct. Further
// collision-reduction would need to layer saturation/lightness
// variants (thread `--pv-id-sat` / `--pv-id-light` through the
// consumer classes); punting that until we outgrow 40.
const SWATCH_HUES = [
  { hue: 0, label: "Red" },
  { hue: 9, label: "Scarlet" },
  { hue: 18, label: "Vermillion" },
  { hue: 27, label: "Orange" },
  { hue: 36, label: "Amber" },
  { hue: 45, label: "Gold" },
  { hue: 54, label: "Yellow" },
  { hue: 63, label: "Chartreuse" },
  { hue: 72, label: "Yellow-Green" },
  { hue: 81, label: "Lime" },
  { hue: 90, label: "Light Green" },
  { hue: 99, label: "Grass" },
  { hue: 108, label: "Kelly Green" },
  { hue: 117, label: "Green" },
  { hue: 126, label: "Emerald" },
  { hue: 135, label: "Forest" },
  { hue: 144, label: "Jade" },
  { hue: 153, label: "Teal" },
  { hue: 162, label: "Aqua" },
  { hue: 171, label: "Cyan" },
  { hue: 180, label: "Turquoise" },
  { hue: 189, label: "Sky Cyan" },
  { hue: 198, label: "Sky" },
  { hue: 207, label: "Azure" },
  { hue: 216, label: "Cornflower" },
  { hue: 225, label: "Blue" },
  { hue: 234, label: "Cobalt" },
  { hue: 243, label: "Deep Blue" },
  { hue: 252, label: "Indigo" },
  { hue: 261, label: "Blue Violet" },
  { hue: 270, label: "Violet" },
  { hue: 279, label: "Purple" },
  { hue: 288, label: "Magenta" },
  { hue: 297, label: "Orchid" },
  { hue: 306, label: "Fuchsia" },
  { hue: 315, label: "Hot Pink" },
  { hue: 324, label: "Pink" },
  { hue: 333, label: "Rose" },
  { hue: 342, label: "Cherry" },
  { hue: 351, label: "Coral" },
];
const IDENTITY_KEY_RE = /^[a-z0-9._=/+-]+$/;
const MAX_AVATAR_BYTES = 2 * 1024 * 1024;
const ALLOWED_MIME_RE = /^image\/(png|jpeg|webp)$/;

type FormState = {
  editingId: string | null;
  identityKey: string;
  displayName: string;
  title: string;
  colorHue: number | null;
  avatarFile: File | null;
  previewUrl: string | null;
  saving: boolean;
};

function blankForm(): FormState {
  return {
    editingId: null,
    identityKey: "",
    displayName: "",
    title: "",
    colorHue: null,
    avatarFile: null,
    previewUrl: null,
    saving: false,
  };
}

function swatchStyle(hue: number | null): React.CSSProperties {
  if (hue == null) return { background: "transparent" };
  return { background: `hsl(${hue}, 70%, 50%)` };
}

export function AdminIdentitiesSection({
  open,
  onToggle,
}: {
  open: boolean;
  onToggle: () => void;
}) {
  const { t } = useTranslation();
  const { identities, loaded, refresh } = useIdentities();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<FormState>(blankForm());
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const objectUrlRef = useRef<string | null>(null);

  useEffect(() => {
    return () => {
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    };
  }, []);

  const sortedIdentities = useMemo(
    () =>
      identities
        .slice()
        .sort((a, b) => a.identityKey.localeCompare(b.identityKey)),
    [identities],
  );

  function resetForm() {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
    setForm(blankForm());
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function openCreate() {
    resetForm();
    setShowForm(true);
  }

  function openEdit(identity: Identity) {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
    setForm({
      editingId: identity.id,
      identityKey: identity.identityKey,
      displayName: identity.displayName,
      title: identity.title ?? "",
      colorHue: identity.colorHue,
      avatarFile: null,
      previewUrl: identity.avatarUrl,
      saving: false,
    });
    setShowForm(true);
  }

  function pickFile(file: File | null) {
    if (!file) return;
    if (!ALLOWED_MIME_RE.test(file.type)) {
      toast.error("Avatar must be PNG, JPEG, or WebP");
      return;
    }
    if (file.size > MAX_AVATAR_BYTES) {
      toast.error("Avatar exceeds 2 MB limit");
      return;
    }
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    const url = URL.createObjectURL(file);
    objectUrlRef.current = url;
    setForm((f) => ({ ...f, avatarFile: file, previewUrl: url }));
  }

  async function handleSave() {
    const editing = form.editingId != null;
    const identityKey = form.identityKey.trim().toLowerCase();
    const displayName = form.displayName.trim();
    if (!editing) {
      if (!identityKey || !IDENTITY_KEY_RE.test(identityKey)) {
        toast.error("Identity key must match [a-z0-9._=/+-]+");
        return;
      }
      if (!form.avatarFile) {
        toast.error("Avatar image is required");
        return;
      }
    }
    if (!displayName) {
      toast.error("Display name is required");
      return;
    }
    setForm((f) => ({ ...f, saving: true }));
    try {
      let next: Identity;
      if (editing && form.editingId) {
        next = await updateIdentity(
          form.editingId,
          {
            displayName,
            title: form.title.trim() || null,
            colorHue: form.colorHue,
          },
          form.avatarFile,
        );
      } else {
        next = await createIdentity(
          {
            identityKey,
            displayName,
            title: form.title.trim() || null,
            colorHue: form.colorHue,
          },
          form.avatarFile as File,
        );
      }
      applyIdentityChange(next);
      toast.success(editing ? "Identity updated" : "Identity created");
      setShowForm(false);
      resetForm();
    } catch (e) {
      const message =
        e instanceof Error ? e.message : "Failed to save identity";
      toast.error(message);
    } finally {
      setForm((f) => ({ ...f, saving: false }));
    }
  }

  async function handleDelete(identity: Identity) {
    if (
      !window.confirm(
        `Delete identity "${identity.displayName}"? This cannot be undone.`,
      )
    ) {
      return;
    }
    try {
      await deleteIdentity(identity.id);
      applyIdentityChange(null, identity.id);
      toast.success("Identity deleted");
    } catch {
      toast.error("Failed to delete identity");
    }
  }

  return (
    <AccordionSection
      label={t("admin.sectionIdentities", "Identities")}
      icon={<Users className="size-3.5" />}
      open={open}
      onToggle={onToggle}
    >
      <div className="flex flex-col pt-2">
        <div className="flex items-center justify-between py-2 border-b border-border">
          <span className="text-[10px] text-muted-foreground">
            {sortedIdentities.length}{" "}
            {sortedIdentities.length === 1 ? "identity" : "identities"}
            {!loaded && " (loading…)"}
          </span>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="size-6 text-muted-foreground hover:text-foreground"
              onClick={() => void refresh()}
            >
              <RefreshCw className="size-3" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-6 text-[10px] border-accent-brand/40 text-accent-brand hover:bg-accent-brand/10 hover:text-accent-brand"
              onClick={openCreate}
            >
              <Plus className="size-3" />
              Add identity
            </Button>
          </div>
        </div>

        {showForm && (
          <div className="flex flex-col gap-2.5 py-3 border-b border-border">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
              {form.editingId ? "Edit identity" : "New identity"}
            </span>

            <div className="flex gap-3 items-start">
              <div
                className="size-16 border border-border bg-muted/30 overflow-hidden flex items-center justify-center shrink-0"
                style={{ borderRadius: 4 }}
              >
                {form.previewUrl ? (
                  <img
                    src={form.previewUrl}
                    alt="avatar preview"
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <Upload className="size-5 text-muted-foreground" />
                )}
              </div>
              <div className="flex flex-col gap-1 flex-1">
                <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">
                  Avatar{!form.editingId && (
                    <span className="text-accent-brand"> *</span>
                  )}
                </label>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={(e) =>
                    pickFile(e.target.files ? e.target.files[0] : null)
                  }
                  className="text-[10px] text-muted-foreground"
                />
                <span className="text-[9px] text-muted-foreground">
                  PNG / JPEG / WebP, up to 2 MB
                </span>
              </div>
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">
                Identity key <span className="text-accent-brand">*</span>
              </label>
              <Input
                placeholder="e.g. tina"
                value={form.identityKey}
                disabled={form.editingId != null}
                onChange={(e) =>
                  setForm((f) => ({ ...f, identityKey: e.target.value }))
                }
                onBlur={(e) =>
                  setForm((f) => ({
                    ...f,
                    identityKey: e.target.value.trim().toLowerCase(),
                  }))
                }
                className="text-xs"
              />
              <span className="text-[9px] text-muted-foreground">
                Matched against the first dash-separated word of the tmux
                session name. Lowercase, no spaces.
              </span>
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">
                Display name <span className="text-accent-brand">*</span>
              </label>
              <Input
                placeholder="e.g. Tina"
                value={form.displayName}
                onChange={(e) =>
                  setForm((f) => ({ ...f, displayName: e.target.value }))
                }
                className="text-xs"
              />
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">
                Title
              </label>
              <Input
                placeholder="optional, e.g. Skynet maintainer"
                value={form.title}
                onChange={(e) =>
                  setForm((f) => ({ ...f, title: e.target.value }))
                }
                className="text-xs"
              />
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">
                Idle pulse color
              </label>
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, colorHue: null }))}
                  className={`size-6 border ${form.colorHue == null ? "border-accent-brand" : "border-border"} flex items-center justify-center`}
                  title="No color — derive from name"
                >
                  <span className="text-[9px] text-muted-foreground">auto</span>
                </button>
                {SWATCH_HUES.map((s) => (
                  <button
                    key={s.hue}
                    type="button"
                    onClick={() =>
                      setForm((f) => ({ ...f, colorHue: s.hue }))
                    }
                    className={`size-6 border ${form.colorHue === s.hue ? "border-accent-brand" : "border-border"}`}
                    style={swatchStyle(s.hue)}
                    title={s.label}
                  />
                ))}
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <Button
                variant="ghost"
                size="sm"
                className="text-xs"
                onClick={() => {
                  setShowForm(false);
                  resetForm();
                }}
                disabled={form.saving}
              >
                Cancel
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="text-xs border-accent-brand/40 text-accent-brand hover:bg-accent-brand/10 hover:text-accent-brand"
                onClick={handleSave}
                disabled={form.saving}
              >
                {form.saving
                  ? "Saving…"
                  : form.editingId
                    ? "Save changes"
                    : "Create identity"}
              </Button>
            </div>
          </div>
        )}

        {sortedIdentities.map((identity) => (
          <div
            key={identity.id}
            className="flex items-center gap-2 py-2.5 border-b border-border last:border-0"
          >
            <img
              src={identity.avatarUrl}
              alt={identity.displayName}
              className="size-10 object-cover shrink-0"
              style={{ borderRadius: 4 }}
            />
            <div className="flex flex-col gap-0.5 min-w-0 flex-1">
              <span className="text-xs font-semibold truncate">
                {identity.displayName}
              </span>
              <span className="text-[10px] text-muted-foreground truncate">
                {identity.identityKey}
                {identity.title ? ` · ${identity.title}` : ""}
              </span>
            </div>
            <div
              className="size-4 border border-border shrink-0"
              style={swatchStyle(identity.colorHue)}
              title={
                identity.colorHue == null
                  ? "auto color"
                  : `hue ${identity.colorHue}`
              }
            />
            <Button
              variant="ghost"
              size="icon"
              className="size-6 text-muted-foreground hover:text-foreground shrink-0"
              onClick={() => openEdit(identity)}
            >
              <Pencil className="size-3" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-6 text-muted-foreground hover:text-destructive shrink-0"
              onClick={() => void handleDelete(identity)}
            >
              <Trash2 className="size-3" />
            </Button>
          </div>
        ))}
      </div>
    </AccordionSection>
  );
}
