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

import { useEffect, useRef, useState } from 'react';

import type { Project } from '../api.js';

/** Aus der Palette, damit ein Projekt nicht wie der Akzent aussieht. */
const COLORS: readonly { value: string | null; name: string }[] = [
  { value: null, name: 'ohne' },
  { value: '#2f7d6f', name: 'Grün' },
  { value: '#a8762b', name: 'Ocker' },
  { value: '#b4442f', name: 'Rot' },
  { value: '#4a6c8c', name: 'Blau' },
  { value: '#6a675f', name: 'Grau' },
];

export function ProjectTree({
  projects,
  activeId,
  busy,
  onOpen,
  onCreate,
  onRename,
  onColor,
  onTrash,
}: {
  projects: readonly Project[];
  activeId: string | null;
  busy: boolean;
  onOpen: (id: string) => void;
  onCreate: (name: string, parentId: string | null) => void;
  onRename: (id: string, name: string) => void;
  onColor: (id: string, color: string | null) => void;
  onTrash: (id: string) => void;
}) {
  const [adding, setAdding] = useState<{ parentId: string | null } | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [menu, setMenu] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);

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
            <button
              className="p-item"
              aria-current={activeId === p.id}
              style={{ paddingInlineStart: 8 + depth * 14 }}
              onClick={() => onOpen(p.id)}
            >
              <span
                className="p-sq"
                aria-hidden="true"
                {...(p.color === null ? {} : { style: { background: p.color } })}
              />
              {p.name}
              {/* Keine Null: eine Zahl über nichts ist Rauschen. */}
              {p.open === null ? null : <span className="n">{p.open}</span>}
            </button>
            <button
              className="p-dots"
              aria-label={`Menü für ${p.name}`}
              aria-haspopup="menu"
              onClick={() => setMenu(menu === p.id ? null : p.id)}
            >
              ⋮
            </button>
          </>
        )}

        {menu === p.id ? (
          <div className="menu" ref={box} role="menu">
            <button className="menu-item" role="menuitem" onClick={() => {
              setMenu(null);
              setRenaming(p.id);
            }}>
              Umbenennen
            </button>
            <button
              className="menu-item"
              role="menuitem"
              onClick={() => {
                setMenu(null);
                setAdding({ parentId: p.id });
              }}
            >
              Unterprojekt anlegen
            </button>
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
                    : { style: { background: c.value, borderColor: c.value } })}
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
      ...rows(p.id, depth + 1),
      ...(adding !== null && adding.parentId === p.id
        ? [
            <input
              key={`add-${p.id}`}
              className="p-rename"
              autoFocus
              placeholder="Name des Unterprojekts"
              aria-label="Name des Unterprojekts"
              style={{ marginInlineStart: (depth + 1) * 14 }}
              onBlur={(e) => {
                const name = e.target.value.trim();
                setAdding(null);
                if (name !== '') onCreate(name, p.id);
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
          placeholder="Name des Projekts"
          aria-label="Name des Projekts"
          onBlur={(e) => {
            const name = e.target.value.trim();
            setAdding(null);
            if (name !== '') onCreate(name, null);
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
          onClick={() => setAdding({ parentId: null })}
          disabled={busy}
        >
          <span className="plus" aria-hidden="true">
            +
          </span>
          Projekt anlegen
        </button>
      )}
    </>
  );
}
