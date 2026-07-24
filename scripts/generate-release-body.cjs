const fs = require("fs");
const path = require("path");

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) {
        args[key] = true;
      } else {
        args[key] = next;
        i++;
      }
    }
  }
  return args;
}

function fail(message) {
  console.error(`generate-release-body: ${message}`);
  process.exit(1);
}

function extractSection(notes, name) {
  const pattern = new RegExp(
    `<!--\\s*${name}\\s*-->([\\s\\S]*?)<!--\\s*/${name}\\s*-->`,
  );
  const match = notes.match(pattern);
  if (!match) {
    fail(`missing <!-- ${name} --> section in release notes`);
  }
  const value = match[1].trim();
  if (!value) {
    fail(`empty <!-- ${name} --> section in release notes`);
  }
  return value;
}

function youtubeId(raw) {
  const value = raw.trim();
  let match = value.match(/[?&]v=([A-Za-z0-9_-]+)/);
  if (match) return match[1];
  match = value.match(/youtu\.be\/([A-Za-z0-9_-]+)/);
  if (match) return match[1];
  match = value.match(/embed\/([A-Za-z0-9_-]+)/);
  if (match) return match[1];
  if (/^[A-Za-z0-9_-]+$/.test(value)) return value;
  fail(`could not parse a YouTube video id from "${value}"`);
}

function buildTable(version, mobileVersion) {
  const tag = `release-${version}-tag`;
  const base = `https://github.com/Skynet-SSH/Skynet/releases/download/${tag}`;
  const mobileBase = `https://github.com/Skynet-SSH/Mobile/releases/download/release-${mobileVersion}-tag`;

  const win = (file) => `${base}/${file}`;
  const linux = (file) => `${base}/${file}`;
  const mac = (file) => `${base}/${file}`;

  return [
    `| Architecture      | Windows                                                                                  | Linux                                                                                     | Mac                                                                                       | Android                                      | iOS                                |`,
    `|------------------|------------------------------------------------------------------------------------------|-------------------------------------------------------------------------------------------|------------------------------------------------------------------------------------------|---------------------------------------------|-----------------------------------|`,
    `| **x86-64 (64-bit)** | [EXE](${win("skynet_windows_x64_nsis.exe")}) · [MSI](${win("skynet_windows_x64_msi.msi")}) · [Portable](${win("skynet_windows_x64_portable.zip")}) | [AppImage](${linux("skynet_linux_x64_appimage.AppImage")}) · [DEB](${linux("skynet_linux_x64_deb.deb")}) · [Portable](${linux("skynet_linux_x64_portable.tar.gz")}) | [DMG](${mac("skynet_macos_x64_dmg.dmg")}) | — | — |`,
    `| **AArch64 (ARM64)** | — | [AppImage](${linux("skynet_linux_arm64_appimage.AppImage")}) · [DEB](${linux("skynet_linux_arm64_deb.deb")}) · [Portable](${linux("skynet_linux_arm64_portable.tar.gz")}) | [DMG](${mac("skynet_macos_arm64_dmg.dmg")}) | [APK (${mobileVersion})](${mobileBase}/skynet_android.apk) | [IPA (${mobileVersion})](${mobileBase}/skynet_ios.ipa) |`,
    `| **ARMv7 (32-bit)**  | — | [AppImage](${linux("skynet_linux_armv7l_appimage.AppImage")}) · [DEB](${linux("skynet_linux_armv7l_deb.deb")}) · [Portable](${linux("skynet_linux_armv7l_portable.tar.gz")}) | — | — | — |`,
    `| **x86-32 (32-bit)** | [EXE](${win("skynet_windows_ia32_nsis.exe")}) · [MSI](${win("skynet_windows_ia32_msi.msi")}) · [Portable](${win("skynet_windows_ia32_portable.zip")}) | — | — | — | — |`,
    `| **Universal**      | [Chocolatey](https://docs.skynet.site/install/connector/windows) | [Flatpak](https://docs.skynet.site/install/connector/linux) | [DMG](${mac("skynet_macos_universal_dmg.dmg")}) · [App Store](https://apps.apple.com/us/app/skynet-ssh-companion/id6752672071) · [Homebrew](https://docs.skynet.site/install/connector/macos) | — | — |`,
  ].join("\n");
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const version = args.version;
  const mobileVersion = args["mobile-version"];
  const notesPath = args.notes || "RELEASE_NOTES.md";

  if (!version || version === true) fail("--version is required");
  if (!mobileVersion || mobileVersion === true)
    fail("--mobile-version is required");

  const resolvedNotes = path.resolve(notesPath);
  if (!fs.existsSync(resolvedNotes)) {
    fail(`release notes file not found: ${resolvedNotes}`);
  }

  const notes = fs.readFileSync(resolvedNotes, "utf8");
  const summary = extractSection(notes, "SUMMARY");
  const youtube = extractSection(notes, "YOUTUBE");
  const updateLog = extractSection(notes, "UPDATE_LOG");
  const bugFixes = extractSection(notes, "BUG_FIXES");

  const videoId = youtubeId(youtube);
  const embed = [
    `<a href="https://youtu.be/${videoId}">`,
    `  <img src="./repo-images/YouTube.png" alt="YouTube" width="500">`,
    `</a>`,
  ].join("\n");

  const table = buildTable(version, mobileVersion);

  const body = [
    summary,
    "",
    embed,
    "",
    table,
    "",
    "Update Log:",
    updateLog,
    "",
    "Bug Fixes:",
    bugFixes,
  ].join("\n");

  process.stdout.write(body + "\n");
}

main();
