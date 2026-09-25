// Custom entry that wraps the SvelteKit-built handler and strips the pane
// prefix from incoming URLs BEFORE adapter-node's static-file middleware
// (sirv) sees them. adapter-node's sirv runs before your SvelteKit hooks
// and serves _app/immutable/* files by their literal on-disk path — so a
// tab-serve request for /apps/<hostId>/<slug>/pane/_app/… reaches sirv
// unchanged (no proxy stripped it), and sirv 404s because that path doesn't
// exist on disk. Stripping here lets sirv find the file at /_app/… as usual.
// Works identically for the pane iframe (which already got the prefix
// stripped by Skynet's proxy — this hook is then a no-op for those requests).
//
// The BASE constant duplicates src/lib/pane.ts's PANE_BASE rather than
// importing it — server.js runs post-build against the compiled bundle, and
// chunk paths under build/server/chunks/ are content-hashed + change per
// build, which makes importing awkward. create-app.sh substitutes __HOSTID__
// and __SLUG__ in BOTH files at scaffold time.
import http from 'node:http';
import { handler } from './build/handler.js';

const BASE = '/apps/__HOSTID__/__SLUG__/pane';

const port = parseInt(process.env.PORT ?? '3000', 10);
const host = process.env.HOST ?? '127.0.0.1';

const server = http.createServer((req, res) => {
    if (req.url) {
        if (req.url === BASE) {
            req.url = '/';
        } else if (req.url.startsWith(BASE + '/')) {
            req.url = req.url.slice(BASE.length);
        }
    }
    handler(req, res);
});

server.listen(port, host, () => {
    // eslint-disable-next-line no-console
    console.log(`Listening on http://${host}:${port}`);
});
