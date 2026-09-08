/**
 * SOTE — der Wechsler oben in der Leiste.
 *
 * Nachgebaut aus SONEs `WorkspaceMenu.tsx` und den Bildern: die Liste der
 * Arbeitsbereiche, der aktuelle markiert, darunter abgesetzt „Neuer
 * Workspace".
 *
 * **Der dritte tote Knopf dieser Art.** Er stand als
 * `<button className="ws" aria-label="Workspace wechseln">` da — mit Pfeil und
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

import { ProjectMark } from './ProjectMark.js';

export function WorkspaceMenu({
  workspaces,
  current,
  onPick,
}: {
  workspaces: readonly {
    id: string;
    name: string;
    icon: { icon?: string; iconColor?: string; titleColor?: string } | null;
  }[];
  current: string | undefined;
  onPick: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
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
  const mark = (w: (typeof workspaces)[number]) => (
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
        className="ws-name"
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
    <div className="ws-menu" ref={box}>
      <button
        ref={knob}
        type="button"
        className="ws"
        // Der Name gehört in die Beschriftung: „Workspace wechseln" allein
        // sagt einer Vorleseansage nicht, in welchem man steht.
        aria-label={`Workspace ${name} — wechseln`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {here === undefined ? (
          <span className="ws-name">{name}</span>
        ) : (
          mark(here)
        )}
        <span aria-hidden="true" className="ws-caret">
          ▾
        </span>
      </button>

      {open ? (
        <div className="ws-pop" role="menu">
          {workspaces.map((w) => (
            <button
              key={w.id}
              type="button"
              role="menuitem"
              className="ws-item"
              aria-current={w.id === current}
              onClick={() => {
                setOpen(false);
                // Auch der aktuelle wird gemeldet: ein Klick, der nichts tut,
                // ist ein Klick, bei dem man rätselt, ob er angekommen ist.
                onPick(w.id);
              }}
            >
              {mark(w)}
            </button>
          ))}
          {workspaces.length <= 1 ? (
            <p className="ws-none">
              Nur einer. Weitere anzulegen gibt es noch nicht.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
