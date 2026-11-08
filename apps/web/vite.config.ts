import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          if (id.includes("lightweight-charts") || id.includes("fancy-canvas")) return "charts";
          if (/node_modules\/(react|react-dom|scheduler)\//.test(id)) return "react";
          return undefined;
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: process.env["HY_API"] ?? "http://localhost:8787",
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on("proxyRes", (res) => {
            if (res.headers["content-type"]?.includes("text/event-stream")) {
              res.headers["cache-control"] = "no-cache, no-transform";
              res.headers["x-accel-buffering"] = "no";
            }
          });
        },
      },
    },
  },
});
