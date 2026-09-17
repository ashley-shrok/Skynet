import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
    plugins: [tailwindcss(), sveltekit()],
    // bun:sqlite is a Bun-native module; Vite can't bundle it. Leave it
    // external so the built output imports it verbatim (which Bun then
    // resolves at runtime).
    ssr: {
        external: ['bun:sqlite']
    }
});
