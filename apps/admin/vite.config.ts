import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => ({
  // In production the admin is served by the API under /admin, so built asset
  // URLs need that prefix. In development it runs at the dev server root.
  base: mode === "production" ? "/admin/" : "/",
  plugins: [react()],
  server: {
    // Kept off the storefront's port so both can run side by side.
    port: 5174,
    strictPort: true,
    proxy: {
      "/api": { target: "http://localhost:4000", changeOrigin: true },
      "/uploads": { target: "http://localhost:4000", changeOrigin: true },
      "/health": { target: "http://localhost:4000", changeOrigin: true },
    },
  },
}));