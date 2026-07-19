import { defineConfig } from "vitest/config";
import path from "path";

// Mirrors the `@` → ./src alias from vite.config.ts. Kept separate so tests
// don't pull in the react/tailwind plugins or the Tauri dev-server setup.
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
