/**
 * SOTE — was `?url` bedeutet.
 *
 * Vite kennt die Endung und liefert die Adresse der gebauten Datei; der
 * Übersetzer kennt sie nicht und sieht ein Modul ohne Typ. Ohne diese Zeilen
 * bricht `pnpm typecheck` an einem Import, den der Bündler klaglos auflöst —
 * und das ist die unangenehmste Sorte Fehler: einer, der nur in einem der
 * beiden Werkzeuge auftritt.
 *
 * `vite/client` mitzunehmen wäre der andere Weg; er bringt aber die Typen für
 * alle Vite-Eigenheiten mit, und gebraucht wird eine.
 */
declare module '*?url' {
  const url: string;
  export default url;
}
