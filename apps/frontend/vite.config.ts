import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [tanstackStart({ srcDirectory: "." }), tanstackRouter({ target: "react", routesDirectory: "routes" }), react(), tailwindcss()],
  resolve: { alias: { "@": resolve(process.cwd()) } },
});
