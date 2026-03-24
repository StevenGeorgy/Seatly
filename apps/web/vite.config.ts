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
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
