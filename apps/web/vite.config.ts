import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const backend = "http://127.0.0.1:4600";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 4601,
    proxy: { "/api": backend, "/files": backend },
  },
});
