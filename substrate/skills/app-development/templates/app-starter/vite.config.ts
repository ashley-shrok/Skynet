import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig, type Plugin } from 'vite';
import { PANE_BASE } from './src/lib/pane';

// Client JS carries Vite's preload list (__vite__mapDeps) as root-absolute
// "/_app/immutable/…" URLs. In the pane iframe those resolve against the
// Skynet origin root, 404, and the failed CSS preload makes SvelteKit render
// its 500 page. src/hooks.server.ts prefixes /_app/ in HTML and the Link
// header, but never sees served JS — so prefix it here, in the built files.
// writeBundle, not renderChunk/generateBundle: the deps list is filled in
// after those run. The .serve. tab origin is fine with the prefix too
// (server.js strips it).
function paneBasePreloads(): Plugin {
    return {
        name: 'pane-base-preloads',
        apply: 'build',
        enforce: 'post',
        writeBundle(options, bundle) {
            if (!options.dir) return;
            for (const file of Object.values(bundle)) {
                if (file.type !== 'chunk' || !file.fileName.startsWith('_app/immutable/')) continue;
                const path = join(options.dir, file.fileName);
                const code = readFileSync(path, 'utf8');
                if (!code.includes('"/_app/immutable/')) continue;
                writeFileSync(path, code.replaceAll('"/_app/immutable/', `"${PANE_BASE}/_app/immutable/`));
            }
        }
    };
}

export default defineConfig({
    plugins: [tailwindcss(), sveltekit(), paneBasePreloads()],
    // bun:sqlite is a Bun-native module; Vite can't bundle it. Leave it
    // external so the built output imports it verbatim (which Bun then
    // resolves at runtime).
    ssr: {
        external: ['bun:sqlite']
    }
});
