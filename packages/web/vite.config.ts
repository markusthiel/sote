import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  build: { outDir: 'dist', emptyOutDir: true },
  server: {
    port: 5173,
    // Im Betrieb liefert der Server die Oberfläche selbst aus; hier wird die
    // API durchgereicht, damit der Sitzungskeks dieselbe Herkunft hat.
    proxy: { '/api': 'http://127.0.0.1:8080' },
  },
});
