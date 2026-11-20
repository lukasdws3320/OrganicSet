import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Proxy configurável (SPEC §9 I31): IRH_API=http://127.0.0.1:4320 testa a UI contra um Hub de teste.
const API = process.env.IRH_API ?? "http://127.0.0.1:4317";

export default defineConfig({
  root: import.meta.dirname,
  plugins: [react(), tailwindcss()],
  build: { outDir: "dist", emptyOutDir: true },
  server: {
    port: 5191,
    strictPort: true,
    proxy: { "/api": API, "/media": API },
  },
});
