import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// In dev the API runs separately; proxy /api so the app is served from one origin, as in production.
const apiTarget = process.env.API_URL ?? `http://localhost:${process.env.API_PORT ?? 3000}`;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: Number(process.env.WEB_PORT ?? 5173),
    proxy: { "/api": { target: apiTarget, changeOrigin: false } },
  },
});
