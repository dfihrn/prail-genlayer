import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

const projectFile = (path) => fileURLToPath(new URL(path, import.meta.url));

const studioNextRoute = () => ({
  name: "studio-next-route",
  configureServer(server) {
    server.middlewares.use((request, _response, next) => {
      if (request.url === "/next") request.url = "/next/";
      next();
    });
  },
  configurePreviewServer(server) {
    server.middlewares.use((request, _response, next) => {
      if (request.url === "/next") request.url = "/next/";
      next();
    });
  },
});

export default defineConfig({
  plugins: [studioNextRoute()],
  optimizeDeps: {
    noDiscovery: true,
  },
  build: {
    rollupOptions: {
      input: {
        stable: projectFile("./index.html"),
        studioNext: projectFile("./next/index.html"),
      },
    },
  },
});
