import { useCallback, useEffect, useRef, useState } from "react";
import { Send, Trash2, Plus, X, RotateCw } from "lucide-react";
import { Button } from "@/components/button";
import { Textarea } from "@/components/textarea";
import { cn } from "@/lib/utils";
import {
  createMessageQueueItem,
  deleteMessageQueueItem,
  flushMessageQueueItemKeepalive,
  listMessageQueueItems,
  updateMessageQueueItem,
  type MessageQueueItem,
} from "@/api/message-queue-api";

interface MessageQueueDrawerProps {
  hostId: number;
  tmuxSession: string | null;
  onSend: (text: string, messageQueueItemId: string) => boolean;
  onClose: () => void;
}

// Draft persistence: every keystroke schedules a debounced PATCH. Blur
// flushes it immediately. On page unload we also fire keepalive PATCHes
// for any drafts still dirty (browser-tab close, refresh, wifi flap
// mid-typing). Sub-second worst-case save latency.
const DEBOUNCE_MS = 400;

export function MessageQueueDrawer({
  hostId,
  tmuxSession,
  onSend,
  onClose,
}: MessageQueueDrawerProps) {
  const [items, setItems] = useState<MessageQueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sendingId, setSendingId] = useState<string | null>(null);
  // Items where the WS send succeeded but the server-side DELETE failed.
  // We keep the row visible in "sent, cleanup pending" state so it's not
  // re-sent by accident, and expose a Retry-cleanup button.
  const [sentPendingIds, setSentPendingIds] = useState<Set<string>>(new Set());
  const focusNewId = useRef<string | null>(null);

  // Per-item debounce timers + latest-body cache. Refs, not state — these
  // are pure I/O bookkeeping and should never trigger re-render.
  const debounceTimersRef = useRef<
    Map<string, ReturnType<typeof setTimeout>>
  >(new Map());
  const dirtyBodiesRef = useRef<Map<string, string>>(new Map());

  const clearDebounceFor = useCallback((id: string) => {
    const t = debounceTimersRef.current.get(id);
    if (t) {
      clearTimeout(t);
      debounceTimersRef.current.delete(id);
    }
  }, []);

  const flushDirty = useCallback(async (id: string) => {
    clearDebounceFor(id);
    const body = dirtyBodiesRef.current.get(id);
    if (body === undefined) return;
    dirtyBodiesRef.current.delete(id);
    try {
      await updateMessageQueueItem(id, { body });
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
      // Put it back so the next flush/pagehide can retry it.
      dirtyBodiesRef.current.set(id, body);
    }
  }, [clearDebounceFor]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    listMessageQueueItems({ hostId, tmuxSession })
      .then(async (rows) => {
        if (cancelled) return;
        setItems(rows);
        if (rows.length === 0) {
          try {
            const created = await createMessageQueueItem({ hostId, tmuxSession });
            if (cancelled) return;
            focusNewId.current = created.id;
            setItems([created]);
          } catch (e) {
            if (!cancelled) setError(String((e as Error)?.message ?? e));
          }
        }
      })
      .catch((e) => {
        if (!cancelled) setError(String(e?.message ?? e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [hostId, tmuxSession]);

  // Best-effort flush on tab close / refresh / navigation. pagehide fires
  // for all unload paths incl. bfcache; visibilitychange→hidden catches
  // mobile-Safari-style backgrounding where pagehide is unreliable.
  // Iterates dirtyBodiesRef (the source of truth for what needs saving) so
  // the failed-and-re-queued case is covered — a body put back by
  // flushDirty's .catch path has no corresponding timer but still needs
  // flushing. Clears both maps after.
  useEffect(() => {
    const flushAllKeepalive = () => {
      for (const [id, body] of dirtyBodiesRef.current) {
        flushMessageQueueItemKeepalive(id, body);
      }
      for (const timer of debounceTimersRef.current.values()) {
        clearTimeout(timer);
      }
      debounceTimersRef.current.clear();
      dirtyBodiesRef.current.clear();
    };
    const onVis = () => {
      if (document.visibilityState === "hidden") flushAllKeepalive();
    };
    window.addEventListener("pagehide", flushAllKeepalive);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.removeEventListener("pagehide", flushAllKeepalive);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  // Failed saves put the body back in dirtyBodiesRef with no timer.
  // Without this interval, those bodies would only get another chance on
  // the next keystroke (which resets a new debounce) or on pagehide/
  // unmount. 10s interval retry closes the gap so a transient network
  // blip during autosave doesn't leave a dirty body sitting until the
  // user closes the tab.
  useEffect(() => {
    const interval = setInterval(() => {
      for (const id of dirtyBodiesRef.current.keys()) {
        void flushDirty(id);
      }
    }, 10000);
    return () => clearInterval(interval);
  }, [flushDirty]);

  // On unmount (drawer closed, host switched): flush every dirty body
  // (with or without a pending debounce timer) via keepalive so it
  // survives if the whole tab is going down at the same time as the
  // drawer closing. Iterates dirtyBodiesRef (source of truth) to cover
  // the failed-and-re-queued case where a body was put back with no
  // corresponding timer. Clears both maps after.
  useEffect(() => {
    return () => {
      for (const [id, body] of dirtyBodiesRef.current) {
        flushMessageQueueItemKeepalive(id, body);
      }
      for (const timer of debounceTimersRef.current.values()) {
        clearTimeout(timer);
      }
      debounceTimersRef.current.clear();
      dirtyBodiesRef.current.clear();
    };
  }, []);

  // Mirror `items` into a ref so the unmount cleanup reads the LATEST
  // items without re-firing on every items change.
  const itemsRef = useRef(items);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  // On unmount, delete any drafts with an empty body. Patch #41 auto-primes
  // an empty draft when the drawer opens on an empty-list, and without this
  // cleanup that empty draft persists on the server — later triggering the
  // drawer's auto-open gate in Terminal.tsx as if the queue had real
  // content. Cleanup fires BEFORE the keepalive-flush cleanup above (React
  // runs cleanups in reverse effect order), so we check `item.body` from
  // React state — which reflects the latest local typing even if the
  // debounced server-side save hasn't fired yet. Any body with non-empty
  // trim survives; only genuinely-empty drafts are removed.
  useEffect(() => {
    return () => {
      for (const item of itemsRef.current) {
        if (item.body.trim().length === 0) {
          deleteMessageQueueItem(item.id).catch(() => {
            // Best-effort. Any leftover empty item is caught by the
            // auto-open filter in Terminal.tsx as belt-and-braces.
          });
        }
      }
    };
  }, []);

  const handleAdd = useCallback(async () => {
    try {
      const created = await createMessageQueueItem({ hostId, tmuxSession });
      focusNewId.current = created.id;
      setItems((prev) => [...prev, created]);
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
    }
  }, [hostId, tmuxSession]);

  const handleBodyChange = useCallback((id: string, body: string) => {
    setItems((prev) =>
      prev.map((it) => (it.id === id ? { ...it, body } : it)),
    );
    dirtyBodiesRef.current.set(id, body);
    const existing = debounceTimersRef.current.get(id);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      debounceTimersRef.current.delete(id);
      const latest = dirtyBodiesRef.current.get(id);
      if (latest === undefined) return;
      dirtyBodiesRef.current.delete(id);
      updateMessageQueueItem(id, { body: latest }).catch((e) => {
        setError(String((e as Error)?.message ?? e));
        // Re-queue for the next flush chance.
        dirtyBodiesRef.current.set(id, latest);
      });
    }, DEBOUNCE_MS);
    debounceTimersRef.current.set(id, timer);
  }, []);

  const handleBlurSave = useCallback(
    (id: string) => {
      // fire-and-forget — the flushDirty inside awaits internally
      void flushDirty(id);
    },
    [flushDirty],
  );

  const handleDelete = useCallback(async (id: string) => {
    clearDebounceFor(id);
    dirtyBodiesRef.current.delete(id);
    const prev = items;
    setItems((p) => p.filter((it) => it.id !== id));
    setSentPendingIds((p) => {
      if (!p.has(id)) return p;
      const next = new Set(p);
      next.delete(id);
      return next;
    });
    try {
      await deleteMessageQueueItem(id);
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
      setItems(prev);
    }
  }, [items, clearDebounceFor]);

  const handleRetryCleanup = useCallback(async (id: string) => {
    setSendingId(id);
    try {
      await deleteMessageQueueItem(id);
      setItems((p) => p.filter((it) => it.id !== id));
      setSentPendingIds((p) => {
        const next = new Set(p);
        next.delete(id);
        return next;
      });
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
    } finally {
      setSendingId(null);
    }
  }, []);

  const handleSend = useCallback(
    async (item: MessageQueueItem) => {
      await flushDirty(item.id);

      const text = item.body;
      if (!text.trim()) return;
      const collapsed = text.replace(/\r?\n/g, " ");
      setSendingId(item.id);
      const ok = onSend(collapsed, item.id);
      if (!ok) {
        setSendingId(null);
        setError("Terminal not connected — message not sent");
        return;
      }
      // Patch #60: no HTTP DELETE. The onSend WS payload carried the item
      // id in its second event (the \r), so the backend deleted the row
      // atomically as part of the input handler. Local state removal is
      // authoritative — if the backend delete somehow failed (extremely
      // narrow: WS delivered but DB write threw), the row shows up on
      // next load and the trash button handles it.
      setItems((p) => {
        const next = p.filter((it) => it.id !== item.id);
        if (next.length === 0) onClose?.();
        return next;
      });
      setSendingId(null);
    },
    [onSend, flushDirty, onClose],
  );

  return (
    <div
      className="flex-shrink-0 border-t border-border bg-card text-card-foreground flex flex-col"
      style={{ height: 240 }}
    >
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-bold">Message queue</span>
          <span className="text-xs text-muted-foreground">
            {items.length} {items.length === 1 ? "item" : "items"}
          </span>
        </div>
        <Button
          size="sm"
          variant="ghost"
          onClick={onClose}
          aria-label="Close message queue"
        >
          <X className="size-4" />
        </Button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-3 py-2 flex flex-col gap-2">
        {loading && (
          <div className="text-xs text-muted-foreground">Loading…</div>
        )}
        {error && (
          <div className="text-xs text-destructive">{error}</div>
        )}
        {!loading && items.length === 0 && (
          <div className="text-xs text-muted-foreground">
            No queued messages. Prep one below.
          </div>
        )}
        {items.map((item) => (
          <MessageQueueRow
            key={item.id}
            item={item}
            sending={sendingId === item.id}
            sentPending={sentPendingIds.has(item.id)}
            autoFocus={focusNewId.current === item.id}
            onFocusHandled={() => {
              if (focusNewId.current === item.id) focusNewId.current = null;
            }}
            onChange={handleBodyChange}
            onBlurSave={handleBlurSave}
            onDelete={handleDelete}
            onSend={handleSend}
            onRetryCleanup={handleRetryCleanup}
          />
        ))}
      </div>

      <div className="border-t border-border px-3 py-2 flex justify-end">
        <Button size="sm" variant="outline" onClick={handleAdd}>
          <Plus className="size-4 mr-1" />
          Add message
        </Button>
      </div>
    </div>
  );
}

interface RowProps {
  item: MessageQueueItem;
  sending: boolean;
  sentPending: boolean;
  autoFocus: boolean;
  onFocusHandled: () => void;
  onChange: (id: string, body: string) => void;
  onBlurSave: (id: string) => void;
  onDelete: (id: string) => void;
  onSend: (item: MessageQueueItem) => void;
  onRetryCleanup: (id: string) => void;
}

function MessageQueueRow({
  item,
  sending,
  sentPending,
  autoFocus,
  onFocusHandled,
  onChange,
  onBlurSave,
  onDelete,
  onSend,
  onRetryCleanup,
}: RowProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (autoFocus && textareaRef.current) {
      textareaRef.current.focus();
      onFocusHandled();
    }
  }, [autoFocus, onFocusHandled]);

  const bodyEmpty = item.body.trim().length === 0;

  return (
    <div className="flex gap-2 items-stretch">
      <Textarea
        ref={textareaRef}
        value={item.body}
        onChange={(e) => onChange(item.id, e.target.value)}
        onBlur={() => onBlurSave(item.id)}
        placeholder="Draft a message…"
        rows={2}
        readOnly={sentPending}
        className={cn(
          "resize-none min-h-[44px] flex-1",
          sentPending && "border-destructive",
        )}
      />
      <div className="flex flex-col gap-1">
        {sentPending ? (
          <Button
            size="sm"
            variant="destructive"
            onClick={() => onRetryCleanup(item.id)}
            disabled={sending}
            aria-label="Retry cleanup"
            title="Sent to terminal — retry server cleanup"
          >
            <RotateCw className="size-4" />
          </Button>
        ) : (
          <Button
            size="sm"
            onClick={() => onSend(item)}
            disabled={bodyEmpty || sending}
            aria-label="Send message"
            title="Send"
          >
            <Send className="size-4" />
          </Button>
        )}
        <Button
          size="sm"
          variant="outline"
          onClick={() => onDelete(item.id)}
          aria-label="Delete message"
          title="Delete"
        >
          <Trash2 className="size-4" />
        </Button>
      </div>
    </div>
  );
}
