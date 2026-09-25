import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      strategies: "injectManifest",
      srcDir: "public",
      filename: "sw.js",
      injectRegister: null,
      manifest: false,
      injectManifest: {
        globPatterns: ["**/*.{js,css,html,svg,webmanifest}"],
        globIgnores: ["sw.js"],
      },
    }),
  ],
  server: {
    proxy: {
      "/api": "http://localhost:4174",
      "/health": "http://localhost:4174",
    },
  },
});
