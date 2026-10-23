import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// `npm run dev:server` serves the checkout on 4610; without it, the installed app on 4600.
const backend = process.env.MONO_BACKEND ?? "http://127.0.0.1:4600";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 4601,
    proxy: { "/api": backend, "/files": backend },
  },
});
