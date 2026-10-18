import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parsePermissionPromptScreen } from "./permission-prompt-screen";

const fixture = (name: string) =>
  readFileSync(join(__dirname, "__fixtures__", name), "utf8");

describe("parsePermissionPromptScreen", () => {
  it("parses a real hook-ask Bash prompt captured from v2.1.302", () => {
    const p = parsePermissionPromptScreen(
      fixture("permission-prompt-hook-ask.txt"),
    );
    expect(p).not.toBeNull();
    expect(p!.title).toBe("Bash command");
    expect(p!.description).toBe("List scratch files");
    expect(p!.body).toBe("ls -la");
    expect(p!.reason).toContain("Test reason: possibly risky delete");
    expect(p!.autoDenySeconds).toBeNull();
    expect(p!.yesKey).toBe("1");
    expect(p!.noKey).toBe("2");
  });

  it("parses the dangerous-rm safety prompt with its auto-deny countdown", () => {
    const p = parsePermissionPromptScreen(
      fixture("permission-prompt-dangerous-rm-countdown.txt"),
    );
    expect(p).not.toBeNull();
    expect(p!.description).toBe(
      "Stop dev server, remove scratch DB, show status",
    );
    expect(p!.body.split("\n")).toHaveLength(4);
    expect(p!.body).toContain('pkill -f "vite --port 5173"');
    expect(p!.reason).toMatch(/^Dangerous rm operation on possibly-empty variable path/);
    expect(p!.reason).not.toContain("automatically deny");
    expect(p!.autoDenySeconds).toBe(20);
  });

  it("keeps the fingerprint stable while the countdown ticks", () => {
    const a = fixture("permission-prompt-dangerous-rm-countdown.txt");
    const b = a.replace("in 0:20,", "in 0:07,");
    const pa = parsePermissionPromptScreen(a)!;
    const pb = parsePermissionPromptScreen(b)!;
    expect(pb.autoDenySeconds).toBe(7);
    expect(pb.fingerprint).toBe(pa.fingerprint);
  });

  it("reads minutes in the countdown", () => {
    const s = fixture("permission-prompt-dangerous-rm-countdown.txt").replace(
      "in 0:20,",
      "in 1:05,",
    );
    expect(parsePermissionPromptScreen(s)!.autoDenySeconds).toBe(65);
  });

  it("picks the right digits when there is a 'Yes, and don't ask again' option", () => {
    const s = fixture("permission-prompt-hook-ask.txt").replace(
      "   2. No",
      "   2. Yes, and don't ask again for ls commands\n   3. No",
    );
    const p = parsePermissionPromptScreen(s)!;
    expect(p.yesKey).toBe("1");
    expect(p.noKey).toBe("3");
  });

  it("returns null for an idle screen", () => {
    expect(
      parsePermissionPromptScreen(fixture("permission-prompt-none-idle.txt")),
    ).toBeNull();
  });

  it("returns null for the folder-trust dialog (no Yes/No proceed question)", () => {
    const trust = [
      "────────────────────────────────────────",
      " Accessing workspace:",
      " Quick safety check: Is this a project you created or one you trust?",
      " ❯ No, exit",
      "   Yes, I trust this folder",
      " Enter to confirm · Esc to cancel",
    ].join("\n");
    expect(parsePermissionPromptScreen(trust)).toBeNull();
  });

  it("returns null when the options lack a No", () => {
    const s = fixture("permission-prompt-hook-ask.txt").replace("2. No", "2. Maybe");
    expect(parsePermissionPromptScreen(s)).toBeNull();
  });
});
