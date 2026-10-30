/**
 * Admin → Hosts → a host → Files: the shared file explorer over the home
 * folder of the account the host's SSH login signs in as. Admin-only on the
 * server (the whole-host target); everything else — browse, open, edit,
 * upload, rename, delete, search — is the same explorer the agent, role and
 * project windows use.
 */

import { useRef } from "react";
import { ModalBody } from "@/components/modal";
import WorkspaceTab from "@/features/pretty-view/WorkspaceTab";
import { AdminBack, useEscBack } from "./admin-ui";

/** Same neutral hue the project window's Files tab tints against. */
const FILES_HUE = 220;

export function AdminHostFilesPane({
  name,
  hostId,
  onBack,
}: {
  name: string;
  hostId: number;
  onBack: () => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  useEscBack(true, onBack, rootRef);
  return (
    <ModalBody data-testid="admin-host-files-pane" className="pt-1 pb-0 flex flex-col">
      <div ref={rootRef} className="flex flex-col flex-1 min-h-0">
        <div className="shrink-0 pb-2">
          <AdminBack label={name} onBack={onBack} testId="admin-host-files-back" />
        </div>
        <div className="flex-1 min-h-0 overflow-hidden flex flex-col border-t border-[var(--k-hair)] -mx-6 max-sm:-mx-5">
          <WorkspaceTab
            key={hostId}
            target={{ kind: "host" }}
            hostId={hostId}
            hue={FILES_HUE}
            introCopy={`The home folder of the account this app signs in as on ${name}.`}
          />
        </div>
      </div>
    </ModalBody>
  );
}
