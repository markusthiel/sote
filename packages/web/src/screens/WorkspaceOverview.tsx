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
        {/*
          SONEs `admin-list`: Zeilen, keine Tabelle.
          
          Eine Tabelle behauptet, ihre Spalten seien vergleichbar — hier ist
          links ein Name und rechts eine Rolle, und die vergleicht niemand
          spaltenweise. SONEs Zeile sagt dasselbe ohne die Behauptung: links
          Name und Beiwerk, rechts, was man damit tun kann.
        */}
        <div className="admin-list">
          {workspaces.map((w) => (
            <div className="admin-row" key={w.id} aria-current={w.id === current}>
              <div className="admin-row-main">
                <span className="admin-name">
                  <span className="ws-dot" aria-hidden="true" />
                  {w.name}
                  {w.id === current ? <span className="ws-here"> · du bist hier</span> : null}
                </span>
              </div>
              {/* Die Lücke von vorhin ist zu: die Rolle kommt aus `/api/me`. */}
              <div className="admin-row-actions">{w.owner ? 'Eigentümer' : 'Mitglied'}</div>
            </div>
          ))}
        </div>
        {/* Stand hier: „Weitere anzulegen gibt es noch nicht." Ehrlich damals,
            falsch seit dem Fuß im Wähler — und im Bild gefunden, nicht im Code. */}
        <p className="muted small">
          Einen weiteren legst du oben im Wähler an — „Neuer Arbeitsbereich".
        </p>
      </section>
    </div>
  );
}
