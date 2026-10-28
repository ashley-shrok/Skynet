import { useEffect, useState } from "react";
import type { HostFolder } from "@/types/ui-types";
import SkillsEditorModal from "./SkillsEditorModal";
import {
  OPEN_SKILLS_EDITOR_EVENT,
  type SkillsEditorTarget,
} from "@/features/pretty-conversations/open-skills-editor";

// The Skills window opened on request (OPEN_SKILLS_EDITOR_EVENT) — the
// composer Skills menu's "New skill…" lands here with the new skill. Mounted
// by AppShell, which is always there; the sidebar's own copy (footer bolt)
// isn't mounted while a narrow window's sidebar sheet is closed.
export function RequestedSkillsEditor({ hostTree }: { hostTree: HostFolder | null }): React.JSX.Element {
  const [target, setTarget] = useState<SkillsEditorTarget | null>(null);
  useEffect(() => {
    const handle = (e: Event) => {
      const next = (e as CustomEvent<SkillsEditorTarget>).detail ?? null;
      console.info("[skills-editor] requested-open", next);
      setTarget(next);
    };
    window.addEventListener(OPEN_SKILLS_EDITOR_EVENT, handle);
    return () => window.removeEventListener(OPEN_SKILLS_EDITOR_EVENT, handle);
  }, []);
  return (
    <SkillsEditorModal
      open={target !== null}
      onOpenChange={(next) => {
        if (!next) setTarget(null);
      }}
      hostTree={hostTree}
      defaultHostId={target?.hostId ?? null}
      initialSkillName={target?.skill ?? null}
    />
  );
}
