import { describe, it, expect } from "vitest";
import { languageForFilename } from "./language-for-filename";

// The resolver returns Extension|null. Extension is an opaque object at
// runtime, so tests assert on "returns something" vs "returns null" for the
// resolution behavior. Value shape isn't part of the contract.

describe("languageForFilename", () => {
  describe("modern language packs (known extensions)", () => {
    it.each([
      ["config.ts",     "TypeScript"],
      ["Component.tsx", "TSX"],
      ["module.mts",    "TS module"],
      ["module.cts",    "TS commonjs"],
      ["script.js",     "JavaScript"],
      ["view.jsx",      "JSX"],
      ["esm.mjs",       "JS module"],
      ["legacy.cjs",    "JS commonjs"],
      ["package.json",  "JSON"],
      ["tsconfig.jsonc", "JSONC"],
      ["config.json5",  "JSON5"],
      ["compose.yml",   "YAML (yml)"],
      ["ci.yaml",       "YAML (yaml)"],
      ["main.py",       "Python"],
      ["stub.pyi",      "Python typed stub"],
      ["index.html",    "HTML"],
      ["legacy.htm",    "HTML (htm)"],
      ["icon.svg",      "SVG (via XML)"],
      ["config.xml",    "XML"],
      ["styles.css",    "CSS"],
      ["theme.scss",    "SCSS"],
      ["theme.sass",    "Sass (indented)"],
      ["theme.less",    "Less"],
      ["Foo.java",      "Java"],
      ["engine.cpp",    "C++"],
      ["util.h",        "C header"],
      ["util.hpp",      "C++ header"],
      ["service.php",   "PHP"],
      ["main.rs",       "Rust"],
      ["migration.sql", "SQL"],
      ["main.go",       "Go"],
      ["module.wat",    "WebAssembly text (wat)"],
      ["module.wast",   "WebAssembly text (wast)"],
    ])("resolves %s (%s)", (filename) => {
      expect(languageForFilename(filename)).not.toBeNull();
    });
  });

  describe("legacy-modes languages", () => {
    it.each([
      ["Service.cs",         "C#"],
      ["App.kt",             "Kotlin"],
      ["build.gradle.kts",   "Kotlin script"],
      ["main.scala",         "Scala"],
      ["Foo.dart",           "Dart"],
      ["Class.fs",           "F#"],
      ["Legacy.vb",          "VB"],
      ["MyClass.m",          "Objective-C"],
      ["MyClass.mm",         "Objective-C++"],
      ["helper.rb",          "Ruby"],
      ["View.swift",         "Swift"],
      ["deploy.sh",          "Shell (sh)"],
      ["setup.bash",         "Shell (bash)"],
      ["run.zsh",            "Shell (zsh)"],
      ["deploy.ps1",         "PowerShell"],
      ["Config.psm1",        "PowerShell module"],
      ["settings.toml",      "TOML"],
      ["app.ini",            "INI"],
      ["logging.conf",       "Config"],
      ["init.lua",           "Lua"],
      ["parse.pl",           "Perl"],
      ["Main.hs",            "Haskell"],
      ["core.clj",           "Clojure"],
      ["build.groovy",       "Groovy"],
      ["build.gradle",       "Gradle (via Groovy)"],
      ["node.erl",           "Erlang"],
      ["compute.jl",         "Julia"],
      ["analysis.r",         "R"],
      ["module.ml",          "OCaml"],
      ["main.scm",           "Scheme"],
      ["app.rkt",            "Racket (via Scheme)"],
      ["style.coffee",       "CoffeeScript"],
    ])("resolves %s (%s)", (filename) => {
      expect(languageForFilename(filename)).not.toBeNull();
    });
  });

  describe("well-known extensionless filenames", () => {
    it.each([
      ["Dockerfile",     "Dockerfile"],
      ["dockerfile",     "Dockerfile (lower)"],
      ["Containerfile",  "Containerfile alias"],
      ["Rakefile",       "Rakefile → Ruby"],
      ["Gemfile",        "Gemfile → Ruby"],
      ["Guardfile",      "Guardfile → Ruby"],
      [".gitignore",     ".gitignore"],
      [".env",           ".env"],
      [".bashrc",        ".bashrc"],
      [".zshrc",         ".zshrc"],
      [".profile",       ".profile"],
      [".bash_profile",  ".bash_profile"],
    ])("resolves %s (%s)", (filename) => {
      expect(languageForFilename(filename)).not.toBeNull();
    });

    it("matches extensionless names case-insensitively", () => {
      expect(languageForFilename("DOCKERFILE")).not.toBeNull();
      expect(languageForFilename("dockerfile")).not.toBeNull();
      expect(languageForFilename("DockerFile")).not.toBeNull();
    });
  });

  describe("dotfile variants + common config dotfiles", () => {
    it.each([
      [".env.local",       ".env.local"],
      [".env.production",  ".env.production"],
      [".env.test",        ".env.test"],
      [".env.development", ".env.development"],
      [".env.example",     ".env.example"],
      [".dockerignore",    ".dockerignore"],
      [".npmrc",           ".npmrc"],
      [".nvmrc",           ".nvmrc"],
      [".editorconfig",    ".editorconfig"],
    ])("resolves %s (%s)", (filename) => {
      expect(languageForFilename(filename)).not.toBeNull();
    });

    it("resolves .env variants case-insensitively", () => {
      expect(languageForFilename(".ENV.LOCAL")).not.toBeNull();
      expect(languageForFilename(".Env.Production")).not.toBeNull();
    });

    it("does NOT match unrelated strings that happen to contain .env", () => {
      // The pattern is anchored — .env must be at the START of the name.
      expect(languageForFilename("my.env.local")).toBeNull();
      expect(languageForFilename("prefix.env")).toBeNull();
    });
  });

  describe("extension casing", () => {
    it("resolves regardless of extension case", () => {
      expect(languageForFilename("Foo.TS")).not.toBeNull();
      expect(languageForFilename("index.HTML")).not.toBeNull();
      expect(languageForFilename("main.PY")).not.toBeNull();
    });
  });

  describe("directory stripping", () => {
    it("strips POSIX directories before matching", () => {
      expect(languageForFilename("/home/user/project/main.py")).not.toBeNull();
      expect(languageForFilename("src/backend/index.ts")).not.toBeNull();
    });

    it("strips Windows directories before matching", () => {
      expect(languageForFilename("C:\\project\\main.py")).not.toBeNull();
    });

    it("strips directory before matching extensionless filenames", () => {
      expect(languageForFilename("/path/to/Dockerfile")).not.toBeNull();
      expect(languageForFilename("./.gitignore")).not.toBeNull();
    });
  });

  describe("unknowns fall through to null (plain text)", () => {
    it("returns null for unknown extensions", () => {
      expect(languageForFilename("mystery.xyz")).toBeNull();
      expect(languageForFilename("log.log")).toBeNull();
      expect(languageForFilename("data.bin")).toBeNull();
    });

    it("returns null for filenames with no extension and no special-case", () => {
      expect(languageForFilename("LICENSE")).toBeNull();
      expect(languageForFilename("README")).toBeNull();
      expect(languageForFilename("CHANGELOG")).toBeNull();
    });

    it("returns null for empty or edge-case input", () => {
      expect(languageForFilename("")).toBeNull();
      expect(languageForFilename("/")).toBeNull();
      expect(languageForFilename(".")).toBeNull();
    });

  });

  describe("markdown routes to the markdown language pack", () => {
    // Markdown normally hits MDXEditor first, but the silent-parse-failure
    // fallback inside MarkdownEditor routes failed .md content through
    // CodeEditorImpl → languageForFilename. Must resolve to a real
    // extension (not null) so the user gets syntax highlighting instead of
    // plain text in the fallback path.
    it("returns an extension for .md", () => {
      expect(languageForFilename("README.md")).not.toBeNull();
    });

    it("returns an extension for .markdown and other variants", () => {
      expect(languageForFilename("notes.markdown")).not.toBeNull();
      expect(languageForFilename("notes.mdown")).not.toBeNull();
      expect(languageForFilename("notes.mkd")).not.toBeNull();
      expect(languageForFilename("notes.mkdn")).not.toBeNull();
    });
  });
});
