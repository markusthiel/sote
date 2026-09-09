/**
 * SOTE — alle Arbeitsbereiche.
 *
 * Die Übersicht, die in SONE unter „Alle Workspaces" steht: eine Tabelle mit
 * Namen, Leuten und Inhalt, und der aktuelle mit „du bist hier" markiert.
 *
 * Was hier **weniger** steht als dort, und warum: SONE zählt Seiten, SOTE
 * Aufgaben — und es gibt bis auf Weiteres genau einen Arbeitsbereich je Konto,
 * weil das Anlegen noch nicht gebaut ist. Eine Tabelle mit einer Zeile ist
 * kein Grund, keine Tabelle zu bauen: sie ist der Ort, an dem der zweite
 * Arbeitsbereich erscheint, ohne dass jemand danach suchen muss.
 *
 * Kein Eintrag „Neuer Workspace": es gibt keine Route dafür, und ein Eintrag,
 * der „gibt es nicht" antwortet, bringt Leute dazu, dem Bildschirm zu
 * misstrauen (SONEs ADR-0027). Stattdessen sagt eine Zeile, warum.
 */

export function WorkspaceOverview({
  workspaces,
  current,
}: {
  workspaces: readonly { id: string; name: string; owner: boolean }[];
  current: string | undefined;
}) {
  return (
    <div className="settings">
      <section className="settings-card">
        <h2>Alle Workspaces</h2>
        <table className="ws-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Deine Rolle</th>
            </tr>
          </thead>
          <tbody>
            {workspaces.map((w) => (
              <tr key={w.id} aria-current={w.id === current}>
                <td>
                  <span className="ws-dot" aria-hidden="true" />
                  {w.name}
                  {w.id === current ? <span className="ws-here"> · du bist hier</span> : null}
                </td>
                {/* Die Lücke von vorhin ist zu: die Rolle kommt jetzt aus
                    `/api/me` und steht nicht mehr fest. */}
                <td>{w.owner ? 'Eigentümer' : 'Mitglied'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted small">
          Weitere anzulegen gibt es noch nicht. Einer je Konto, und der gehört
          dir.
        </p>
      </section>
    </div>
  );
}
