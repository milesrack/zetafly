import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: { license: { fileName: "third-party-licenses.txt" } },
  server: {
    proxy: {
      "/api": "http://127.0.0.1:3000",
      "/live": { target: "ws://127.0.0.1:3000", ws: true },
    },
  },
});
