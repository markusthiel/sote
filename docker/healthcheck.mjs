// SOTE — Healthcheck des Containers.
//
// Fragt `/api/health` und **nicht** eine Route, die die Datenbank braucht.
// Docker startet einen Container neu, dessen Healthcheck scheitert; hinge er an
// Postgres, würde ein kurzer Aussetzer der Datenbank einen Server umbringen,
// der sich von allein erholt hätte.
//
// `SOTE_PORT` ist derselbe Name, den der Server liest. Compose gibt ihn
// absichtlich **nicht** in den Container — dort ist er also unbesetzt, und
// beide landen auf 8080. Wer ihn doch durchreicht, verschiebt Server und
// Healthcheck gemeinsam, und das ist die einzige Lesart, bei der beide
// zueinander passen.
const port = process.env.SOTE_PORT ?? 8080;
try {
  const res = await fetch(`http://127.0.0.1:${port}/api/health`, {
    signal: AbortSignal.timeout(4000),
  });
  process.exit(res.ok ? 0 : 1);
} catch {
  process.exit(1);
}
