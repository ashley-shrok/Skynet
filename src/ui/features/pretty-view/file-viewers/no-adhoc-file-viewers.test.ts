import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

/**
 * Shared file-view enforcement.
 *
 * Every surface that opens an arbitrary file must render the shared
 * <FileView> (file-viewers/FileView.tsx), so a file type added to the
 * registry shows up everywhere at once. This guard fails when a surface
 * drifts back to wiring editors or viewers by hand:
 *
 *   1. A UI file that reads arbitrary files (calls one of the file-read
 *      APIs below) must import FileView — or SkillFileTab, which wraps it.
 *
 *   2. Only the allowlisted files may import MarkdownEditor / CodeEditorImpl
 *      directly. The allowlist is the editor internals plus surfaces that
 *      only ever edit one fixed Markdown file. A new arbitrary-file surface
 *      belongs on FileView instead; add to the allowlist only for another
 *      fixed-Markdown field.
 */

const UI_ROOT = path.join(__dirname, "..", "..", "..");

const FILE_READ_CALL = /\b(readWorkspaceFile|readSkillFile|readRunbookFile|fetchHostFileUrl|fetchTailnetUrl)\(/;
const USES_FILE_VIEW = /from\s+["'](?:\.\.?\/)+(?:pretty-view\/)?(?:file-viewers\/FileView|SkillFileTab)["']/;
const IMPORTS_EDITOR = /from\s+["'][^"']*\/(MarkdownEditor|CodeEditorImpl)["']|import\(\s*["'][^"']*\/(MarkdownEditor|CodeEditorImpl)["']\s*\)/;

const EDITOR_IMPORT_ALLOWLIST: Record<string, string> = {
  "features/pretty-view/file-viewers/text-view.tsx": "FileView's text mode",
  "features/pretty-view/MarkdownEditor.tsx": "editor internals",
  "features/pretty-view/MdxEditorImpl.tsx": "editor internals",
  "features/pretty-view/CodeEditorImpl.tsx": "editor internals",
  "features/pretty-view/MarkdownEditor.frontmatter-fixture.tsx": "editor test fixture",
  "features/pretty-view/IdentityFileTab.tsx": "fixed identity Markdown files",
  "features/pretty-view/RoleFileTab.tsx": "fixed role Markdown file",
  "features/pretty-view/PreferencesAboutYouPane.tsx": "operator-whitelisted global Markdown files",
  "features/pretty-view/AddWakeupDialog.tsx": "wake-up prompt Markdown field",
  "features/pretty-conversations/ProjectFileTab.tsx": "fixed project.md",
};

function listUiSources(): string[] {
  const out = execSync(`git ls-files -z -- '${UI_ROOT}/*.ts' '${UI_ROOT}/*.tsx'`, {
    encoding: "utf8",
  });
  return out
    .split("\0")
    .filter((p) => p.length > 0 && !/\.test\.tsx?$/.test(p))
    .map((p) => path.resolve(process.cwd(), p))
    .filter((p) => fs.existsSync(p));
}

const rel = (file: string) => path.relative(UI_ROOT, file).split(path.sep).join("/");

describe("no ad-hoc file viewers (shared FileView guard)", () => {
  const files = listUiSources();

  it("finds UI sources to scan", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it("every UI surface that reads arbitrary files renders FileView", () => {
    const violations = files
      .filter((f) => !rel(f).startsWith("api/"))
      .filter((f) => {
        const src = fs.readFileSync(f, "utf8");
        return FILE_READ_CALL.test(src) && !USES_FILE_VIEW.test(src);
      })
      .map(rel);
    expect(
      violations,
      `These files read arbitrary files but don't render the shared <FileView> ` +
        `(file-viewers/FileView.tsx). Render FileView so registry file types work there too.`,
    ).toEqual([]);
  });

  it("only allowlisted files use MarkdownEditor / CodeEditorImpl directly", () => {
    const violations = files
      .filter((f) => IMPORTS_EDITOR.test(fs.readFileSync(f, "utf8")))
      .map(rel)
      .filter((r) => !(r in EDITOR_IMPORT_ALLOWLIST));
    expect(
      violations,
      `These files import MarkdownEditor/CodeEditorImpl directly. Arbitrary files ` +
        `belong on the shared <FileView>; see the allowlist note in this test.`,
    ).toEqual([]);
  });
});
