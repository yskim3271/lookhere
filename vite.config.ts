import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The annotator UI is served by the lookhere node server from dist/web.
// In `npm run dev:web`, API calls are proxied to a running `lookhere` server.
export default defineConfig({
  root: "web",
  plugins: [react()],
  build: { outDir: "../dist/web", emptyOutDir: true },
  server: { proxy: { "/api": "http://127.0.0.1:7357" } },
  test: { root: ".", include: ["src/**/*.test.ts"] },
} as never);
