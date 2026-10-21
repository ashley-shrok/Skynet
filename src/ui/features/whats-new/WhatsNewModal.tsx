// What's new — pops up once after an update when this person has notes they
// haven't seen. One flat list, newest first. Closing it (button, X or Esc)
// marks every listed note seen; nothing shows when there is nothing new.
//
// The "seen" save can fail — most often because a deploy landed while the
// panel was open and the old tab's request is refused. The ids are kept in
// localStorage (per username) until the server confirms, and retried on the
// next load before asking what's new, so the same notes don't come back.

import { useEffect, useState } from "react";
import { Button } from "@/components/button";
import { Modal, ModalHead, ModalBody, ModalFoot } from "@/components/modal";
import {
  getWhatsNew,
  markWhatsNewSeen,
  type WhatsNewNote,
} from "./whats-new-api";

const pendingKey = (username: string) => `skynet-whats-new-pending-seen:${username}`;

function readPending(username: string): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(pendingKey(username)) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

async function flushSeen(username: string, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  localStorage.setItem(pendingKey(username), JSON.stringify(ids));
  await markWhatsNewSeen(ids);
  localStorage.removeItem(pendingKey(username));
}

export function WhatsNewModal({ username }: { username: string }) {
  const [notes, setNotes] = useState<WhatsNewNote[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const pending = readPending(username);
    flushSeen(username, pending)
      .catch((err: unknown) => {
        console.warn("[whats-new] retrying pending mark-seen failed", {
          ids: pending,
          error: err instanceof Error ? err.message : String(err),
        });
      })
      .then(() => getWhatsNew())
      .then((unseen) => {
        // Anything still pending (retry failed) was already read — don't re-show it.
        const stillPending = new Set(readPending(username));
        const fresh = unseen.filter((n) => !stillPending.has(n.id));
        if (cancelled || fresh.length === 0) return;
        console.info("[whats-new] showing unseen notes", {
          ids: fresh.map((n) => n.id),
        });
        setNotes(fresh);
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
  }, [username]);

  const close = () => {
    if (!open) return;
    setOpen(false);
    const ids = [...new Set([...readPending(username), ...notes.map((n) => n.id)])];
    flushSeen(username, ids).catch((err: unknown) => {
      console.warn("[whats-new] mark-seen failed; will retry on next load", {
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
