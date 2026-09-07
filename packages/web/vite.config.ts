import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    /*
     * Kein `manualChunks` für den Zeichensatz mehr — und das ist der Punkt.
     *
     * Er lag in einem eigenen Brocken, damit er im Zwischenspeicher bleibt.
     * Richtig gedacht und am falschen Ende: ein eigener Brocken, den Vite per
     * `modulepreload` ins HTML schreibt, geht trotzdem bei **jedem** Laden über
     * die Leitung. Gemeldet als „hängt teilweise sekunden", gemessen als
     * 1018 KB und 663 ms bis zum ersten Inhalt bei vierfach gedrosseltem
     * Prozessor.
     *
     * `ProjectMark` holt den Satz jetzt per dynamischem Import, und daraus
     * baut Rollup von selbst einen eigenen Brocken — **ohne** Vorladen. Er
     * kommt, wenn ein Projekt wirklich ein Zeichen hat oder der Wähler aufgeht.
     * Wer keine Zeichen vergibt, lädt ihn nie.
     */
  },
  server: {
    port: 5173,
    // Im Betrieb liefert der Server die Oberfläche selbst aus; hier wird die
    // API durchgereicht, damit der Sitzungskeks dieselbe Herkunft hat.
    proxy: { '/api': 'http://127.0.0.1:8080' },
  },
});
