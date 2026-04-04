import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import basicSsl from "@vitejs/plugin-basic-ssl";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Load `.env` from the monorepo root so `VITE_*` matches `.env.example` (root copy).
const repoRoot = path.resolve(__dirname, "..", "..");

// https://vite.dev/config/
export default defineConfig({
  envDir: repoRoot,
  /** Allow root `.env` keys from Next-era template (`NEXT_PUBLIC_*`) alongside `VITE_*`. */
  envPrefix: ["VITE_", "NEXT_PUBLIC_"],
  // Self-signed HTTPS in dev so browsers treat the origin as secure (card fields, autofill, etc.).
  plugins: [react(), tailwindcss(), basicSsl()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
