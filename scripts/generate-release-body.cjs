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

function buildTable(mobileVersion) {
  const mobileBase = `https://github.com/Skynet-SSH/Mobile/releases/download/release-${mobileVersion}-tag`;

  return [
    `| Android                                      | iOS                                |`,
    `|---------------------------------------------|-----------------------------------|`,
    `| [APK (${mobileVersion})](${mobileBase}/skynet_android.apk) | [IPA (${mobileVersion})](${mobileBase}/skynet_ios.ipa) |`,
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

  const table = buildTable(mobileVersion);

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
