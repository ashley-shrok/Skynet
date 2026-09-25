import type { Reroute } from '@sveltejs/kit';
import { PANE_BASE } from '$lib/pane';

// Universal reroute — runs BEFORE URL normalization and route matching, on
// both server SSR and client-side navigation. When a URL arrives with the
// pane prefix intact (the .serve. tab origin never gets it stripped by a
// proxy the way the pane iframe does), map it to the corresponding no-prefix
// route so both mount contexts hit the same route handlers.
export const reroute: Reroute = ({ url }) => {
    const p = url.pathname;
    if (p === PANE_BASE) return '/';
    if (p.startsWith(PANE_BASE + '/')) return p.slice(PANE_BASE.length);
};
