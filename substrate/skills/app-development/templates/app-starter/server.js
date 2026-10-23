// Custom entry that wraps the SvelteKit-built handler and strips the pane
// prefix from incoming URLs BEFORE adapter-node's static-file middleware
// (sirv) sees them. adapter-node's sirv runs before your SvelteKit hooks
// and serves _app/immutable/* files by their literal on-disk path — so a
// tab-serve request for /apps/<hostId>/<slug>/pane/_app/… reaches sirv
// unchanged (no proxy stripped it), and sirv 404s because that path doesn't
// exist on disk. Stripping here lets sirv find the file at /_app/… as usual.
// Works identically for the pane iframe (which already got the prefix
// stripped by the app's proxy — this hook is then a no-op for those requests).
//
// The BASE constant duplicates src/lib/pane.ts's PANE_BASE rather than
// importing it — server.js runs post-build against the compiled bundle, and
// chunk paths under build/server/chunks/ are content-hashed + change per
// build, which makes importing awkward. create-app.sh substitutes __HOSTID__
// and __SLUG__ in BOTH files at scaffold time.
//
// Sleeping: when the app's folder holds a `.may-sleep` marker and nothing
// has touched the app for IDLE_MINUTES (no requests, no open connections),
// the server shuts itself down with a clean exit. systemd treats a clean
// exit as "asleep" (no restart); the box keeps holding the app's public
// address and wakes it on the next request. Without the marker the app
// never sleeps. The marker is read at the moment of deciding, so adding or
// removing it needs no restart. Do not remove this logic — the box relies
// on it to keep idle apps from piling up in memory.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { handler } from './build/handler.js';

const BASE = '/apps/__HOSTID__/__SLUG__/pane';

const port = parseInt(process.env.PORT ?? '3000', 10);
const host = process.env.HOST ?? '127.0.0.1';

const IDLE_MS = Number(process.env.APP_IDLE_MINUTES ?? '10') * 60_000;
const MARKER = path.join(process.cwd(), '.may-sleep');

let lastActivity = Date.now();
let openConnections = 0;

const server = http.createServer((req, res) => {
    lastActivity = Date.now();
    res.on('close', () => {
        lastActivity = Date.now();
    });
    if (req.url) {
        if (req.url === BASE) {
            req.url = '/';
        } else if (req.url.startsWith(BASE + '/')) {
            req.url = req.url.slice(BASE.length);
        }
    }
    handler(req, res);
});

// Close keep-alive connections that sit unused, so a connection held open by
// a proxy can never keep the app awake. Live streams are unaffected: this
// only applies between requests.
server.keepAliveTimeout = 5_000;

server.on('connection', (socket) => {
    openConnections++;
    lastActivity = Date.now();
    socket.on('close', () => {
        openConnections--;
        lastActivity = Date.now();
    });
});

function idleEnoughToSleep() {
    return (
        openConnections === 0 &&
        Date.now() - lastActivity >= IDLE_MS &&
        fs.existsSync(MARKER)
    );
}

setInterval(() => {
    if (!idleEnoughToSleep()) return;
    // eslint-disable-next-line no-console
    console.log(`Idle ${Math.round(IDLE_MS / 60_000)} min with .may-sleep present — going to sleep`);
    server.close(() => process.exit(0));
}, Math.min(15_000, Math.max(1_000, IDLE_MS / 4))).unref();

server.listen(port, host, () => {
    // eslint-disable-next-line no-console
    console.log(`Listening on http://${host}:${port}`);
});
