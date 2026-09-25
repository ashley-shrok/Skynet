#!/usr/bin/env node
// Reads Claude Code statusLine JSON on stdin; if account rate_limits are present,
// POSTs {five_hour, seven_day, source_box, ts} to the usage collector. Fire-and-forget,
// stdlib only (no jq), robust: any error/absence just exits 0 silently.
const http = require('http');
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', c => (input += c));
process.stdin.on('end', () => {
  let d;
  try { d = JSON.parse(input); } catch { process.exit(0); }
  const rl = d && d.rate_limits;
  if (!rl || !rl.five_hour || rl.five_hour.used_percentage == null) process.exit(0);
  const payload = JSON.stringify({
    five_hour: rl.five_hour,
    seven_day: rl.seven_day || null,
    source_box: require('os').hostname().split('.')[0],
    ts: Math.floor(Date.now() / 1000),
  });
  let url;
  try { url = new URL(process.env.COLLECTOR || 'http://100.113.23.63:9421/report'); }
  catch { process.exit(0); }
  const req = http.request({
    hostname: url.hostname, port: url.port || 80, path: url.pathname, method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
    timeout: 3000,
  }, res => { res.resume(); res.on('end', () => process.exit(0)); });
  req.on('error', () => process.exit(0));
  req.on('timeout', () => { req.destroy(); process.exit(0); });
  req.write(payload); req.end();
});
