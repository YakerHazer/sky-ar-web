import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

const SHARED = resolve(__dirname, "../shared/src");
// In dev, proxy the API to `vercel dev` (or any local server) on :3000 so the
// serverless functions are exercised. In production (Vercel) these routes are
// served by the platform.
const API_TARGET = process.env.API_TARGET ?? "http://localhost:3000";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@shared": SHARED },
  },
  server: {
    host: true,
    fs: { allow: [resolve(__dirname, ".."), SHARED] },
    proxy: {
      "/api": { target: API_TARGET, changeOrigin: true },
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
