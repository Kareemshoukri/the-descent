import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  // GitHub Pages serves this repository under /the-descent/. Local builds
  // keep using / so the LAN preview continues to work unchanged.
  base: process.env.BASE_PATH || "/",
  plugins: [react()],
  server: { host: true, port: 5173 },
  build: { target: "es2020" },
});
