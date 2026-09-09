import path from "path";
import fs from "fs";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import svgr from "vite-plugin-svgr";

const sslCertPath = path.join(process.cwd(), "ssl/skynet.crt");
const sslKeyPath = path.join(process.cwd(), "ssl/skynet.key");

const hasSSL = fs.existsSync(sslCertPath) && fs.existsSync(sslKeyPath);
const useHTTPS = process.env.VITE_HTTPS === "true" && hasSSL;
const packageJson = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8"),
) as { version?: string };

const manualChunkGroups: Record<string, string[]> = {
  "react-vendor": ["react", "react-dom"],
  "ui-vendor": [
    "@radix-ui/react-dialog",
    "@radix-ui/react-dropdown-menu",
    "@radix-ui/react-select",
    "@radix-ui/react-tabs",
    "@radix-ui/react-switch",
    "@radix-ui/react-tooltip",
    "@radix-ui/react-scroll-area",
    "@radix-ui/react-separator",
    "lucide-react",
    "clsx",
    "tailwind-merge",
    "class-variance-authority",
  ],
  monaco: ["@monaco-editor/react", "monaco-editor"],
  "terminal-vendor": [
    "@xterm/addon-clipboard",
    "@xterm/addon-fit",
    "@xterm/addon-unicode11",
    "@xterm/addon-web-links",
    "@xterm/xterm",
    "react-xtermjs",
  ],
  // codemirror intentionally NOT split into its own manualChunk (POC 2026-09-08).
  // Rolldown eagerly module-preloads every named manualChunk from the entry
  // HTML — so making `codemirror` a named chunk here would preload ~120 KB
  // gzipped on cold-shell even though its ONLY consumer (SSHAuthDialog via
  // Terminal.tsx) is now `React.lazy`. Letting it fall through to the default
  // (bundle into whichever lazy chunk imports it — SSHAuthDialog) keeps
  // codemirror out of the preload manifest and defers the fetch to when the
  // dialog actually opens.
  "remote-desktop-vendor": ["guacamole-common-js"],
  "graph-vendor": ["cytoscape", "react-cytoscapejs"],
  "markdown-vendor": ["react-markdown", "remark-gfm"],
};

function getManualChunk(id: string): string | undefined {
  if (!id.includes("node_modules")) return undefined;

  const normalizedId = id.replaceAll("\\", "/");

  for (const [chunkName, packages] of Object.entries(manualChunkGroups)) {
    if (
      packages.some((packageName) =>
        normalizedId.includes(`/node_modules/${packageName}/`),
      )
    ) {
      return chunkName;
    }
  }

  return undefined;
}

export default defineConfig({
  plugins: [react(), tailwindcss(), svgr()],
  define: {
    "import.meta.env.VITE_APP_VERSION": JSON.stringify(
      packageJson.version || "0.0.0",
    ),
  },
  resolve: {
    alias: {
      "@/types": path.resolve(__dirname, "./src/types"),
      "@": path.resolve(__dirname, "./src/ui"),
    },
  },
  base: process.env.VITE_BASE_PATH || "./",
  build: {
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: getManualChunk,
      },
    },
    chunkSizeWarningLimit: 1000,
  },
  server: {
    https: useHTTPS
      ? {
          cert: fs.readFileSync(sslCertPath),
          key: fs.readFileSync(sslKeyPath),
        }
      : false,
    port: 5173,
    host: "localhost",
  },
});
