import { describe, it, expect } from "vitest";
import {
  CHUNK_SIZE_BYTES,
  INJECTED_DELIMITER,
  MAX_CONCURRENT_UPLOADS_PER_BATCH,
  MAX_PER_BATCH_BYTES,
  MAX_PER_FILE_BYTES,
  formatHumanSize,
  formatInjectedUserTurn,
  parseInjectedUserTurn,
  sanitizeFilenameForUpload,
  type PrettyViewUploadClientPayload,
  type PrettyViewUploadServerEvent,
  type UploadAbortPayload,
  type UploadChunkPayload,
  type UploadCompleteEvent,
  type UploadFailedEvent,
  type UploadFailureReason,
  type UploadProgressEvent,
  type UploadReadyToInjectEvent,
  type UploadStartPayload,
} from "./pretty-view-upload-protocol.js";

// Test A: types compile against a fixture (`satisfies` clauses do the work).
describe("wire-protocol types compile against fixtures", () => {
  it("accepts every payload / event shape", () => {
    const startPayload = {
      type: "upload_start",
      messageQueueItemId: "mqid-1",
      files: [
        { tempId: "t1", filename: "log.txt", size: 100, mimetype: "text/plain" },
      ],
    } satisfies UploadStartPayload;

    const chunkPayload = {
      type: "upload_chunk",
      messageQueueItemId: "mqid-1",
      tempId: "t1",
      offset: 0,
      bytes: "aGVsbG8=",
    } satisfies UploadChunkPayload;

    const abortAll = {
      type: "upload_abort",
      messageQueueItemId: "mqid-1",
    } satisfies UploadAbortPayload;

    const abortOne = {
      type: "upload_abort",
      messageQueueItemId: "mqid-1",
      tempId: "t1",
    } satisfies UploadAbortPayload;

    const progress = {
      type: "upload_progress",
      messageQueueItemId: "mqid-1",
      tempId: "t1",
      bytesReceived: 32,
      total: 100,
    } satisfies UploadProgressEvent;

    const complete = {
      type: "upload_complete",
      messageQueueItemId: "mqid-1",
      tempId: "t1",
      landingPath: "/home/ash/pretty-view-uploads/2026-07-20/143211-log.txt",
      uploadTimestamp: "2026-07-20T14:32:11",
    } satisfies UploadCompleteEvent;

    const failed = {
      type: "upload_failed",
      messageQueueItemId: "mqid-1",
      tempId: "t1",
      reason: "invalid_filename" as UploadFailureReason,
      message: "bad",
    } satisfies UploadFailedEvent;

    const ready = {
      type: "upload_ready_to_inject",
      messageQueueItemId: "mqid-1",
      files: [
        {
          tempId: "t1",
          filename: "log.txt",
          size: 100,
          mimetype: "text/plain",
          landingPath: "/home/ash/pretty-view-uploads/2026-07-20/143211-log.txt",
          uploadTimestamp: "2026-07-20T14:32:11",
        },
      ],
    } satisfies UploadReadyToInjectEvent;

    const clientUnion: PrettyViewUploadClientPayload = startPayload;
    const serverUnion: PrettyViewUploadServerEvent = ready;

    // Reference every binding so `noUnusedLocals` doesn't complain
    expect(startPayload.type).toBe("upload_start");
    expect(chunkPayload.type).toBe("upload_chunk");
    expect(abortAll.type).toBe("upload_abort");
    expect(abortOne.type).toBe("upload_abort");
    expect(progress.type).toBe("upload_progress");
    expect(complete.type).toBe("upload_complete");
    expect(failed.type).toBe("upload_failed");
    expect(ready.type).toBe("upload_ready_to_inject");
    expect(clientUnion.type).toBe("upload_start");
    expect(serverUnion.type).toBe("upload_ready_to_inject");
  });
});

// Test E: constants exported at exactly the locked values.
describe("constants", () => {
  it("MAX_PER_FILE_BYTES = 500 MB", () => {
    expect(MAX_PER_FILE_BYTES).toBe(500 * 1024 * 1024);
  });
  it("MAX_PER_BATCH_BYTES = 2 GB", () => {
    expect(MAX_PER_BATCH_BYTES).toBe(2 * 1024 * 1024 * 1024);
  });
  it("CHUNK_SIZE_BYTES = 64 KB", () => {
    expect(CHUNK_SIZE_BYTES).toBe(64 * 1024);
  });
  it("MAX_CONCURRENT_UPLOADS_PER_BATCH = 3", () => {
    expect(MAX_CONCURRENT_UPLOADS_PER_BATCH).toBe(3);
  });
  it("INJECTED_DELIMITER = --- attached files ---", () => {
    expect(INJECTED_DELIMITER).toBe("--- attached files ---");
  });
});

// Test D: human-readable size formatting.
describe("formatHumanSize", () => {
  it("formats 0 as 0 B", () => {
    expect(formatHumanSize(0)).toBe("0 B");
  });
  it("formats 1023 as 1023 B", () => {
    expect(formatHumanSize(1023)).toBe("1023 B");
  });
  it("formats 1024 as 1.0 KB", () => {
    expect(formatHumanSize(1024)).toBe("1.0 KB");
  });
  it("formats 1024*1024 as 1.0 MB", () => {
    expect(formatHumanSize(1024 * 1024)).toBe("1.0 MB");
  });
  it("formats 1024*1024*1024 as 1.0 GB", () => {
    expect(formatHumanSize(1024 * 1024 * 1024)).toBe("1.0 GB");
  });
  it("uses exactly one decimal for KB+", () => {
    expect(formatHumanSize(1536)).toBe("1.5 KB"); // 1.5 KB
    expect(formatHumanSize(12345)).toBe("12.1 KB");
  });
});

// Test F: sanitization helper — rejects hostile / accepts safe.
describe("sanitizeFilenameForUpload", () => {
  it("rejects path traversal via ..", () => {
    expect(sanitizeFilenameForUpload("../../etc/passwd")).toBeNull();
  });
  it("rejects raw ..", () => {
    expect(sanitizeFilenameForUpload("..")).toBeNull();
  });
  it("rejects raw .", () => {
    expect(sanitizeFilenameForUpload(".")).toBeNull();
  });
  it("rejects hidden-file (leading dot)", () => {
    expect(sanitizeFilenameForUpload(".ssh_config")).toBeNull();
  });
  it("rejects names containing slash", () => {
    expect(sanitizeFilenameForUpload("subdir/log.txt")).toBeNull();
  });
  it("rejects names containing backslash", () => {
    expect(sanitizeFilenameForUpload("subdir\\log.txt")).toBeNull();
  });
  it("rejects null-byte payloads", () => {
    expect(sanitizeFilenameForUpload("log\x00.txt")).toBeNull();
  });
  it("rejects empty after strip", () => {
    expect(sanitizeFilenameForUpload("\x00")).toBeNull();
  });
  it("rejects delimiter collision", () => {
    expect(
      sanitizeFilenameForUpload("--- attached files ---.txt"),
    ).toBeNull();
  });
  it("rejects any line starting with '--- '", () => {
    expect(sanitizeFilenameForUpload("--- foo bar")).toBeNull();
  });
  it("rejects embedded newlines", () => {
    expect(sanitizeFilenameForUpload("log\n.txt")).toBeNull();
  });
  it("rejects >200 chars", () => {
    expect(sanitizeFilenameForUpload("a".repeat(201) + ".log")).toBeNull();
  });
  it("accepts a normal filename", () => {
    expect(sanitizeFilenameForUpload("log.txt")).toBe("log.txt");
  });
  it("preserves spaces and parens", () => {
    expect(sanitizeFilenameForUpload("normal file (v2).log")).toBe(
      "normal file (v2).log",
    );
  });
  it("preserves unicode filenames", () => {
    expect(sanitizeFilenameForUpload("résumé.pdf")).toBe("résumé.pdf");
  });
});

// Tests B, C: formatInjectedUserTurn.
describe("formatInjectedUserTurn", () => {
  it("empty caption + one file — locked layout", () => {
    const out = formatInjectedUserTurn({
      caption: "",
      files: [
        {
          filename: "log.txt",
          size: 12345,
          mimetype: "text/plain",
          uploadTimestamp: "2026-07-20T14:32:11",
          landingPath:
            "/home/ash/pretty-view-uploads/2026-07-20/143211-log.txt",
        },
      ],
    });
    // Line 1 is the empty caption slot; line 2 is blank separator; line 3 is delimiter.
    const lines = out.split("\n");
    expect(lines[0]).toBe("");
    expect(lines[1]).toBe("");
    expect(lines[2]).toBe("--- attached files ---");
    expect(out).toContain(
      "1. log.txt (12.1 KB, text/plain) → /home/ash/pretty-view-uploads/2026-07-20/143211-log.txt",
    );
    expect(out).toContain("uploaded 2026-07-20T14:32:11");
    expect(out.endsWith("\n")).toBe(true);
  });

  it("non-empty caption preserves internal newlines and numbers files 1., 2., 3.", () => {
    const out = formatInjectedUserTurn({
      caption: "please analyze these\nsecond caption line",
      files: [
        {
          filename: "a.log",
          size: 100,
          mimetype: "text/plain",
          uploadTimestamp: "2026-07-20T14:32:11",
          landingPath: "/tmp/a.log",
        },
        {
          filename: "b.log",
          size: 200,
          mimetype: "text/plain",
          uploadTimestamp: "2026-07-20T14:32:12",
          landingPath: "/tmp/b.log",
        },
        {
          filename: "c.log",
          size: 300,
          mimetype: "text/plain",
          uploadTimestamp: "2026-07-20T14:32:13",
          landingPath: "/tmp/c.log",
        },
      ],
    });
    expect(out).toContain("please analyze these\nsecond caption line");
    // Caption line(s) then blank line then delimiter.
    expect(out).toContain("\n\n--- attached files ---\n");
    expect(out).toMatch(/1\. a\.log \(100 B, text\/plain\) → \/tmp\/a\.log/);
    expect(out).toMatch(/2\. b\.log \(200 B, text\/plain\) → \/tmp\/b\.log/);
    expect(out).toMatch(/3\. c\.log \(300 B, text\/plain\) → \/tmp\/c\.log/);
    expect(out.endsWith("\n")).toBe(true);
  });

  it("round-trips through parseInjectedUserTurn", () => {
    const files = [
      {
        filename: "log.txt",
        size: 12345,
        mimetype: "text/plain",
        uploadTimestamp: "2026-07-20T14:32:11",
        landingPath: "/home/ash/pretty-view-uploads/2026-07-20/143211-log.txt",
      },
    ];
    const s = formatInjectedUserTurn({
      caption: "here is one log",
      files,
    });
    const parsed = parseInjectedUserTurn(s);
    expect(parsed).not.toBeNull();
    expect(parsed?.caption).toBe("here is one log");
    expect(parsed?.files).toHaveLength(1);
    expect(parsed?.files[0].filename).toBe("log.txt");
    expect(parsed?.files[0].landingPath).toBe(files[0].landingPath);
  });
});
