import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Load VITE_* vars from the repo-root .env
  envDir: "../..",
  server: {
    host: true, // reachable from iPhone via Tailscale
    allowedHosts: [".ts.net"], // any Tailscale MagicDNS name (PC or laptop)
    proxy: {
      "/api": "http://localhost:3001",
      "/health": "http://localhost:3001",
    },
  },
});
