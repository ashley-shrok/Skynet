import { describe, it, expect, vi } from "vitest";
import { formatInjectedUserTurn } from "@/api/pretty-view-upload-protocol";
import {
  buildCancelledSendRestore,
  fetchRestoreFiles,
  hostFileUrl,
} from "./cancelled-send-restore";
import { appendVoiceLabel } from "./voice-label";

describe("buildCancelledSendRestore", () => {
  it("plain text → the words, no files", () => {
    expect(buildCancelledSendRestore("write me a poem")).toEqual({ text: "write me a poem", files: [] });
  });

  it("attachment send → the caption plus each file's landing path", () => {
    const content = formatInjectedUserTurn({
      caption: "look at these",
      files: [
        { filename: "a.png", size: 2048, mimetype: "image/png", landingPath: "/home/ubuntu/pretty-view-uploads/2026-10-18/a.png", uploadTimestamp: "2026-10-18T12:00:00" },
        { filename: "notes.txt", size: 10, mimetype: "text/plain", landingPath: "/home/ubuntu/pretty-view-uploads/2026-10-18/notes.txt", uploadTimestamp: "2026-10-18T12:00:00" },
      ],
    });
    expect(buildCancelledSendRestore(content)).toEqual({
      text: "look at these",
      files: [
        { filename: "a.png", mimetype: "image/png", landingPath: "/home/ubuntu/pretty-view-uploads/2026-10-18/a.png" },
        { filename: "notes.txt", mimetype: "text/plain", landingPath: "/home/ubuntu/pretty-view-uploads/2026-10-18/notes.txt" },
      ],
    });
  });

  it("a voice-mode send comes back without its voice label", () => {
    expect(buildCancelledSendRestore(appendVoiceLabel("spoken words")).text).toBe("spoken words");
  });

  it("attachments with no caption → empty words, files kept", () => {
    const content = formatInjectedUserTurn({
      caption: "",
      files: [{ filename: "a.png", size: 1, mimetype: "image/png", landingPath: "/x/a.png", uploadTimestamp: "t" }],
    });
    const r = buildCancelledSendRestore(content);
    expect(r.text).toBe("");
    expect(r.files).toHaveLength(1);
  });
});

describe("fetchRestoreFiles", () => {
  it("builds the agent-cited file URL per segment", () => {
    expect(hostFileUrl("Skynet", "/home/ubuntu/up loads/a b.png")).toBe("/file/Skynet/home/ubuntu/up%20loads/a%20b.png");
  });

  it("returns fetched files as File objects and reports the ones that failed", async () => {
    const fetchImpl = vi.fn(async (url: RequestInfo | URL) => {
      if (String(url).endsWith("missing.txt")) return new Response("nope", { status: 404 });
      return new Response("bytes", { status: 200 });
    });
    const { files, failed } = await fetchRestoreFiles(
      "Skynet",
      [
        { filename: "a.png", mimetype: "image/png", landingPath: "/u/a.png" },
        { filename: "missing.txt", mimetype: "text/plain", landingPath: "/u/missing.txt" },
      ],
      fetchImpl as never,
    );
    expect(files.map((f) => [f.name, f.type, f.size])).toEqual([["a.png", "image/png", 5]]);
    expect(failed).toEqual(["missing.txt"]);
    expect(fetchImpl.mock.calls[0][0]).toBe("/file/Skynet/u/a.png");
  });
});
