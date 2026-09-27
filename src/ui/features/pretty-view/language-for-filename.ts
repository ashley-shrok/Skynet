/**
 * languageForFilename — resolve a filename to a CodeMirror language extension.
 *
 * Called by the code-editor fallback branch of MarkdownEditor to pick which
 * syntax highlighter to mount. Returns null for unknown filenames — the
 * editor stays functional (line numbers, undo, search, generic bracket-
 * matching) but skips syntax coloring.
 *
 * Two-phase lookup, case-insensitive:
 *   1. Well-known extensionless filenames (Dockerfile, Makefile, Gemfile,
 *      .gitignore, .env, .bashrc, ...).
 *   2. File extension (everything after the last dot).
 *
 * Coverage: every mainstream language the CodeMirror ecosystem ships support
 * for. Modern first-class packs where available (JS/TS, JSON, YAML, Python,
 * HTML, CSS, Java, C/C++, PHP, Rust, SQL, XML, Go, WebAssembly text), legacy-
 * modes bundle for the rest (C#, Kotlin, Swift, Ruby, PowerShell, Dockerfile,
 * TOML, INI, Lua, Perl, Haskell, Clojure, Groovy, Erlang, Julia, R, OCaml,
 * F#, Scheme, VB, CoffeeScript, Objective-C, Dart, ...).
 *
 * Markdown files (.md) deliberately return null here — they route to
 * MDXEditor upstream and should never reach this resolver.
 */

import type { Extension } from "@codemirror/state";
import { StreamLanguage } from "@codemirror/language";

// Modern first-class language packs.
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { yaml } from "@codemirror/lang-yaml";
import { python } from "@codemirror/lang-python";
import { html } from "@codemirror/lang-html";
import { css } from "@codemirror/lang-css";
import { sass } from "@codemirror/lang-sass";
import { less } from "@codemirror/lang-less";
import { java } from "@codemirror/lang-java";
import { cpp } from "@codemirror/lang-cpp";
import { php } from "@codemirror/lang-php";
import { rust } from "@codemirror/lang-rust";
import { sql } from "@codemirror/lang-sql";
import { xml } from "@codemirror/lang-xml";
import { go } from "@codemirror/lang-go";
import { wast } from "@codemirror/lang-wast";

// Legacy-modes for languages the modern packs don't cover.
import {
  csharp,
  kotlin,
  scala,
  dart,
  objectiveC,
  objectiveCpp,
} from "@codemirror/legacy-modes/mode/clike";
import { shell } from "@codemirror/legacy-modes/mode/shell";
import { powerShell } from "@codemirror/legacy-modes/mode/powershell";
import { dockerFile } from "@codemirror/legacy-modes/mode/dockerfile";
import { toml } from "@codemirror/legacy-modes/mode/toml";
import { properties } from "@codemirror/legacy-modes/mode/properties";
import { ruby } from "@codemirror/legacy-modes/mode/ruby";
import { swift } from "@codemirror/legacy-modes/mode/swift";
import { lua } from "@codemirror/legacy-modes/mode/lua";
import { perl } from "@codemirror/legacy-modes/mode/perl";
import { haskell } from "@codemirror/legacy-modes/mode/haskell";
import { clojure } from "@codemirror/legacy-modes/mode/clojure";
import { groovy } from "@codemirror/legacy-modes/mode/groovy";
import { erlang } from "@codemirror/legacy-modes/mode/erlang";
import { julia } from "@codemirror/legacy-modes/mode/julia";
import { r as rLang } from "@codemirror/legacy-modes/mode/r";
import { oCaml, fSharp } from "@codemirror/legacy-modes/mode/mllike";
import { scheme } from "@codemirror/legacy-modes/mode/scheme";
import { vb } from "@codemirror/legacy-modes/mode/vb";
import { coffeeScript } from "@codemirror/legacy-modes/mode/coffeescript";

type LangFactory = () => Extension;

const streamed = (parser: Parameters<typeof StreamLanguage.define>[0]): LangFactory =>
  () => StreamLanguage.define(parser);

// Extension → factory. Keys are lowercase, dot-stripped.
const BY_EXTENSION: Record<string, LangFactory> = {
  // TypeScript / JavaScript family
  ts:  () => javascript({ typescript: true }),
  tsx: () => javascript({ typescript: true, jsx: true }),
  mts: () => javascript({ typescript: true }),
  cts: () => javascript({ typescript: true }),
  js:  () => javascript(),
  jsx: () => javascript({ jsx: true }),
  mjs: () => javascript(),
  cjs: () => javascript(),

  // JSON family
  json:  () => json(),
  jsonc: () => json(),
  json5: () => json(),

  // YAML
  yaml: () => yaml(),
  yml:  () => yaml(),

  // Python
  py:  () => python(),
  pyw: () => python(),
  pyi: () => python(),

  // Web
  html:  () => html(),
  htm:   () => html(),
  xhtml: () => html(),
  xml:   () => xml(),
  svg:   () => xml(),
  css:   () => css(),
  scss:  () => sass({ indented: false }),
  sass:  () => sass({ indented: true }),
  less:  () => less(),

  // JVM
  java:   () => java(),
  kt:     streamed(kotlin),
  kts:    streamed(kotlin),
  scala:  streamed(scala),
  sc:     streamed(scala),
  groovy: streamed(groovy),
  gradle: streamed(groovy),

  // C/C++/native
  c:   () => cpp(),
  h:   () => cpp(),
  cpp: () => cpp(),
  cc:  () => cpp(),
  cxx: () => cpp(),
  hpp: () => cpp(),
  hh:  () => cpp(),
  hxx: () => cpp(),

  // .NET / Objective-C / Dart
  cs:    streamed(csharp),
  fs:    streamed(fSharp),
  fsi:   streamed(fSharp),
  fsx:   streamed(fSharp),
  vb:    streamed(vb),
  vbnet: streamed(vb),
  m:     streamed(objectiveC),
  mm:    streamed(objectiveCpp),
  dart:  streamed(dart),

  // Other mainstream
  php:   () => php(),
  phtml: () => php(),
  rs:    () => rust(),
  sql:   () => sql(),
  go:    () => go(),
  swift: streamed(swift),
  rb:    streamed(ruby),

  // Shells / config
  sh:         streamed(shell),
  bash:       streamed(shell),
  zsh:        streamed(shell),
  fish:       streamed(shell),
  ksh:        streamed(shell),
  ps1:        streamed(powerShell),
  psm1:       streamed(powerShell),
  psd1:       streamed(powerShell),
  toml:       streamed(toml),
  ini:        streamed(properties),
  cfg:        streamed(properties),
  conf:       streamed(properties),
  properties: streamed(properties),

  // Scripting & functional
  lua:    streamed(lua),
  pl:     streamed(perl),
  pm:     streamed(perl),
  hs:     streamed(haskell),
  lhs:    streamed(haskell),
  clj:    streamed(clojure),
  cljs:   streamed(clojure),
  cljc:   streamed(clojure),
  edn:    streamed(clojure),
  erl:    streamed(erlang),
  hrl:    streamed(erlang),
  jl:     streamed(julia),
  r:      streamed(rLang),
  ml:     streamed(oCaml),
  mli:    streamed(oCaml),
  scm:    streamed(scheme),
  ss:     streamed(scheme),
  rkt:    streamed(scheme),
  lisp:   streamed(scheme),
  cl:     streamed(scheme),
  coffee: streamed(coffeeScript),

  // WebAssembly text
  wat:  () => wast(),
  wast: () => wast(),
};

// Well-known extensionless filenames. Matched case-insensitively against the
// filename with its directory portion stripped.
const BY_FILENAME: Record<string, LangFactory> = {
  dockerfile:    streamed(dockerFile),
  containerfile: streamed(dockerFile),
  rakefile:      streamed(ruby),
  gemfile:       streamed(ruby),
  guardfile:     streamed(ruby),
  ".gitignore":  streamed(properties),
  ".env":        streamed(shell),
  ".bashrc":     streamed(shell),
  ".zshrc":      streamed(shell),
  ".profile":    streamed(shell),
  ".bash_profile": streamed(shell),
};

/**
 * Resolve a filename to a CodeMirror language extension, or null if no
 * highlighter is registered for it. Callers should treat null as "plain
 * text" — mount the editor without a language extension.
 */
export function languageForFilename(filename: string): Extension | null {
  if (!filename) return null;

  // Strip directory portion — accepts POSIX or Windows separators.
  const base = filename.replace(/^.*[/\\]/, "");
  if (!base) return null;

  // Phase 1: well-known filenames (case-insensitive).
  const lower = base.toLowerCase();
  if (Object.prototype.hasOwnProperty.call(BY_FILENAME, lower)) {
    return BY_FILENAME[lower]!();
  }

  // Phase 2: extension. A leading-dot filename with no other dot (.env,
  // .bashrc) should have been handled above; if it wasn't, the last-dot
  // check catches it here (dot at position 0 → skip).
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return null;
  const ext = base.slice(dot + 1).toLowerCase();

  return BY_EXTENSION[ext]?.() ?? null;
}
