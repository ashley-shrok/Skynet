import type { Handle } from '@sveltejs/kit';
import { PANE_BASE } from '$lib/pane';

// The Skynet pane proxy injects <base href="/apps/<hostId>/<slug>/pane/">
// into every HTML response so links written as relative URLs resolve back
// through the proxy. But it clashes with SvelteKit's absolute-from-root
// asset URLs (/_app/immutable/…): those bypass <base> per URL spec and hit
// Skynet's own root, 404. Rewrite /_app/ and /favicon references to include
// the pane prefix so the browser routes them back through the proxy. Same
// rewrite works on the .serve. tab origin (the app strips PANE_BASE via
// the reroute hook).
export const handle: Handle = async ({ event, resolve }) => {
    const response = await resolve(event, {
        transformPageChunk: ({ html }) => {
            return html
                .replaceAll('"/_app/', `"${PANE_BASE}/_app/`)
                .replaceAll('"/favicon.svg"', `"${PANE_BASE}/favicon.svg"`);
        }
    });
    // SvelteKit also emits </_app/…> URLs in the `Link:` preload response
    // header, which transformPageChunk can't touch. Same rewrite so
    // browsers preload assets through the pane path (otherwise every
    // navigation logs ~15 preload 404s + "preload not used" warnings).
    const link = response.headers.get('link');
    if (link && link.includes('</_app/')) {
        response.headers.set('link', link.replaceAll('</_app/', `<${PANE_BASE}/_app/`));
    }
    return response;
};
