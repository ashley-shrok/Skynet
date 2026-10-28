// App-wide request to open the Skills window on one host with one skill
// open — the composer Skills menu's "New skill…" row lands here after
// making the skill. AppShell's RequestedSkillsEditor answers it; the composer
// lives in PrettyView, so it asks through a window event.

export const OPEN_SKILLS_EDITOR_EVENT = "skynet:open-skills-editor";

export interface SkillsEditorTarget {
  hostId: number;
  skill: string;
}

export function requestOpenSkillsEditor(target: SkillsEditorTarget): void {
  console.info("[skills-editor] open requested", target);
  window.dispatchEvent(
    new CustomEvent<SkillsEditorTarget>(OPEN_SKILLS_EDITOR_EVENT, { detail: target }),
  );
}
