/**
 * Admin → Instance file: edit the CLAUDE.md that every host gets at
 * /etc/claude-code/CLAUDE.md, so it loads into every agent session across the
 * instance. Saving pushes it to all hosts right away; new sessions pick it
 * up, running ones don't. Clearing it removes the file from every host.
 */

import { useEffect, useState } from "react";
import { getInstanceFile, saveInstanceFile } from "@/api/instance-file-api";
import { MarkdownEditor } from "@/features/pretty-view/MarkdownEditor";
import { KitBanner, KitButton, KitLoading } from "@/components/kit";
import { adminErrorMessage } from "./admin-ui";

export function AdminInstanceFilePane() {
  const [saved, setSaved] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getInstanceFile()
      .then((f) => {
        if (cancelled) return;
        setSaved(f.content);
        setDraft(f.content);
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoadError(adminErrorMessage(err, "Couldn't load the instance file."));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const f = await saveInstanceFile(draft);
      setSaved(f.content);
      setDraft(f.content);
      setJustSaved(true);
    } catch (err) {
      setSaveError(adminErrorMessage(err, "Save failed — please try again."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="flex flex-col h-full gap-3 px-6 py-5 max-sm:px-5"
      data-testid="admin-instance-file-pane"
    >
      <p className="m-0 text-[13px] text-[var(--k-t2)] leading-snug max-w-[520px] shrink-0">
        Everything here goes into every agent session on every host in this instance. Saving sends
        it out right away; agents pick it up the next time they start. Leave it empty to remove it
        from every host.
      </p>
      {loadError ? (
        <KitBanner tone="danger">{loadError}</KitBanner>
      ) : saved === null ? (
        <KitLoading label="Loading…" />
      ) : (
        <div className="flex flex-col flex-1 min-h-0 gap-2">
          <div className="flex items-center justify-end gap-3 shrink-0">
            {justSaved && draft === saved && (
              <span
                className="text-[13px] text-[var(--k-t2)]"
                data-testid="admin-instance-file-saved"
              >
                Saved — sending to hosts
              </span>
            )}
            <KitButton
              variant="primary"
              size="sm"
              data-testid="admin-instance-file-save"
              onClick={() => void handleSave()}
              busy={saving}
              disabled={draft === saved}
            >
              {saving ? "Saving…" : "Save"}
            </KitButton>
          </div>
          <div className="flex-1 min-h-0">
            <MarkdownEditor
              filename="CLAUDE.md"
              content={draft}
              onChange={(next) => {
                setDraft(next);
                setJustSaved(false);
              }}
              disabled={saving}
            />
          </div>
          {saveError && <KitBanner tone="danger">{saveError}</KitBanner>}
        </div>
      )}
    </div>
  );
}
