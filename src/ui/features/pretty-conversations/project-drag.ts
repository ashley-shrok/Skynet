// project-drag — the drag payload for a sidebar project header.
//
// Dragging a project header onto another project's section nests it there;
// dropping it on the Projects super-header returns it to top level. During
// dragover the browser hides dataTransfer contents (only the MIME types are
// readable), so the dragged project is also held here for the duration of
// the drag — drop targets need it to decide whether to light up (a project's
// own subtree never does).

export const PROJECT_MIME = "application/x-skynet-project";

export interface DraggedProject {
  slug: string;
  hostId: string;
}

let current: DraggedProject | null = null;

export function startProjectDrag(dt: DataTransfer, project: DraggedProject): void {
  current = project;
  dt.setData(PROJECT_MIME, JSON.stringify(project));
  dt.effectAllowed = "move";
}

export function endProjectDrag(): void {
  current = null;
}

/** The project being dragged right now, or null. */
export function getDraggedProject(): DraggedProject | null {
  return current;
}

export function hasProjectMime(dt: DataTransfer | null | undefined): boolean {
  return !!dt && Array.from(dt.types).includes(PROJECT_MIME);
}
