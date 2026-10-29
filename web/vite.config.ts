import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  base: "./",
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.ts",
      injectManifest: { globPatterns: ["**/*.{js,css,html,svg,png}"] },
      includeAssets: ["icon.svg", "icon-192.png", "icon-512.png"],
      manifest: {
        name: "Nidou — l'assistant de votre famille",
        short_name: "Nidou",
        description: "Papiers, échéances et charges fixes de la famille, gérés par l'IA.",
        lang: "fr",
        theme_color: "#FBF4F0",
        background_color: "#FBF4F0",
        display: "standalone",
        start_url: "./",
        scope: "./",
        id: "./",
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png", purpose: "any maskable" },
        ],
      },
    }),
  ],
  server: { port: 5173, proxy: { "/api": "http://localhost:3000", "/mcp": "http://localhost:3000" } },
});
