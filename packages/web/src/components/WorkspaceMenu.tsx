/**
 * SOTE — der Wechsler oben in der Leiste.
 *
 * Nachgebaut aus SONEs `WorkspaceMenu.tsx` und den Bildern: die Liste der
 * Arbeitsbereiche, der aktuelle markiert, darunter abgesetzt „Neuer
 * Workspace".
 *
 * **Der dritte tote Knopf dieser Art.** Er stand als
 * `<button className="switcher-button" aria-label="Workspace wechseln">` da — mit Pfeil und
 * ohne `onClick`. Vorher waren es der Kontoknopf (`() => void 0`) und die
 * Schublade (ein Flag, das nirgends auf `true` gesetzt wurde). Dass es dreimal
 * dasselbe Muster ist, ist kein Zufall: ein Knopf, der aussieht wie einer, ist
 * fertig genug, um beim Durchsehen nicht aufzufallen — und nur ein Klick
 * findet ihn.
 *
 * Deshalb steht hier ein Test dahinter, der die **Wirkung** prüft und nicht
 * die Anwesenheit: dass ein Klick eine Liste öffnet und ein Klick auf einen
 * Eintrag den Arbeitsbereich wechselt.
 *
 * Was hier **nicht** steht: das Anlegen selbst. Es gibt keine Route dafür, und
 * ein Eintrag, der „gibt es nicht" antwortet, bringt Leute dazu, dem Menü zu
 * misstrauen (SONEs ADR-0027). Der Eintrag kommt, wenn er hinführt.
 */

import { useEffect, useRef, useState } from 'react';

import { api, ApiError } from '../api.js';
import { ChevronRightIcon, PlusIcon } from './icons.js';
import { ProjectMark } from './ProjectMark.js';

export function WorkspaceMenu({
  workspaces,
  current,
  onPick,
  onCreated,
}: {
  workspaces: readonly {
    id: string;
    name: string;
    icon: { icon?: string; iconColor?: string; titleColor?: string } | null;
  }[];
  current: string | undefined;
  onPick: (id: string) => void;
  /**
   * Ein neuer ist da.
   *
   * Der Aufrufer lädt seine Liste neu **und** wechselt hinein — beides, weil
   * einen Arbeitsbereich anzulegen und ihn dann suchen zu müssen zwei Schritte
   * für einen Vorgang wären.
   */
  onCreated: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  // `neuerName`, nicht `name`: `name` ist schon der Name des AKTUELLEN
  // Arbeitsbereichs, ein paar Zeilen weiter unten. Der Übersetzer hat es
  // gemeldet, bevor daraus eine Verwechslung wurde.
  const [neuerName, setNeuerName] = useState('');
  const [busy, setBusy] = useState(false);
  const [fehler, setFehler] = useState<string | undefined>(undefined);

  async function create(): Promise<void> {
    const wie = neuerName.trim();
    if (wie === '' || busy) return;
    setBusy(true);
    setFehler(undefined);
    try {
      const out = await api.createWorkspace(wie);
      setOpen(false);
      setCreating(false);
      setNeuerName('');
      onCreated(out.id);
    } catch (e) {
      // Im Menü und nicht als Balken über der Seite: der Fehler gehört zu dem
      // Feld, in dem gerade etwas stand.
      setFehler(e instanceof ApiError ? e.message : 'Anlegen ging nicht.');
    } finally {
      setBusy(false);
    }
  }
  const box = useRef<HTMLDivElement | null>(null);
  const knob = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        knob.current?.focus();
      }
    };
    const onDown = (e: MouseEvent) => {
      if (box.current !== null && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
    };
  }, [open]);

  const here = workspaces.find((w) => w.id === current);
  const name = here?.name ?? 'Kein Workspace';

  /** Zeichen und Name eines Eintrags — an zwei Stellen gebraucht, also einmal. */
  /*
   * `inItem`: im Knopf heißt der Name bei SONE `switcher-name`, in einem
   * Eintrag `switcher-item-name` — dieselbe Kürzung, andere Breite. Ein
   * Parameter statt zweier Funktionen, weil Zeichen und Name sonst zweimal
   * zusammengesetzt würden.
   */
  const mark = (w: (typeof workspaces)[number], inItem = false) => (
    <>
      <ProjectMark
        icon={w.icon?.icon}
        kind="folder"
        name={w.name}
        color={
          w.icon?.iconColor === undefined
            ? undefined
            : `var(--sote-palette-${w.icon.iconColor})`
        }
      />
      <span
        className={inItem ? 'switcher-item-name' : 'switcher-name'}
        style={
          w.icon?.titleColor === undefined
            ? undefined
            : { color: `var(--sote-palette-${w.icon.titleColor})` }
        }
      >
        {w.name}
      </span>
    </>
  );

  return (
    <div className="switcher-wrap" ref={box}>
      <button
        ref={knob}
        type="button"
        className="switcher-button"
        // Der Name gehört in die Beschriftung: „Workspace wechseln" allein
        // sagt einer Vorleseansage nicht, in welchem man steht.
        aria-label={`Workspace ${name} — wechseln`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {here === undefined ? (
          <span className="switcher-name">{name}</span>
        ) : (
          mark(here)
        )}
        {/* SONEs Pfeil: ein Rechts-Chevron, per CSS um 90° gedreht. Mit dem
            Zeichen ▾ zeigte die Drehung nach LINKS — das Zeichen zeigt schon
            nach unten, und die Regel dreht, was kommt. */}
        <ChevronRightIcon size={12} className="switcher-caret" aria-hidden="true" />
      </button>

      {open ? (
        <div className="switcher-menu" role="menu">
          {workspaces.map((w) => (
            <button
              key={w.id}
              type="button"
              role="menuitem"
              className="switcher-item"
              aria-current={w.id === current}
              onClick={() => {
                setOpen(false);
                // Auch der aktuelle wird gemeldet: ein Klick, der nichts tut,
                // ist ein Klick, bei dem man rätselt, ob er angekommen ist.
                onPick(w.id);
              }}
            >
              {mark(w, true)}
            </button>
          ))}
          {/*
            Der Fuß, wie in SONEs `WorkspaceMenu`: ein Eintrag „Neuer
            Arbeitsbereich", der zu einem Namensfeld wird — kein Bildschirm, den
            man aufsucht, um ein Wort einzutippen.

            SONEs Kommentar dazu gilt hier genauso: *„Nothing else. This menu
            answers one question — which workspace."* Einstellungen und „Alle
            Workspaces" sind Orte und gehören in die Schiene, nicht hierher.

            Hier stand vorher: „Nur einer. Weitere anzulegen gibt es noch
            nicht." Das war ehrlich und ist jetzt falsch.
          */}
          <div className="switcher-footer">
            {creating ? (
              <div className="workspace-create">
                <input
                  className="set-input"
                  autoFocus
                  aria-label="Name des neuen Arbeitsbereichs"
                  placeholder="Name"
                  value={neuerName}
                  disabled={busy}
                  onChange={(e) => setNeuerName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      void create();
                    } else if (e.key === 'Escape') {
                      e.preventDefault();
                      setCreating(false);
                      setNeuerName('');
                    }
                  }}
                />
                <button
                  type="button"
                  className="btn"
                  disabled={busy || neuerName.trim() === ''}
                  onClick={() => void create()}
                >
                  {busy ? 'Einen Moment…' : 'Anlegen'}
                </button>
              </div>
            ) : (
              <button
                type="button"
                role="menuitem"
                className="switcher-item"
                onClick={() => setCreating(true)}
              >
                <PlusIcon size={15} />
                Neuer Arbeitsbereich
              </button>
            )}
            {fehler === undefined ? null : <p className="small muted">{fehler}</p>}
          </div>
        </div>
      ) : null}
    </div>
  );
}
