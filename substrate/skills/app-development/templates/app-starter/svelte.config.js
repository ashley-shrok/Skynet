import adapter from '@sveltejs/adapter-node';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
    preprocess: vitePreprocess(),
    kit: {
        adapter: adapter(),
        // The security boundary is the front-end client's edge, not this
        // app's form endpoints. Disable SvelteKit's Origin-check CSRF so a
        // proxied POST from the client isn't blocked when the browser's
        // Origin header names the client's domain, not 127.0.0.1:PORT.
        csrf: {
            checkOrigin: false
        }
    }
};

export default config;
