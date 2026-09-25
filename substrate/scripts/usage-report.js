#!/usr/bin/env node
// Reads Claude Code statusLine JSON on stdin; if account rate_limits are present,
// POSTs {five_hour, seven_day, source_box, ts} to the usage collector. Fire-and-forget,
// stdlib only (no jq), robust: any error/absence just exits 0 silently.
//
// Throttled: skips the POST if the last successful post was less than
// MIN_POST_INTERVAL_S seconds ago (default 60, override via env). Rate-limit numbers
// move slowly (5h + 7d windows) so once-per-minute is plenty; the statusLine fires
// every few seconds and doesn't need a fresh POST per tick.
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const STATE_FILE = process.env.USAGE_STATE_FILE ||
  path.join(os.homedir(), '.claude', 'usage', 'last-post-ts');
const MIN_INTERVAL_S = parseInt(process.env.MIN_POST_INTERVAL_S || '60', 10);

function shouldSkip() {
  try {
    const last = parseInt(fs.readFileSync(STATE_FILE, 'utf8').trim(), 10);
    if (!Number.isFinite(last)) return false;
    return (Math.floor(Date.now() / 1000) - last) < MIN_INTERVAL_S;
  } catch { return false; }
}

function recordPost() {
  try {
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    const tmp = STATE_FILE + '.tmp';
    fs.writeFileSync(tmp, String(Math.floor(Date.now() / 1000)));
    fs.renameSync(tmp, STATE_FILE);
  } catch { /* best-effort — never break the wrapper */ }
}

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', c => (input += c));
process.stdin.on('end', () => {
  if (shouldSkip()) process.exit(0);
  let d;
  try { d = JSON.parse(input); } catch { process.exit(0); }
  const rl = d && d.rate_limits;
  if (!rl || !rl.five_hour || rl.five_hour.used_percentage == null) process.exit(0);
  const payload = JSON.stringify({
    five_hour: rl.five_hour,
    seven_day: rl.seven_day || null,
    source_box: os.hostname().split('.')[0],
    ts: Math.floor(Date.now() / 1000),
  });
  let url;
  try { url = new URL(process.env.COLLECTOR || 'http://100.113.23.63:9421/report'); }
  catch { process.exit(0); }
  const req = http.request({
    hostname: url.hostname, port: url.port || 80, path: url.pathname, method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
    timeout: 3000,
  }, res => {
    res.resume();
    res.on('end', () => {
      if (res.statusCode >= 200 && res.statusCode < 300) recordPost();
      process.exit(0);
    });
  });
  req.on('error', () => process.exit(0));
  req.on('timeout', () => { req.destroy(); process.exit(0); });
  req.write(payload); req.end();
});
