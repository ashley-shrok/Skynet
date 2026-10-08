import adapter from '@sveltejs/adapter-node';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
    preprocess: vitePreprocess(),
    kit: {
        adapter: adapter(),
        // Emit assets as absolute-from-root (/_app/immutable/...) instead of
        // relative (../_app/...). The app's pane proxy injects a <base> tag
        // whose depth doesn't match SvelteKit's route-URL depth, so relative
        // asset URLs resolve incorrectly at deep pages (subdirectories,
        // catch-all routes, etc.). src/hooks.server.ts's transformPageChunk
        // then prefixes /_app/ with PANE_BASE so browser fetches route back
        // through the proxy. Do NOT flip this to true without also removing
        // the transformPageChunk rewrite — they're a matched pair.
        paths: {
            relative: false
        },
        // The app's reverse-proxy at /apps/:hostId/:slug/pane/* enforces the
        // same-origin (CSRF) check at its boundary before forwarding requests
        // to this app — see src/backend/apps/app-proxy-csrf-check.ts in the
        // app's source repo. The built-in SvelteKit Origin check stays disabled
        // here BECAUSE the proxy is the enforcement site, not as a shortcut:
        // a proxied POST arrives at 127.0.0.1:PORT with an Origin header
        // naming the app's own domain (not 127.0.0.1:PORT), which the default
        // check would refuse. Apps served directly (bypassing the pane proxy
        // — e.g. via the .serve. per-port URL for a fresh-tab open) rely on
        // the tailnet perimeter + the app's edge auth. Do NOT delete the
        // trustedOrigins line below — removing it breaks every proxied POST.
        // (Historical: this used csrf.checkOrigin: false; SvelteKit 2.x
        // deprecated that in favour of trustedOrigins.)
        csrf: {
            trustedOrigins: ['*']
        }
    }
};

export default config;
