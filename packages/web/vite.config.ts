import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        /*
         * Der Zeichensatz in einen eigenen Brocken.
         *
         * SOTE liefert wie SONE den ganzen Lucide-Satz aus, damit der Wähler
         * durchsuchbar ist statt eine Auswahl anzubieten, die jemand einmal
         * getroffen hat. Das kostet: das Bündel wuchs von 253 KB auf 1,26 MB.
         * SONEs Hauptbündel liegt bei 2 MB, also ist das dieselbe Größenordnung
         * — aber der Satz ändert sich fast nie, und der Rest der Anwendung bei
         * jedem Commit. Getrennt bleibt er im Zwischenspeicher liegen, statt
         * bei jeder Auslieferung neu über die Leitung zu gehen.
         */
        manualChunks: (id) => (id.includes('lucide-react') ? 'icons' : undefined),
      },
    },
  },
  server: {
    port: 5173,
    // Im Betrieb liefert der Server die Oberfläche selbst aus; hier wird die
    // API durchgereicht, damit der Sitzungskeks dieselbe Herkunft hat.
    proxy: { '/api': 'http://127.0.0.1:8080' },
  },
});
