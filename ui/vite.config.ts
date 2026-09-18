import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    /*
     * The Car Thing's browser is Chromium 69 era — the stock image is
     * QtWebEngine 5.12.7, and the custom images still build for it. Anything
     * newer in the output is not a degraded layout, it is a syntax error and a
     * blank screen: optional chaining and nullish coalescing both arrived in
     * Chrome 80. scripts/check-device-compat.mjs enforces this.
     */
    target: 'chrome69'
  },
  server: {
    port: 5173,
    // `npm run dev:ui` talks to a host started with `npm start`.
    proxy: {
      '/ws': { target: 'ws://localhost:3000', ws: true },
      '/files': { target: 'http://localhost:3000' }
    }
  }
});
