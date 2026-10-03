import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import { defineConfig } from "vite";

// In dev the API runs separately; proxy /api so the app is served from one origin, as in production.
const apiTarget = process.env.API_URL ?? `http://localhost:${process.env.API_PORT ?? 3000}`;

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "prompt",
      includeAssets: ["*.svg"],
      manifest: {
        name: "NextDrop",
        short_name: "NextDrop",
        start_url: "/",
        display: "standalone",
        theme_color: "#10201e",
        background_color: "#10201e",
        icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,woff2,json,png,svg}"],
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/api\//],
        cleanupOutdatedCaches: true,
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
      },
    }),
  ],
  server: {
    port: Number(process.env.WEB_PORT ?? 5173),
    proxy: { "/api": { target: apiTarget, changeOrigin: false } },
  },
});
