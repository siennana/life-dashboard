import os from "node:os";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Load VITE_* vars from the repo-root .env
  envDir: "../..",
  server: {
    host: true, // reachable from iPhone via Tailscale
    // Any Tailscale MagicDNS name (PC or laptop), plus this machine's bare
    // hostname — MagicDNS search domains let devices use the short name too.
    allowedHosts: [".ts.net", os.hostname().toLowerCase()],
    proxy: {
      "/api": "http://localhost:3001",
      "/health": "http://localhost:3001",
    },
  },
});
