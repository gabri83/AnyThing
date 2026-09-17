import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: { outDir: 'dist', emptyOutDir: true, target: 'es2020' },
  server: {
    port: 5173,
    // `npm run dev:ui` talks to a host started with `npm start`.
    proxy: {
      '/ws': { target: 'ws://localhost:3000', ws: true },
      '/files': { target: 'http://localhost:3000' }
    }
  }
});
