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

import { useCallback, useEffect, useRef, useState } from 'react';

import { useNudge } from '../hooks/useNudge.js';
import { api, ApiError, type Task } from '../api.js';
import { TaskRow } from '../components/TaskRow.js';
import { useRowDrag } from '../hooks/useRowDrag.js';
import { Detail, guestIO } from './Detail.js';
import { PanelRightIcon } from '../components/icons.js';
import { SoteMark } from '../components/Logo.js';
import { QuickAdd } from '../components/QuickAdd.js';

export function ShareScreen({ token, now }: { token: string; now: Date }) {
  const [head, setHead] = useState<{ name: string; right: 'read' | 'edit' } | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  /** Die Unteraufgaben, je Elternaufgabe — wie beim Mitglied mit der Liste. */
  const [children, setChildren] = useState<Record<string, Task[]>>({});
  const [offenKinder, setOffenKinder] = useState<ReadonlySet<string>>(new Set());
  const listRef = useRef<HTMLDivElement | null>(null);
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
    setChildren(liste.children ?? {});
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

  /*
    ZIEHEN — mit demselben Hook wie beim Mitglied.

    GEFRAGT und beantwortet: „Ja, er darf ändern. Er hat Bearbeitungsrechte,
    das gehört dazu."

    `useRowDrag` ist dasselbe Bauteil, das die Liste benutzt; was hier fehlt,
    sind die Fälle, die es in einer Freigabe nicht gibt: keine Prioritätsblöcke
    (eine Projektliste hat keine) und keine Ansicht, die ihre Reihenfolge
    selbst bestimmt (eine Freigabe zeigt immer das Projekt).

    Die Ein-Ebenen-Regel steht trotzdem hier, und das ist kein Misstrauen gegen
    den Server: es ist der Unterschied zwischen „abgelehnt" und „gar nicht erst
    angeboten". Eine Linie, die etwas verspricht, das der Server zurückweist,
    endet in einem Fehler statt in einer Bewegung.
  */
  const alle = [...tasks, ...Object.values(children).flat()];
  const drag = useRowDrag({
    container: listRef,
    canDrop: (id, position) => {
      if (!darfSchreiben) return false;
      const mich = alle.find((t) => t.id === id);
      const ziel = alle.find((t) => t.id === position.rowId);
      if (mich === undefined || ziel === undefined || mich.id === ziel.id) return false;
      const zielVater = position.intent === 'into' ? ziel.id : ziel.parentId;
      if (zielVater === mich.id) return false;
      if (zielVater !== null) {
        const vater = alle.find((t) => t.id === zielVater);
        if (vater === undefined || vater.parentId !== null) return false;
        if ((children[mich.id] ?? []).length > 0) return false;
      }
      return true;
    },
    onDrop: (id, position) => {
      const mich = alle.find((t) => t.id === id);
      const ziel = alle.find((t) => t.id === position.rowId);
      if (mich === undefined || ziel === undefined) return;

      if (position.intent === 'into') {
        // Ans Ende der Kinder: „hinein" sagt nichts über die Stelle, und unten
        // ist die Stelle, an der Neues in einer Liste erscheint.
        const drin = (children[ziel.id] ?? []).filter((k) => k.id !== id);
        void tun(
          () =>
            api.shareMove(token, id, {
              parentId: ziel.id,
              afterId: drin.at(-1)?.id ?? null,
              beforeId: null,
            }),
          'Verschieben ging nicht.',
        );
        return;
      }

      const zielVater = ziel.parentId ?? null;
      /* Die Nachbarn OHNE die gezogene Zeile: zieht man innerhalb derselben
         Ebene, stünde sie sonst in der Reihe und der neue Schlüssel läge dort,
         wo sie schon ist. */
      const reihe = (
        zielVater === null ? tasks.filter((t) => t.parentId === null) : (children[zielVater] ?? [])
      ).filter((t) => t.id !== id);
      const at = reihe.findIndex((t) => t.id === ziel.id);
      if (at === -1) return;
      void tun(
        () =>
          api.shareMove(token, id, {
            ...(zielVater === (mich.parentId ?? null) ? {} : { parentId: zielVater }),
            afterId: position.intent === 'after' ? reihe[at]!.id : (reihe[at - 1]?.id ?? null),
            beforeId: position.intent === 'after' ? (reihe[at + 1]?.id ?? null) : reihe[at]!.id,
          }),
        'Verschieben ging nicht.',
      );
    },
  });


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

    GEMELDET: „Die geteilte Ansicht klappt nicht korrekt … Sortieren,
    Unteraufgaben, Drag and Drop, das ganze Untermenü."

    Die Ursache war eine EIGENE Zeile aus Kästchen und Titel: alles, was
    seitdem dazugekommen ist, kam beim Gast nie an. Jetzt `TaskRow`.

    Kein Zeilenmenü: es führt in den Papierkorb und zu Prioritäten — Wirkungen
    ausserhalb dessen, was eine Freigabe hergibt.
  */
  const zeile = (t: Task, parentId: string | null = null) => {
    const kinder = children[t.id] ?? [];
    const auf = offenKinder.has(t.id);
    return (
      <div key={t.id}>
        <div
          className="task-wrap"
          data-dragging={drag.dragging === t.id}
          data-child={parentId === null ? undefined : 'yes'}
          {...(darfSchreiben
            ? {
                'data-row': t.id,
                'data-row-parent': parentId ?? 'root',
                'data-row-nest': parentId === null ? 'yes' : 'no',
                onPointerDown: drag.onPointerDown,
              }
            : {})}
          data-drop={drag.target?.rowId === t.id ? drag.target.intent : undefined}
        >
          {kinder.length > 0 ? (
            <button
              type="button"
              className="task-twisty"
              aria-expanded={auf}
              aria-label={`${t.title} ${auf ? 'zuklappen' : 'aufklappen'}`}
              onClick={() =>
                setOffenKinder((war) => {
                  const neu = new Set(war);
                  if (neu.has(t.id)) neu.delete(t.id);
                  else neu.add(t.id);
                  return neu;
                })
              }
            >
              <span aria-hidden="true">▸</span>
            </button>
          ) : null}
          <TaskRow
            task={t}
            now={now}
            grip={darfSchreiben}
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
        </div>
        {/*
          DIESELBE Hülle wie beim Mitglied (`task-kids`).

          GEMELDET: „Jetzt stehen die aufgeklappten Unteraufgaben auf gleicher
          Höhe wie die anderen. Sie müssten etwas verschachtelt stehen."

          Die Einrückung steckt in dieser Hülle und nicht in der Zeile — und
          zwar mit Grund: sie hält Platz für die EINE Spur, die eine
          Unteraufgabe braucht (Anfasser, kein Aufklapper), und trägt die Linie
          davor. Ohne sie stand die Einrückung im Nichts und der Anfasser auf
          der Linie.
        */}
        {auf && kinder.length > 0 ? (
          <div className="task-kids">{kinder.map((k) => zeile(k, t.id))}</div>
        ) : null}
      </div>
    );
  };

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
        {/*
          NUR AUF DEM RECHNER — die Klasse `nur-breit` blendet ihn darunter aus.

          GEMELDET: „Es gibt den Sidebar-Button, den wir in der mobilen Ansicht
          schon entfernt hatten." Richtig, und aus demselben Grund wie dort:
          auf dem Telefon ist es keine Spalte an der Seite, sondern eine
          Fläche, die von unten aufgeht — sie hat ihren eigenen Griff mit
          Kreuz. Ein Zeichen, das eine Seitenspalte zeigt, ist dort ein Bild
          von etwas anderem.

          Im Stylesheet entschieden und nicht in JavaScript: ob ein Gerät
          schmal ist, weiss das Stylesheet — eine Breitenabfrage hier wäre eine
          zweite Antwort auf dieselbe Frage.
        */}
        {offenAufgabe === null ? null : (
          <button
            type="button"
            className="topbar-knob nur-breit"
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

        <div ref={listRef}>{offen.map((t) => zeile(t))}</div>

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
            {erledigt.map((t) => zeile(t))}
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
