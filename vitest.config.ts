import path from "path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@/types": path.resolve(__dirname, "./src/types"),
      "@": path.resolve(__dirname, "./src/ui"),
    },
  },
  test: {
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    // Phase 45 Plan 45-05 ship-readiness deviation:
    // Default vitest testTimeout of 5000ms is too tight for this box's typical
    // fleet-load conditions (uptime load-avg 8-11 vs a lightly-loaded dev box's
    // 1-2). Under that load, otherwise-healthy tests (e.g. Test CC in
    // NewSessionDialog, Tests A/B in PrettyView.hydration-cap, Test C in
    // PrettyView) intermittently exceed 5s wall-clock while passing in <2s of
    // test-body time. Isolated re-runs with --testTimeout=30000 pass green.
    // Bumping the global default to 30s satisfies fleet standing directive #1
    // (never leave tests failing) without touching individual test files and
    // matches the per-test override precedent established in Plan 45-01
    // Deviation 1 (Test 6 in PrettyView.windowed-pagination.test.tsx). See
    // 45-05-SHIP-READINESS.md § Deviations for the full analysis.
    testTimeout: 30_000,
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      reportsDirectory: "./coverage",
      exclude: [
        "**/node_modules/**",
        "**/dist/**",
        "**/coverage/**",
        "electron/**",
        "scripts/**",
        "**/*.config.*",
        "**/*.test.{ts,tsx}",
        "src/backend/test-helpers/**",
        "src/ui/locales/**",
      ],
    },
    projects: [
      {
        extends: true,
        test: {
          name: "backend",
          environment: "node",
          include: ["src/backend/**/*.test.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "frontend",
          environment: "jsdom",
          include: ["src/ui/**/*.test.{ts,tsx}"],
        },
      },
    ],
  },
});
