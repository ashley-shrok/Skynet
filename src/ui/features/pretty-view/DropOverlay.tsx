import { FolderX, Upload } from "lucide-react";
import { StatusOverlay } from "./StatusOverlay";

// Drop files: shown while files are dragged over the conversation, and for ~3s
// after a folder drop was refused (the upload hook owns that timer). Passive —
// PrettyView's root still receives the drop.

export interface DropOverlayProps {
  isDragOver: boolean;
  folderDropRejected: boolean;
}

export function DropOverlay({
  isDragOver,
  folderDropRejected,
}: DropOverlayProps) {
  if (folderDropRejected) {
    return (
      <StatusOverlay
        passive
        tone="warn"
        testId="drop-overlay-folder-nudge"
        icon={<FolderX className="pv-status-icon" aria-hidden="true" />}
        title="Please attach files or zip first"
        subline="Folders can't be uploaded"
      />
    );
  }
  if (!isDragOver) return null;
  return (
    <StatusOverlay
      passive
      testId="drop-overlay-drag"
      backdrop={<div className="pv-status-drop" aria-hidden="true" />}
      icon={<Upload className="pv-status-icon" aria-hidden="true" />}
      title="Drop files here"
    />
  );
}
