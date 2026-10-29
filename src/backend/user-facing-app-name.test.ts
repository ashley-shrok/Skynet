/**
 * Guard: the base app name "Skynet" never reaches anything a user can read.
 *
 * Every instance names itself through branding, so user-facing text uses the
 * branded name (or says what it means with no name). This scans the places
 * that text lives — translations, what's-new notes, the distributed agent
 * instructions, and the app's own source (comments, log lines and names that
 * are part of code skipped) — for the standalone word.
 *
 * A false alarm on genuinely internal text: add it to ALLOWED below.
 */

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../..");

// Standalone word only: not part of an identifier, header or URL
// (X-Skynet-Client-Build, buildSkynetFileUrl, github.com/…/Skynet).
// "Skynet-wide" still counts.
const NAME = /(?<![\w\-./])Skynet(?!\w)/g;

// Lines (substring match) that may keep the name, with why.
const ALLOWED: string[] = [
  // Open-source credit on Preferences → About → Licence (kept on purpose).
  "This app is built on Skynet, which is open source",
  // Repo name, told to agents maintaining the skill — not shown to users.
  "The source lives in the Skynet repo",
  // Upstream repo owner/name for the update and alert checkers.
  'const REPO_NAME = "Skynet";',
  'const REPO_OWNER = "Skynet-SSH";',
  // Mobile client's User-Agent header.
  "`Skynet-Mobile/${platform}`",
  // Outbound request header.
  '"User-Agent": "Skynet",',
  // Organisation field of a self-signed certificate.
  "O=Skynet",
  // API reference document (not served).
  'title: "Skynet API",',
  'description: "Skynet Backend API Reference",',
  // Header line of the server's generated settings file.
  "# Skynet Auto-generated Configuration",
  // Systemd unit description on the host.
  "`Skynet harness reconcile (pin ${pin})`",
  // Log field (multi-line log call).
  "a bot can only serve one Skynet account",
  // Startup error for whoever runs the server.
  "each Skynet host sets its own value",
];

const LOG_LINE = /\b(\w*[Ll]ogger|console)\.(info|warn|error|debug|success|log)\b/;
// Comment lines, including ones inside generated scripts, SQL and config text.
const COMMENT_LINE = /^\s*(\/\/|\*|\/\*|\{\/\*|#|--)/;

function walk(dir: string, keep: (file: string) => boolean, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "vendor" || entry === "__tests__") continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, keep, out);
    else if (keep(full)) out.push(full);
  }
  return out;
}

// One-line quoted strings, so "image/*" or "(" inside text doesn't count as code.
const QUOTED = /"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`/g;

const parenDepth = (code: string) => (code.match(/\(/g)?.length ?? 0) - (code.match(/\)/g)?.length ?? 0);

function offenders(file: string, text: string, code: boolean): string[] {
  const found: string[] = [];
  let inBlockComment = false;
  let logDepth = 0; // open parens of a log call still running across lines
  text.split("\n").forEach((line, idx) => {
    if (code) {
      const bare = line.replace(QUOTED, '""');
      const wasInBlock = inBlockComment;
      const open = bare.lastIndexOf("/*");
      const close = bare.lastIndexOf("*/");
      if (open > close) inBlockComment = true;
      else if (close > open) inBlockComment = false;
      const inLog = logDepth > 0;
      if (inLog) logDepth = Math.max(0, logDepth + parenDepth(bare));
      else if (LOG_LINE.test(bare)) logDepth = Math.max(0, parenDepth(bare.slice(bare.search(LOG_LINE))));
      if (inLog || LOG_LINE.test(bare)) return;
      if (wasInBlock || COMMENT_LINE.test(line)) return;
    }
    NAME.lastIndex = 0;
    if (!NAME.test(line)) return;
    if (ALLOWED.some((a) => line.includes(a))) return;
    found.push(`${path.relative(ROOT, file)}:${idx + 1}: ${line.trim()}`);
  });
  return found;
}

const isTest = (f: string) => /\.test\.(ts|tsx)$/.test(f);

describe("the base app name stays out of user-facing text", () => {
  it("translations", () => {
    const files = walk(path.join(ROOT, "src/ui/locales"), (f) => f.endsWith(".json"));
    expect(files.length).toBeGreaterThan(1);
    expect(files.flatMap((f) => offenders(f, readFileSync(f, "utf-8"), false))).toEqual([]);
  });

  it("agent instructions", () => {
    const files = walk(path.join(ROOT, "substrate/skills"), (f) => f.endsWith(".md"));
    expect(files.length).toBeGreaterThan(1);
    expect(files.flatMap((f) => offenders(f, readFileSync(f, "utf-8"), false))).toEqual([]);
  });

  it("screens, server messages and what's-new notes", () => {
    const files = [
      ...walk(path.join(ROOT, "src/ui"), (f) => /\.(ts|tsx)$/.test(f) && !isTest(f)),
      ...walk(path.join(ROOT, "src/backend"), (f) => f.endsWith(".ts") && !isTest(f)),
    ];
    expect(files.length).toBeGreaterThan(100);
    expect(files.flatMap((f) => offenders(f, readFileSync(f, "utf-8"), true))).toEqual([]);
  });
});

