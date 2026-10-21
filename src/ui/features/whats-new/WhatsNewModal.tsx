// What's new — pops up once after an update when this person has notes they
// haven't seen. One flat list, newest first. Closing it (button, X or Esc)
// marks every listed note seen; nothing shows when there is nothing new.

import { useEffect, useState } from "react";
import { Button } from "@/components/button";
import { Modal, ModalHead, ModalBody, ModalFoot } from "@/components/modal";
import {
  getWhatsNew,
  markWhatsNewSeen,
  type WhatsNewNote,
} from "./whats-new-api";

export function WhatsNewModal() {
  const [notes, setNotes] = useState<WhatsNewNote[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getWhatsNew()
      .then((unseen) => {
        if (cancelled || unseen.length === 0) return;
        console.info("[whats-new] showing unseen notes", {
          ids: unseen.map((n) => n.id),
        });
        setNotes(unseen);
        setOpen(true);
      })
      .catch((err: unknown) => {
        console.warn("[whats-new] fetch failed; not showing", {
          error: err instanceof Error ? err.message : String(err),
        });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const close = () => {
    if (!open) return;
    setOpen(false);
    const ids = notes.map((n) => n.id);
    markWhatsNewSeen(ids).catch((err: unknown) => {
      console.warn("[whats-new] mark-seen failed", {
        ids,
        error: err instanceof Error ? err.message : String(err),
      });
    });
  };

  if (notes.length === 0) return null;

  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        if (!next) close();
      }}
      size="lg"
      data-testid="whats-new-modal"
    >
      <ModalHead title="What's new" />
      <ModalBody>
        <ul className="flex flex-col gap-2.5 list-disc pl-5 text-sm leading-relaxed">
          {notes.map((note) => (
            <li key={note.id} data-testid="whats-new-note">
              {note.text}
            </li>
          ))}
        </ul>
      </ModalBody>
      <ModalFoot>
        <Button
          type="button"
          variant="default"
          data-testid="whats-new-dismiss"
          onClick={close}
          className="cursor-pointer h-8"
        >
          Got it
        </Button>
      </ModalFoot>
    </Modal>
  );
}
