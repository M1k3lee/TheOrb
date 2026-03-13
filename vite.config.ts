import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ command }) => ({
  base: command === "serve" ? "/" : "/TheOrb/",
  plugins: [react()],
  build: {
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/react") || id.includes("node_modules/react-dom")) {
            return "react-core";
          }

          if (id.includes("node_modules/@react-three/fiber")) {
            return "three-fiber";
          }

          if (id.includes("node_modules/@react-three/drei")) {
            return "three-drei";
          }

          if (
            id.includes("node_modules/@react-three/postprocessing") ||
            id.includes("node_modules/postprocessing")
          ) {
            return "three-postfx";
          }

          if (id.includes("node_modules/three")) {
            return "three-core";
          }

          return undefined;
        },
      },
    },
  },
  server: {
    host: "0.0.0.0",
  },
}));
