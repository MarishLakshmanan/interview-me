import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The page uses relative URLs; in development, /ws (interview) and /api (question plan) go to the backend.
export default defineConfig({
  plugins: [react()],
  // Never inline the worklet files as data: URLs; audioWorklet.addModule needs real files.
  build: { assetsInlineLimit: 0 },
  server: {
    proxy: {
      "/ws": { target: "ws://127.0.0.1:8000", ws: true },
      "/api": { target: "http://127.0.0.1:8000" },
    },
  },
});
