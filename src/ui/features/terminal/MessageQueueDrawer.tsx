import { useCallback, useEffect, useRef, useState } from "react";
import { Send, Trash2, Plus, X } from "lucide-react";
import { Button } from "@/components/button";
import { Textarea } from "@/components/textarea";
import { cn } from "@/lib/utils";
import {
  createMessageQueueItem,
  deleteMessageQueueItem,
  listMessageQueueItems,
  updateMessageQueueItem,
  type MessageQueueItem,
} from "@/api/message-queue-api";

interface MessageQueueDrawerProps {
  hostId: number;
  tmuxSession: string | null;
  onSend: (text: string) => boolean;
  onClose: () => void;
}

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
  const focusNewId = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    listMessageQueueItems({ hostId, tmuxSession })
      .then((rows) => {
        if (!cancelled) setItems(rows);
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
  }, []);

  const handleBlurSave = useCallback(
    async (id: string, body: string) => {
      try {
        await updateMessageQueueItem(id, { body });
      } catch (e) {
        setError(String((e as Error)?.message ?? e));
      }
    },
    [],
  );

  const handleDelete = useCallback(async (id: string) => {
    const prev = items;
    setItems((p) => p.filter((it) => it.id !== id));
    try {
      await deleteMessageQueueItem(id);
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
      setItems(prev);
    }
  }, [items]);

  const handleSend = useCallback(
    async (item: MessageQueueItem) => {
      const text = item.body;
      if (!text.trim()) return;
      const collapsed = text.replace(/\r?\n/g, " ");
      setSendingId(item.id);
      const ok = onSend(collapsed + "\r");
      setSendingId(null);
      if (!ok) {
        setError("Terminal not connected — message not sent");
        return;
      }
      setItems((p) => p.filter((it) => it.id !== item.id));
      try {
        await deleteMessageQueueItem(item.id);
      } catch (e) {
        setError(String((e as Error)?.message ?? e));
      }
    },
    [onSend],
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
            autoFocus={focusNewId.current === item.id}
            onFocusHandled={() => {
              if (focusNewId.current === item.id) focusNewId.current = null;
            }}
            onChange={handleBodyChange}
            onBlurSave={handleBlurSave}
            onDelete={handleDelete}
            onSend={handleSend}
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
  autoFocus: boolean;
  onFocusHandled: () => void;
  onChange: (id: string, body: string) => void;
  onBlurSave: (id: string, body: string) => void;
  onDelete: (id: string) => void;
  onSend: (item: MessageQueueItem) => void;
}

function MessageQueueRow({
  item,
  sending,
  autoFocus,
  onFocusHandled,
  onChange,
  onBlurSave,
  onDelete,
  onSend,
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
        onBlur={() => onBlurSave(item.id, item.body)}
        placeholder="Draft a message…"
        rows={2}
        className={cn("resize-none min-h-[44px] flex-1")}
      />
      <div className="flex flex-col gap-1">
        <Button
          size="sm"
          onClick={() => onSend(item)}
          disabled={bodyEmpty || sending}
          aria-label="Send message"
          title="Send"
        >
          <Send className="size-4" />
        </Button>
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
