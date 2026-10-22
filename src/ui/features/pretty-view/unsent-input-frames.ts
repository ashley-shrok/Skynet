// Recovers compose sends that never left the browser when the session WS dies.
//
// A send whose WS drops (code 1006) a beat after ws.send() is still sitting in
// the socket's outbound buffer — the bytes never reached the server, so the
// message is gone unless the client sends it again. Resending blindly would
// duplicate the message whenever the bytes DID go out (the server has no
// cross-connection mqid dedupe), so we resend only frames that provably never
// left: every byte queued on the socket is counted, and at close
// `queued - ws.bufferedAmount` is how far transmission got (bufferedAmount does
// not reset when the socket closes). A frame that starts at or past that point
// was never transmitted.

const queuedBytes = new WeakMap<WebSocket, number>();
const encoder = new TextEncoder();

type SendData = string | ArrayBufferLike | Blob | ArrayBufferView;

export function outboundByteLength(data: SendData): number {
  if (typeof data === "string") return encoder.encode(data).length;
  if (data instanceof Blob) return data.size;
  return (data as ArrayBufferLike | ArrayBufferView).byteLength;
}

// Wraps ws.send so every frame queued on this socket — from any caller,
// including the upload hook — is counted. Call once, right after creating it.
// Only real sockets are tracked: a stand-in has no meaningful bufferedAmount
// (and test doubles keep their own send spies).
export function trackOutboundBytes(ws: WebSocket): void {
  if (typeof WebSocket === "undefined" || !(ws instanceof WebSocket)) return;
  queuedBytes.set(ws, 0);
  const rawSend = ws.send.bind(ws);
  ws.send = (data: SendData) => {
    rawSend(data);
    queuedBytes.set(ws, (queuedBytes.get(ws) ?? 0) + outboundByteLength(data));
  };
}

// Total bytes queued on ws so far (0 for an untracked socket).
export function queuedOutboundBytes(ws: WebSocket): number {
  return queuedBytes.get(ws) ?? 0;
}

export type InputFrameRecord = {
  mqid: string;
  text: string;
  skipTagNeutralize: boolean;
  ws: WebSocket;
  // Byte offset of the frame's first byte in the socket's outbound stream.
  start: number;
};

// Of the given records, those on `ws` whose bytes never left the browser,
// oldest first. `bufferedAmount` is ws.bufferedAmount read at close. An
// untracked socket proves nothing, so nothing is selected.
export function selectUnsentFrames(
  records: InputFrameRecord[],
  ws: WebSocket,
  bufferedAmount: number,
): InputFrameRecord[] {
  const queued = queuedBytes.get(ws);
  if (queued === undefined) return [];
  const transmitted = queued - bufferedAmount;
  return records
    .filter((r) => r.ws === ws && r.start >= transmitted)
    .sort((a, b) => a.start - b.start);
}
