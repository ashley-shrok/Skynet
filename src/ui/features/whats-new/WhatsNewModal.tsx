// What's new — pops up once after an update when this person has notes they
// haven't seen (apple-ux shape-creation-and-search-dialogs). A sparkle tile
// and "What's new in <the instance's name>" on top, the notes as a grouped
// list newest first, one Continue at the foot. Closing it (Continue, X or
// Esc) marks every listed note seen; nothing shows when there is nothing new.
//
// The "seen" save can fail — most often because a deploy landed while the
// panel was open and the old tab's request is refused. The ids are kept in
// localStorage (per username) until the server confirms, and retried on the
// next load before asking what's new, so the same notes don't come back.

import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import { Modal, ModalHead, ModalBody, ModalFoot } from "@/components/modal";
import { KitButton } from "@/components/kit";
import { useBrandingConfig } from "@/branding/branding-store";
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
  const branding = useBrandingConfig();
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
      size="md"
      data-testid="whats-new-modal"
    >
      <ModalHead title={<span className="sr-only">What&apos;s new</span>} className="pb-0" />
      <ModalBody className="pt-0">
        <div className="flex flex-col items-center text-center gap-2 pb-5">
          <span className="k-hero-tile size-14 rounded-[16px]" aria-hidden="true">
            <Sparkles className="size-7" />
          </span>
          <h2 className="m-0 text-[22px] font-bold tracking-[-0.02em] text-[var(--k-t1)]" data-testid="whats-new-title">
            What&apos;s new in {branding.appName}
          </h2>
        </div>
        <ul className="k-group m-0 p-0 list-none" data-testid="whats-new-notes">
          {notes.map((note) => (
            <li
              key={note.id}
              data-testid="whats-new-note"
              className="k-row items-start gap-3 text-[14px] leading-relaxed text-[var(--k-t1)]"
            >
              <span className="mt-[9px] size-1.5 rounded-full bg-[var(--k-acc)] shrink-0" aria-hidden="true" />
              <span>{note.text}</span>
            </li>
          ))}
        </ul>
      </ModalBody>
      <ModalFoot>
        <KitButton variant="primary" full data-testid="whats-new-dismiss" onClick={close}>
          Continue
        </KitButton>
      </ModalFoot>
    </Modal>
  );
}
