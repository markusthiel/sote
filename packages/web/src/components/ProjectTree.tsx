/**
 * SOTE — die Projektliste im Panel.
 *
 * Der Baum navigiert; er zeigt keinen Inhalt (ADR-0069). Was er zusätzlich
 * können muss, ist das, wofür es sonst SQL bräuchte: anlegen, umbenennen,
 * umfärben, wegwerfen.
 *
 * **Umbenennen passiert in der Zeile.** Ein Dialog dafür wäre ein zweiter Ort
 * für denselben Namen, und man müsste ihn schließen, um zu sehen, was man
 * getippt hat. Escape verwirft, Enter übernimmt, Verlassen des Feldes
 * übernimmt auch — wer wegklickt, hat aufgehört.
 *
 * Die Farben sind eine **Liste**, kein Farbwähler. Freie Werte erzeugen
 * Projekte, die sich vom Akzent nicht unterscheiden lassen, und niemand sieht
 * beim Wählen, dass das passiert ist. Dieselbe Begründung wie „Steps, not
 * values" in SONEs Gestaltungs-Records.
 */

import { useEffect, useMemo, useRef, useState } from 'react';

import { colorValue, PALETTE } from '@sote/core';

import type { Project } from '../api.js';
import { useProgressive } from '../hooks/useProgressive.js';
import { iconsFor, IconPreview, loadIcons, ProjectMark } from './ProjectMark.js';

/**
 * Die acht Namen aus der Palette, plus „ohne".
 *
 * Vorher standen hier fünf **Hex-Werte** direkt in der Datei. Zwei Dinge waren
 * daran falsch, und beide hat SONE schon gelernt (ADR-0023, ADR-0028):
 *
 * 1. Ein Name gespeichert **folgt der Palette**. Ändert die Palette, ändert
 *    sich jedes Projekt mit diesem Namen. Ein Hex-Wert bleibt für immer dieser
 *    eine Wert.
 * 2. Dieselben gesättigten Werte, die auf Weiß richtig aussehen, **glühen auf
 *    Schwarz**. Als Token hat jede Farbe einen Wert pro Thema; als Hex-Wert
 *    hatte sie einen für beide.
 */
const COLORS: readonly { value: string | null; name: string }[] = [
  { value: null, name: 'ohne Farbe' },
  ...PALETTE.map((n) => ({ value: n as string, name: n })),
];

export function ProjectTree({
  projects,
  activeId,
  busy,
  onOpen,
  onCreate,
  onRename,
  onColor,
  onIcon,
  onTrash,
}: {
  projects: readonly Project[];
  activeId: string | null;
  busy: boolean;
  onOpen: (id: string) => void;
  onCreate: (name: string, parentId: string | null, kind: 'folder' | 'list') => void;
  onRename: (id: string, name: string) => void;
  onColor: (id: string, color: string | null) => void;
  onIcon: (id: string, icon: { icon?: string; iconColor?: string } | null) => void;
  onTrash: (id: string) => void;
}) {
  /*
   * Was gerade angelegt wird — und als was.
   *
   * Die Art gehoert in den Zustand und nicht in eine Vermutung beim
   * Abschicken: „Unterordner anlegen" und „Projekt anlegen" sind zwei
   * Eintraege im Menue, und der Platzhalter im Feld soll sagen, welcher von
   * beiden gedrueckt wurde.
   */
  const [adding, setAdding] = useState<
    { parentId: string | null; kind: 'folder' | 'list' } | null
  >(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [menu, setMenu] = useState<string | null>(null);
  /** Wo das Menü aufgeht — in Fensterkoordinaten, weil es `fixed` ist. */
  const [at, setAt] = useState<{ top: number; right: number }>({ top: 0, right: 0 });
  /*
   * Welche Zweige zugeklappt sind — zugeklappt und nicht aufgeklappt.
   *
   * Die Vorgabe ist offen: ein Baum, der zugeklappt beginnt, verbirgt genau
   * die Unterprojekte, die man gerade angelegt hat. Gemerkt wird darum die
   * Ausnahme, und die ist am Anfang leer.
   *
   * Im Zustand und nicht in der URL: das ist keine Auskunft darüber, wo man
   * ist, sondern wie man sitzt. Über einen Neustart hinaus zu merken wäre eine
   * Einstellung, und die kommt mit den Einstellungen.
   */
  const [closed, setClosed] = useState<ReadonlySet<string>>(new Set());
  const [find, setFind] = useState('');

  /* Der ganze Satz, mit und ohne Suchbegriff — `iconsFor` erklärt, warum die
     Vorauswahl, die hier einmal stand, wieder weg ist. */
  /*
   * Der Zeichensatz kommt, wenn ein Menü aufgeht.
   *
   * Ein Megabyte auf jedem Laden, damit ein Wähler sofort bereit ist, den die
   * meisten nie öffnen — das war der gemessene Grund für „hängt teilweise
   * sekunden". Jetzt wird er hier geholt; bis er da ist, sagt das Gitter es.
   */
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (menu === null) return;
    void loadIcons().then(() => setReady(true));
  }, [menu]);

  const alle = useMemo(() => (ready ? iconsFor(find) : []), [find, ready]);
  /*
   * Der ganze Satz, aber stückweise gezeichnet.
   *
   * 2080 Knöpfe auf einmal waren gemessen 1690 ms auf einem gedrosselten
   * Gerät. Weggelassen wird nichts — `useProgressive` erklärt, warum die
   * Antwort auf die Langsamkeit nicht wieder eine Vorauswahl sein durfte.
   */
  const shown = useProgressive(alle);
  const box = useRef<HTMLDivElement>(null);

  // Ein neues Menü beginnt ohne Suchbegriff: der vom letzten Projekt ist eine
  // Einschränkung, die niemand gesetzt hat.
  useEffect(() => setFind(''), [menu]);


  useEffect(() => {
    if (menu === null) return;
    const away = (e: MouseEvent) => {
      if (box.current !== null && !box.current.contains(e.target as Node)) setMenu(null);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenu(null);
    };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', key);
    };
  }, [menu]);

  /** Der Baum wird aus der flachen Liste gebaut, in der Reihenfolge des Servers. */
  const childrenOf = (parentId: string | null) =>
    projects.filter((p) => p.parentId === parentId);

  function rows(parentId: string | null, depth: number): React.ReactNode[] {
    return childrenOf(parentId).flatMap((p) => [
      <div className="p-row" key={p.id}>
        {renaming === p.id ? (
          <input
            className="p-rename"
            defaultValue={p.name}
            autoFocus
            aria-label={`${p.name} umbenennen`}
            style={{ marginInlineStart: depth * 14 }}
            onBlur={(e) => {
              const next = e.target.value.trim();
              setRenaming(null);
              if (next !== '' && next !== p.name) onRename(p.id, next);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
              if (e.key === 'Escape') {
                e.currentTarget.value = p.name;
                e.currentTarget.blur();
              }
            }}
          />
        ) : (
          <>
            {/*
              Aufklappen, wenn es etwas aufzuklappen gibt.
              Ein eigener Knopf und nicht die Zeile selbst: die Zeile
              navigiert, und ein Klick, der manchmal öffnet und manchmal
              aufklappt, ist ein Klick, dessen Wirkung man erst danach weiß.
              Wo es keine Kinder gibt, steht ein Platzhalter — sonst
              springen die Namen zwischen den Zeilen.
            */}
            {childrenOf(p.id).length > 0 ? (
              <button
                className="p-twist"
                aria-label={`${p.name} ${closed.has(p.id) ? 'aufklappen' : 'zuklappen'}`}
                aria-expanded={!closed.has(p.id)}
                style={{ marginInlineStart: depth * 14 }}
                onClick={() =>
                  setClosed((was) => {
                    const next = new Set(was);
                    if (next.has(p.id)) next.delete(p.id);
                    else next.add(p.id);
                    return next;
                  })
                }
              >
                <span aria-hidden="true">{closed.has(p.id) ? '▸' : '▾'}</span>
              </button>
            ) : (
              <span className="p-twist-gap" style={{ marginInlineStart: depth * 14 }} />
            )}
            <button
              className="p-item"
              /*
               * Die Beschriftung nennt den Namen und die Zahl getrennt.
               *
               * Vorher hatte die Zeile keine, und ihr zugänglicher Name war
               * „Haus 1" — die offene Zahl klebte am Projektnamen. Einer
               * Vorleseansage fällt das sofort auf; im Bild sieht man es nie.
               */
              aria-label={
                // Die Art gehoert in den Namen: „Ordner Haus" und „Projekt
                // Haus" sind nach der Migration zwei Zeilen mit demselben
                // Wort, und einer Vorleseansage waeren sie ohne die Art nicht
                // zu unterscheiden.
                `${p.kind === 'folder' ? 'Ordner' : 'Projekt'} ${p.name}` +
                (p.open === null ? '' : `, ${p.open} offen`)
              }
              aria-current={activeId === p.id}
              onClick={() => onOpen(p.id)}
            >
              <ProjectMark
                icon={p.icon?.icon}
                // Ohne gewaehltes Zeichen unterscheidet die VORGABE die Arten,
                // und sie kommt aus dem RAHMENSATZ (`icons.tsx`) und nicht aus
                // Lucide. Mein erster Wurf setzte hier 'folder'/'list' als
                // Lucide-Namen ein — damit haette JEDE Zeile den Satz
                // nachgeladen, und die 1018 KB waeren durch die Hintertuer
                // wieder im Startpfad. Zwei Saetze, zwei Zwecke.
                kind={p.kind}
                name={p.name}
                color={colorValue(p.icon?.iconColor ?? p.color)}
              />
              <span className="p-name">{p.name}</span>
              {/* Keine Null: eine Zahl über nichts ist Rauschen. */}
              {p.open === null ? null : (
                <span className="n" aria-hidden="true">
                  {p.open}
                </span>
              )}
            </button>
            <button
              className="p-dots"
              aria-label={`Menü für ${p.name}`}
              aria-haspopup="menu"
              /*
                Hier stand ein Anwärmen beim Zeigen (`onPointerEnter`), das den
                Zeichensatz vor dem Klick laden sollte.
                **Wieder heraus, weil ich es nicht belegen konnte.** Gemessen
                mit 0, 300, 1500 und 3000 ms zwischen Zeigen und Klicken auf
                einem vierfach gedrosselten Gerät: 894, 623, 1523, 1385 ms bis
                zum ersten Bild — kein Trend, nur Rauschen. Eine Optimierung,
                die sich nicht messen lässt, ist eine, die man nicht
                verteidigen kann, und sie kostet einen Codepfad.
              */
              /*
                Die Stelle wird beim Öffnen gemerkt, nicht beim Zeichnen
                gerechnet: ein `fixed`-Menü hat keinen Vorfahren, an dem es
                sich ausrichtet, und der Knopf kann beim nächsten Zeichnen
                längst woanders stehen.
              */
              onClick={(e) => {
                if (menu === p.id) {
                  setMenu(null);
                  return;
                }
                /*
                  An BEIDEN Rändern festgeklemmt.
                  Verankert wird rechts am Knopf, damit die Klappe unter ihm
                  hängt — aber auf einem schmalen Fenster stand sie damit links
                  draußen (`left: -21` auf 390 px). Die Breite ist im
                  Stylesheet mit derselben Formel gesetzt, also lässt sie sich
                  hier ausrechnen statt messen: messen ginge erst nach dem
                  Zeichnen, und dann springt das Menü.
                */
                const r = e.currentTarget.getBoundingClientRect();
                const breite = Math.min(312, window.innerWidth - 16);
                const rechts = window.innerWidth - r.right;
                setAt({
                  top: Math.round(r.bottom + 4),
                  right: Math.round(Math.max(8, Math.min(rechts, window.innerWidth - breite - 8))),
                });
                setMenu(p.id);
              }}
            >
              ⋮
            </button>
          </>
        )}

        {menu === p.id ? (
          <div
            // `at-point`: dieselbe Erscheinung, aber an einer gerechneten
            // Stelle im Fenster. Ohne den eigenen Namen hätte das Menü an der
            // Aufgabenzeile mitgeändert — und tat es auch, bis der
            // Breiten-Durchgang es meldete.
            className="menu at-point"
            ref={box}
            role="menu"
            /*
              Von RECHTS verankert und nach unten begrenzt: das Menü ist hoch
              (Zeichenwähler und Farben), und am Fuß einer langen Liste hätte
              es sonst unten kein Ende. `maxHeight` plus eigenes Scrollen ist
              die einzige Antwort, die auf jedem Fenster stimmt.
            */
            style={{
              top: at.top,
              right: at.right,
              maxHeight: `calc(100vh - ${at.top + 12}px)`,
            }}
          >
            <button className="menu-item" role="menuitem" onClick={() => {
              setMenu(null);
              setRenaming(p.id);
            }}>
              Umbenennen
            </button>
            {/*
              Zwei Eintraege statt einem, und nur bei einem Ordner.
              Ein Projekt haelt Aufgaben und keine Unterpunkte (Konzept 10d) —
              ein Eintrag „Unterprojekt anlegen" an einem Projekt waere ein
              Angebot, das die Datenbank ablehnt. Abwesend statt anwesend und
              verweigernd (SONEs ADR-0027).
            */}
            {p.kind === 'folder' ? (
              <>
                <button
                  className="menu-item"
                  role="menuitem"
                  onClick={() => {
                    setMenu(null);
                    setAdding({ parentId: p.id, kind: 'list' });
                  }}
                >
                  Projekt anlegen
                </button>
                <button
                  className="menu-item"
                  role="menuitem"
                  onClick={() => {
                    setMenu(null);
                    setAdding({ parentId: p.id, kind: 'folder' });
                  }}
                >
                  Unterordner anlegen
                </button>
              </>
            ) : null}
            <div className="menu-label sep">Zeichen</div>
            {/*
              Ein Suchfeld statt einer Auswahl.

              Vorher standen hier zwölf selbst gezeichnete Pfade — gemeldet:
              „Auch die Icons stimmen nicht." Sie stimmten nicht, und zwölf
              sind ohnehin eine Auswahl, die jemand einmal getroffen hat.
              SONEs Begründung: mit einem Filter gibt es keinen Grund, für
              irgendwen zu wählen — man kann den ganzen Satz durchsuchen.
            */}
            <input
              className="mark-find"
              value={find}
              /* Die Namen kommen aus Lucide und sind englisch. Ein Beispiel
                 auf Deutsch stand hier zuerst („haus") und fand nichts — ein
                 Platzhalter, der eine Eingabe vorschlägt, die ins Leere läuft,
                 ist schlimmer als keiner. */
              placeholder="Zeichen suchen — home, cart, star"
              aria-label="Zeichen suchen"
              onChange={(e) => setFind(e.target.value)}
            />
            <div className="swatches marks">
              {/* „ohne" zuerst: es ist die eine Wahl, die kein Bild hat und
                  sonst zwischen tausend Bildern verschwindet. */}
              <button
                className="mark-btn"
                aria-label="ohne Zeichen"
                aria-current={(p.icon?.icon ?? undefined) === undefined}
                disabled={busy}
                onClick={() => {
                  setMenu(null);
                  onIcon(p.id, null);
                }}
              >
                <span aria-hidden="true">–</span>
              </button>
              {shown.map((n) => (
                <button
                  key={n}
                  className="mark-btn"
                  aria-label={n}
                  title={n}
                  aria-current={p.icon?.icon === n}
                  disabled={busy}
                  onClick={() => {
                    setMenu(null);
                    // Die Farbe des Zeichens bleibt, wenn es eine gab: wer das
                    // Bild wechselt, hat nichts über die Farbe gesagt.
                    onIcon(p.id, {
                      icon: n,
                      ...(p.icon?.iconColor === undefined
                        ? {}
                        : { iconColor: p.icon.iconColor }),
                    });
                  }}
                >
                  <IconPreview name={n} />
                </button>
              ))}
            </div>
            {shown.length > 0 ? null : (
              <p className="fpop-none">
                {ready ? 'Kein Zeichen mit diesem Namen.' : 'Zeichen werden geladen…'}
              </p>
            )}
            <div className="menu-label sep">Farbe</div>
            <div className="swatches">
              {COLORS.map((c) => (
                <button
                  key={c.name}
                  className="swatch-btn"
                  aria-label={c.name}
                  aria-current={p.color === c.value}
                  disabled={busy}
                  {...(c.value === null
                    ? {}
                    : {
                        style: {
                          // Über colorValue und nicht direkt: ein Palettenname
                          // ist KEINE CSS-Farbe. Ihn roh zu setzen tat in SONE
                          // für die acht Namen stillschweigend nichts — „die
                          // schlechtere Hälfte, weil das die sind, die man
                          // wählt".
                          background: colorValue(c.value),
                          borderColor: colorValue(c.value),
                        },
                      })}
                  onClick={() => {
                    setMenu(null);
                    onColor(p.id, c.value);
                  }}
                />
              ))}
            </div>
            <div className="menu-label sep" />
            <button
              className="menu-item danger"
              role="menuitem"
              disabled={busy}
              onClick={() => {
                setMenu(null);
                onTrash(p.id);
              }}
            >
              In den Papierkorb
            </button>
          </div>
        ) : null}
      </div>,
      ...(closed.has(p.id) ? [] : rows(p.id, depth + 1)),
      ...(adding !== null && adding.parentId === p.id
        ? [
            <input
              key={`add-${p.id}`}
              className="p-rename"
              autoFocus
              placeholder={adding.kind === 'folder' ? 'Name des Unterordners' : 'Name des Projekts'}
              aria-label={adding.kind === 'folder' ? 'Name des Unterordners' : 'Name des Projekts'}
              style={{ marginInlineStart: (depth + 1) * 14 }}
              onBlur={(e) => {
                const name = e.target.value.trim();
                const kind = adding.kind;
                setAdding(null);
                if (name !== '') onCreate(name, p.id, kind);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur();
                if (e.key === 'Escape') {
                  e.currentTarget.value = '';
                  e.currentTarget.blur();
                }
              }}
            />,
          ]
        : []),
    ]);
  }

  return (
    <>
      <div className="group-label">Projekte</div>
      {projects.length === 0 && adding === null ? (
        <div className="p-item" style={{ color: 'var(--text-faint)' }}>
          noch keine
        </div>
      ) : (
        rows(null, 0)
      )}

      {adding !== null && adding.parentId === null ? (
        <input
          className="p-rename"
          autoFocus
          placeholder="Name des Ordners"
          aria-label="Name des Ordners"
          onBlur={(e) => {
            const name = e.target.value.trim();
            setAdding(null);
            // Ganz oben kann nur ein Ordner stehen (Konzept 10d).
            if (name !== '') onCreate(name, null, 'folder');
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
            if (e.key === 'Escape') {
              e.currentTarget.value = '';
              e.currentTarget.blur();
            }
          }}
        />
      ) : (
        <button
          className="p-item add"
          onClick={() => setAdding({ parentId: null, kind: 'folder' })}
          disabled={busy}
        >
          <span className="plus" aria-hidden="true">
            +
          </span>
          {/*
            „Ordner" und nicht „Projekt": ganz oben kann nur ein Ordner stehen
            (Konzept 10d). Der Knopf sagte „Projekt anlegen" und legte einen
            Ordner an — im Bild aufgefallen. Eine Beschriftung, die etwas
            anderes verspricht als sie tut, ist schlimmer als eine, die nichts
            verspricht.
          */}
          Ordner anlegen
        </button>
      )}
    </>
  );
}
