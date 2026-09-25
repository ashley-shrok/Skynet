// The Skynet app-pane proxy at /apps/<hostId>/<slug>/pane/* strips this
// prefix before forwarding to your app, and injects <base href="/apps/…/pane/">
// into every HTML response. Root-absolute hrefs bypass that injected <base>
// (per URL spec, "/foo" resolves against the document ORIGIN, not the base),
// so an href like "/settings" would navigate the iframe back to Skynet's own
// root instead of into your app. We emit absolute hrefs already prefixed with
// the pane URL — the browser then routes correctly in both mount contexts
// (the pane iframe AND the direct .serve. tab origin).
//
// Two files carry the literal pane path: THIS file (agent-visible, imported
// symbolically everywhere internal-URL work happens) and ./server.js (custom
// Node entry — see its docblock). create-app.sh substitutes __HOSTID__ and
// __SLUG__ in both files at scaffold time, reading the numeric Skynet DB
// hostId from ~/.claude/skynet-hostid (a distributor-written file — you never
// need to know or look up the integer yourself).
//
// USAGE — for every internal URL your app emits:
//   <a href={`${PANE_BASE}/settings`}>Settings</a>
//   <img src={`${PANE_BASE}/logo.svg`} alt="" />
//   <video src={`${PANE_BASE}/api/video/x.mp4`} controls />
//   fetch(`${PANE_BASE}/api/foo`)
//   goto(`${PANE_BASE}/other-page`)
//
// External URLs (`https://…`, `//example.com/…`) work as-is — no prefixing.
export const PANE_BASE = '/apps/__HOSTID__/__SLUG__/pane';
