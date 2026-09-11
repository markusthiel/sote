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

/**
 * Und `?worker`: der Bündler baut daraus ein eigenes Stück und gibt eine
 * Klasse zurück, die es startet.
 *
 * Der Unterschied zu `?url` ist mehr als eine Schreibweise: die Datei bekommt
 * dabei die Endung `.js` statt `.mjs`, und genau daran ist der PDF-Arbeiter
 * gescheitert — ein Server, der `.mjs` nicht in seiner Typentabelle hat,
 * liefert `application/octet-stream`, und der Browser lehnt den Import ab.
 */
declare module '*?worker' {
  const Worker: new () => globalThis.Worker;
  export default Worker;
}
