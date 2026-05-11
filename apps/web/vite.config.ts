import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const repoRoot = path.resolve(__dirname, "..", "..");

export default defineConfig({
  envDir: repoRoot,
  envPrefix: ["VITE_", "NEXT_PUBLIC_"],
  plugins: [react(), tailwindcss()],
  // Exclude harness/test output paths from chokidar so a running
  // `cenaiva-test-harness.mjs` doesn't trigger HMR full-reloads when it
  // rewrites `apps/web/scripts/test-results.json` after every test (root
  // cause of the reload-loop the user hit on 2026-05-11 while inspecting
  // newly-added restaurants in /dashboard).
  server: {
    watch: {
      ignored: [
        "**/scripts/test-results.json",
        "**/scripts/*.log",
        "**/test-results/**",
      ],
    },
  },
  build: {
    chunkSizeWarningLimit: 900,
    modulePreload: {
      // Heavy lazy-only chunks dropped from the entry's modulepreload list.
      resolveDependencies(_filename, deps) {
        return deps.filter((dep) => !/vendor-map|vendor-canvas|vendor-charts|vendor-zod|vendor-forms|FloorPlanPage/.test(dep));
      },
    },
    rollupOptions: {
      output: {
        manualChunks(id) {
          // Pin Vite/Rolldown internal helpers to the catch-all `vendor`
          // chunk so they aren't hoisted into a route-vendor chunk; if
          // preload-helper lands in vendor-map, the entry will statically
          // import vendor-map and lazy loading is defeated.
          if (id.includes(" ") || /\bvite\/(preload-helper|client|env)/.test(id)) return "vendor";
          if (!id.includes("node_modules")) return undefined;
          if (id.includes("maplibre-gl") || id.includes("react-map-gl") || id.includes("@vis.gl/react-maplibre")) return "vendor-map";
          if (id.includes("konva") || id.includes("react-konva")) return "vendor-canvas";
          if (id.includes("recharts")) return "vendor-charts";
          if (id.includes("@supabase")) return "vendor-supabase";
          if (id.includes("framer-motion") || id.includes("motion-dom") || id.includes("motion-utils")) return "vendor-motion";
          if (id.includes("/zod/") || id.includes("@hookform/resolvers")) return "vendor-zod";
          if (id.includes("react-hook-form")) return "vendor-forms";
          if (id.includes("@radix-ui") || id.includes("radix-ui")) return "vendor-ui";
          if (id.includes("date-fns")) return "vendor-date";
          if (id.includes("react") || id.includes("react-dom") || id.includes("react-router")) return "vendor-react";
          return "vendor";
        },
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
