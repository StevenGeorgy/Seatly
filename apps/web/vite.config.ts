import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Load `.env` from the monorepo root so `VITE_*` matches `.env.example` (root copy).
const repoRoot = path.resolve(__dirname, "..", "..");

// https://vite.dev/config/
export default defineConfig({
  envDir: repoRoot,
  /** Allow root `.env` keys from Next-era template (`NEXT_PUBLIC_*`) alongside `VITE_*`. */
  envPrefix: ["VITE_", "NEXT_PUBLIC_"],
  plugins: [react(), tailwindcss()],
  build: {
    // MapLibre is an intentionally heavy map engine; keep the warning focused
    // on accidental app chunks after route/vendor splitting.
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          if (id.includes("maplibre-gl") || id.includes("react-map-gl")) return "vendor-map";
          if (id.includes("konva") || id.includes("react-konva")) return "vendor-canvas";
          if (id.includes("recharts")) return "vendor-charts";
          if (id.includes("@supabase")) return "vendor-supabase";
          if (id.includes("framer-motion")) return "vendor-motion";
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
