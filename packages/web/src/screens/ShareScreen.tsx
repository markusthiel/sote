/**
 * SOTE — was ein Gast sieht.
 *
 * **Kein Rahmen.** Keine Schiene, keine Seitenleiste, kein Kontomenü, kein
 * Workspace-Wechsler. Konzept 10e: es gibt keine anderen Orte, also auch keine
 * Liste davon — und ein Rahmen mit fünf Bereichen, von denen vier „nicht für
 * dich" antworten, ist schlimmer als kein Rahmen.
 *
 * Das ist auch der Grund, warum dieser Bildschirm **vor** der Anmeldeprüfung
 * gezeichnet wird und nicht in der Hülle: er braucht kein Konto, und eine
 * Anmeldemaske vor einem Link zu zeigen wäre die Aufforderung, sich etwas
 * anzulegen, um etwas zu sehen, das man geschickt bekommen hat.
 *
 * ## Was hier absichtlich fehlt
 *
 * Kein Suchfeld, keine Zeit-Ansichten, keine Detailspalte, keine
 * Teilaufgaben. Nicht weil es gefährlich wäre, sondern weil es **nicht zum
 * Projekt gehört**: wer eine Liste abarbeiten soll, braucht die Liste. Jede
 * Angabe mehr macht eine Freigabe über ihren Gegenstand hinaus.
 */

import { useCallback, useEffect, useState } from 'react';

import { useNudge } from '../hooks/useNudge.js';
import { api, ApiError, type Task } from '../api.js';
import { TaskRow } from '../components/TaskRow.js';
import { Detail, guestIO } from './Detail.js';
import { PanelRightIcon } from '../components/icons.js';
import { SoteMark } from '../components/Logo.js';
import { QuickAdd } from '../components/QuickAdd.js';

export function ShareScreen({ token, now }: { token: string; now: Date }) {
  const [head, setHead] = useState<{ name: string; right: 'read' | 'edit' } | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const [gone, setGone] = useState(false);
  const [showDone, setShowDone] = useState(false);
  /** Welche Aufgabe offen ist — ein Zustand, kein Ort: ein Gast hat keine Adresse. */
  const [offenAufgabe, setOffenAufgabe] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [oben, liste] = await Promise.all([
      api.shareHead(token),
      api.shareTasks(token, showDone),
    ]);
    setHead({ name: oben.project.name, right: oben.right });
    setTasks(liste.tasks);
  }, [token, showDone]);

  /*
   * Auch der Gast bekommt eine Klingel.
   *
   * Sein Strom hängt an seinem Token, und **der Server filtert** — nur er
   * kennt den Zugang. Der Preis steht in `nudge.ts`: ein Gast erfährt damit,
   * *dass* im Arbeitsbereich etwas passiert ist, auch wenn es ein anderes
   * Projekt war. Was er **sieht**, entscheidet weiter seine Route, und die
   * kennt nur sein Projekt.
   */
  useNudge(`/api/share/${token}/stream`, 'tasks', () => {
    void load().catch(() => undefined);
  });

  useEffect(() => {
    void load().catch((e: unknown) => {
      /*
       * Ein Satz für alle Fälle, wie im Server.
       *
       * „Abgelaufen" gegen „widerrufen" gegen „gibt es nicht" wäre eine
       * Auskunft darüber, ob dieser Token einmal gültig war — und die
       * Oberfläche darf nicht mehr sagen als die Antwort, die sie bekommt.
       */
      if (e instanceof ApiError && e.status === 404) setGone(true);
      else setNotice('Laden ging nicht.');
    });
  }, [load]);

  if (gone) {
    return (
      <div className="guest">
        <div className="guest-head">
          <SoteMark size={22} />
        </div>
        {/* In derselben zentrierten Spalte wie alles andere: im Bild klebte
            dieser Satz am linken Rand, weil er `guest-body` nicht benutzte —
            und der Zustand, den man am seltensten baut, ist der, den man am
            ehesten so stehen lässt. */}
        <div className="guest-body">
          <div className="empty">
            <strong>Dieser Link gilt nicht mehr.</strong>
            Wer ihn geschickt hat, kann einen neuen anlegen.
          </div>
        </div>
      </div>
    );
  }

  const darfSchreiben = head?.right === 'edit';

  async function tun(fn: () => Promise<unknown>, wenn: string) {
    setBusy(true);
    setNotice(undefined);
    try {
      await fn();
      await load();
    } catch (e) {
      setNotice(e instanceof ApiError ? e.message : wenn);
    } finally {
      setBusy(false);
    }
  }

  const offen = tasks.filter((t) => t.completed === null);
  const erledigt = tasks.filter((t) => t.completed !== null);

  /*
    DIESELBE ZEILE WIE BEIM MITGLIED.

    GEMELDET: „Die geteilte Ansicht klappt nicht korrekt. Da müssen wir
    vermutlich an Features noch nachziehen. Sortieren, Unteraufgaben, Drag and
    Drop, das ganze Untermenü."

    Die Ursache war eine EIGENE Zeile: dieser Bildschirm baute sich seine aus
    Kästchen und Titel, und alles, was seitdem an einer Zeile dazugekommen ist
    — Schlagwörter, Dauer, Merkmale für Notiz und Anhang, das eigene Aussehen,
    die Anzeigeformen — kam hier nie an. Zwei Zeichnungen derselben Sache
    laufen auseinander, und dies ist der Beleg dafür in Monaten.

    Jetzt `TaskRow`, dasselbe Bauteil. Was der Gast dadurch NICHT bekommt, ist
    bewusst ausgelassen und nicht vergessen: kein Anfasser (Ziehen wäre eine
    Reihenfolge, die der Server für eine Freigabe nicht schreibt) und kein
    Zeilenmenü (es führt in den Papierkorb und zu Prioritäten — beides
    Wirkungen ausserhalb dessen, was eine Freigabe hergibt).
  */
  const zeile = (t: Task) => (
    <TaskRow
      key={t.id}
      task={t}
      now={now}
      open={offenAufgabe === t.id}
      onOpen={() => setOffenAufgabe(offenAufgabe === t.id ? null : t.id)}
      onComplete={() =>
        void tun(
          () =>
            t.completed === null
              ? api.shareComplete(token, t.id)
              : api.shareReopen(token, t.id),
          t.completed === null ? 'Abhaken ging nicht.' : 'Wieder öffnen ging nicht.',
        )
      }
    />
  );

  return (
    <div className="guest" data-detail={offenAufgabe !== null}>
      <div className="guest-head">
        <SoteMark size={22} />
        {/*
          Der Schliessen-Knopf fuer die Detailspalte — aussen, links neben ihr,
          wie in der Anwendung selbst.

          Er stand frueher IN der Spalte; als er dort wegfiel (die Spalte ist
          ein Reiter-Panel geworden und der Knopf gehoert nach aussen), haette
          ein Gast sie nicht mehr zubekommen. Der Gast-Bildschirm hat keine
          Kopfleiste wie die Anwendung, also bekommt er den Knopf hier.
        */}
        {offenAufgabe === null ? null : (
          <button
            type="button"
            className="topbar-knob"
            aria-label="Detailspalte schliessen"
            title="Detailspalte schliessen"
            aria-pressed={true}
            onClick={() => setOffenAufgabe(null)}
          >
            <PanelRightIcon size={17} />
          </button>
        )}
        <span className="guest-right">
          {head === null
            ? ''
            : darfSchreiben
              ? 'Du darfst mitarbeiten'
              : 'Du darfst mitlesen'}
        </span>
      </div>

      <div className="guest-body">
        <h1>{head?.name ?? ''}</h1>
        <p className="sub">
          Eine geteilte Liste. Nur dieses Projekt — nichts darüber und nichts daneben.
        </p>

        {notice === undefined ? null : <p className="note-error">{notice}</p>}

        {darfSchreiben ? (
          <QuickAdd
            now={now}
            busy={busy}
            unknownProject={null}
            // Ohne `#projekt`: das Projekt ist gesetzt, und ein Platzhalter,
            // der etwas anderes anbietet, wäre ein Versprechen, das der Server
            // absichtlich nicht hält.
            hint="Aufgabe hinzufügen — „morgen 9 Uhr !!“"
            onSubmit={(line) =>
              void tun(() => api.shareAdd(token, line), 'Anlegen ging nicht.')
            }
          />
        ) : null}

        {offen.map(zeile)}

        {offen.length === 0 && erledigt.length === 0 ? (
          <div className="empty">
            <strong>Diese Liste ist leer.</strong>
            {darfSchreiben ? 'Tippe oben eine Zeile.' : 'Noch steht nichts darin.'}
          </div>
        ) : null}

        {/* Erledigtes wie überall: eingeblendet auf Wunsch, ausgegraut, unten.
            Hier ohne Gedächtnis — ein Gast hat keine Sitzung, in der man etwas
            merken würde, und ein Eintrag im Speicher dieses Browsers für einen
            fremden Link wäre eine Spur, die niemand bestellt hat. */}
        <button
          type="button"
          className="btn quiet small guest-toggle"
          aria-pressed={showDone}
          onClick={() => setShowDone((v) => !v)}
        >
          {showDone ? 'Erledigte ausblenden' : 'Erledigte einblenden'}
        </button>

        {erledigt.length > 0 ? (
          <>
            <div className="section-label done">
              Erledigt
              <span className="rule" />
            </div>
            {erledigt.map(zeile)}
          </>
        ) : null}
      </div>

      {/*
        DIESELBE Spalte wie beim Mitglied, über eine andere Anbindung.
        Sie zweimal zu bauen wäre zweimal derselbe Bildschirm, und der eine
        hätte irgendwann ein Feld, das der andere nicht hat.

        Die Spalte holt ihre Projektliste selbst und bekommt sie nicht übergeben
        — beim Gast liefert `/api/projects` nichts, weil er keine Sitzung hat,
        und dann fehlt der Ortswechsler von selbst. Ein Gast verschiebt nichts:
        das wäre ein Weg aus der Freigabe hinaus, und der Server lehnt es
        ohnehin ab.
      */}
      {offenAufgabe === null ? null : (
        <Detail
          taskId={offenAufgabe}
          workspace={undefined}
          io={guestIO(token, offenAufgabe)}
          // Ohne Schreibrecht sind die Felder ABWESEND, nicht deaktiviert:
          // der Server lehnt mit 403 ab, und ein Feld, in das man tippen kann
          // und das dann ablehnt, ist schlimmer als keines.
          onClose={() => setOffenAufgabe(null)}
          canWrite={darfSchreiben}
          now={new Date()}
          onChanged={() => void load().catch(() => undefined)}
        />
      )}
    </div>
  );
}
