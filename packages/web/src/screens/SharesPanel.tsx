/**
 * SOTE — das Menü der Freigaben, in der Leiste.
 *
 * Dieselbe Meldung wie bei SONE, und dort steht die Antwort schon
 * (`SharesPanel.tsx`, ADR-0069 und ADR-0092):
 *
 * > The screen shipped with all three lists stacked in the content column and
 * > nothing at all in the sidebar, which is the one shape ADR-0069 says this
 * > shell does not have: **the left column is the menu and the middle is what
 * > the menu chose.**
 *
 * ## Aber SONEs Achse gibt es hier nicht
 *
 * Dort sind es *Links, von mir, für mich* — drei Arten von Freigabe. SOTE hat
 * nur **eine** Art: einen Link. Die Achse, die es hier gibt, ist der
 * **Zustand**, und sie stammt aus der Sache selbst:
 *
 * * **Aktiv** ist, was gerade gilt.
 * * **Abgelaufen** gilt nicht mehr und steht trotzdem da — bis jemand es
 *   wegnimmt.
 * * **Nie benutzt** ist die nützlichste Zeile von allen: einen Link, den
 *   niemand geöffnet hat, kann man ohne Rückfrage zurückziehen. Bei einem
 *   benutzten muss man jemanden fragen.
 *
 * Gezählt wird aus der Liste, die der Bildschirm schon hält — wie beim
 * Posteingang: *„a menu that says ‚Links' without saying how many is a menu you
 * have to click to learn anything from"*, und eine zweite Abfrage für die Zahl
 * ist der Weg, auf dem eine Zahl und eine Liste uneins werden.
 */

/**
 * Was das Menü von einer Freigabe braucht — und **exportiert**, damit die
 * Hülle denselben Typ benutzt.
 *
 * Mein erster Versuch beschrieb ihn zweimal: hier vollständig und im Rückruf
 * als `{ id: string }`. Der Übersetzer hat es gemeldet, bevor daraus zwei
 * Vorstellungen von derselben Zeile wurden.
 */
export type ShareRow = {
  id: string;
  projectId: string;
  projectName: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
};

export type SharesView =
  | { of: 'all' }
  | { of: 'active' }
  | { of: 'expired' }
  | { of: 'unused' }
  | { of: 'project'; projectId: string };

/** Passt diese Zeile in diese Ansicht? Eine Stelle, zweimal gebraucht: Liste und Zahl. */
export function matchesShare(s: ShareRow, view: SharesView, now: Date): boolean {
  const abgelaufen = s.expiresAt !== null && new Date(s.expiresAt) < now;
  switch (view.of) {
    case 'active':
      return !abgelaufen;
    case 'expired':
      return abgelaufen;
    case 'unused':
      // Nie benutzt UND noch gültig: ein abgelaufener Link, den niemand
      // geöffnet hat, ist kein Fall zum Aufräumen, sondern schon vorbei.
      return s.lastUsedAt === null && !abgelaufen;
    case 'project':
      return s.projectId === view.projectId;
    default:
      return true;
  }
}

export function SharesPanel({
  shares,
  view,
  now,
  onPick,
}: {
  shares: readonly ShareRow[];
  view: SharesView;
  now: Date;
  onPick: (v: SharesView) => void;
}) {
  const zahl = (v: SharesView): number => shares.filter((s) => matchesShare(s, v, now)).length;
  const gleich = (a: SharesView, b: SharesView): boolean =>
    a.of === b.of &&
    (a.of !== 'project' || (b.of === 'project' && a.projectId === b.projectId));

  const zeile = (v: SharesView, label: string) => {
    const n = zahl(v);
    return (
      <button
        key={`${v.of}-${'projectId' in v ? v.projectId : ''}`}
        type="button"
        className="panel-row"
        aria-current={gleich(v, view)}
        onClick={() => onPick(v)}
      >
        <span>{label}</span>
        {/* Keine Null: eine Zahl über nichts ist Rauschen in einer ruhigen
            Zeile (SONEs ADR-0092). */}
        {n > 0 ? <span className="n">{n}</span> : null}
      </button>
    );
  };

  // Die Projekte kommen aus den Freigaben selbst: eines ohne Link wäre eine
  // Zeile, die auf eine leere Liste führt.
  const projekte = [...new Map(shares.map((s) => [s.projectId, s.projectName])).entries()];

  return (
    <>
      {zeile({ of: 'active' }, 'Aktiv')}
      {zeile({ of: 'all' }, 'Alle')}

      <div className="panel-group">Aufräumen</div>
      {zeile({ of: 'unused' }, 'Nie benutzt')}
      {zeile({ of: 'expired' }, 'Abgelaufen')}

      {projekte.length > 1 ? (
        <>
          {/* Erst ab zwei: eine Gruppe über einer einzigen Zeile ist eine
              Überschrift für etwas, das keine Wahl ist. */}
          <div className="panel-group">Projekt</div>
          {projekte.map(([id, name]) => zeile({ of: 'project', projectId: id }, name))}
        </>
      ) : null}
    </>
  );
}
