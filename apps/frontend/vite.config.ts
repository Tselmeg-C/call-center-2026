import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [tanstackRouter({ target: "react" }), react(), tailwindcss()],
  resolve: { alias: { "@": resolve(process.cwd(), "src") } },
  server: {
    proxy: { "/api": { target: "http://localhost:8000", rewrite: (path) => path.replace(/^\/api/, "") } },
  },
});
