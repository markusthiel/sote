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
import { api, ApiError } from '../api.js';
import { SoteMark } from '../components/Logo.js';
import { QuickAdd } from '../components/QuickAdd.js';

interface GuestTask {
  id: string;
  title: string;
  completed: string | null;
  plannedAt: string | null;
  dueAt: string | null;
  priority: number;
}

export function ShareScreen({ token, now }: { token: string; now: Date }) {
  const [head, setHead] = useState<{ name: string; right: 'read' | 'edit' } | null>(null);
  const [tasks, setTasks] = useState<GuestTask[]>([]);
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const [gone, setGone] = useState(false);
  const [showDone, setShowDone] = useState(false);
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

  const zeile = (t: GuestTask) => (
    <div className="task" data-done={t.completed !== null} key={t.id}>
      <button
        className="task-box"
        data-priority={t.priority}
        data-done={t.completed !== null}
        aria-label={t.completed !== null ? `${t.title} wieder öffnen` : `${t.title} abhaken`}
        aria-pressed={t.completed !== null}
        /*
         * Ohne Schreibrecht ist das Kästchen ABWESEND und nicht deaktiviert.
         *
         * Ein Knopf, der aussieht wie einer und nichts tut, war in diesem
         * Projekt sechs Mal der Fehler. Hier gibt es einen Grund, ihn gar
         * nicht zu zeichnen: wer nur lesen darf, hat nichts zu drücken.
         */
        disabled={busy}
        onClick={() =>
          void tun(
            () =>
              t.completed === null
                ? api.shareComplete(token, t.id)
                : api.shareReopen(token, t.id),
            t.completed === null ? 'Abhaken ging nicht.' : 'Wieder öffnen ging nicht.',
          )
        }
      >
        <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true">
          <path
            d="M2 6.5 4.7 9 10 3.2"
            fill="none"
            stroke={t.completed !== null ? 'var(--accent-on)' : 'var(--text-muted)'}
            strokeWidth="1.8"
          />
        </svg>
      </button>
      <div className="task-mid">
        <div className="task-title">{t.title}</div>
      </div>
    </div>
  );

  return (
    <div className="guest">
      <div className="guest-head">
        <SoteMark size={22} />
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
          className="head-toggle guest-toggle"
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
    </div>
  );
}
