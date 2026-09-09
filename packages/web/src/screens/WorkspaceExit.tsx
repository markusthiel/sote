/**
 * SOTE — einen Arbeitsbereich mitnehmen oder wegwerfen.
 *
 * Zwei Dinge auf einem Bildschirm, und das ist Absicht: **wer wegwerfen will,
 * soll zuerst am Export vorbeigehen.** Getrennt wären es zwei Orte, und der
 * eine, den man nach dem Löschen braucht, wäre der, den man nicht besucht hat.
 *
 * ## Der Name muss abgetippt werden
 *
 * Der einzige Ort in SOTE mit dieser Hürde, und er ist es wert: hier ist
 * nichts wiederherstellbar. Ein Papierkorb für Arbeitsbereiche wäre ein
 * Papierkorb für alles — also lieber eine Hürde vorher als eine Rettung
 * nachher, die es nicht gibt.
 */

import { useState } from 'react';

import { api, ApiError } from '../api.js';

export function WorkspaceExit({
  workspace,
  name,
  onGone,
}: {
  workspace: string | undefined;
  name: string;
  onGone: () => void;
}) {
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [getippt, setGetippt] = useState('');

  return (
    <div className="settings">
      {notice === undefined ? null : <p className="note-error">{notice}</p>}

      <section className="settings-card">
        <h2>Mitnehmen</h2>
        <p className="muted">
          Eine Datei mit allem, was sich wiederherstellen ließe: Projekte,
          Aufgaben, Kommentare, Rollen, Gruppen, Einstellungen.
        </p>
        <button
          type="button"
          className="btn"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            setNotice(undefined);
            void api
              .exportWorkspace(workspace)
              .then((daten) => {
                const url = URL.createObjectURL(
                  new Blob([JSON.stringify(daten, null, 2)], { type: 'application/json' }),
                );
                const a = document.createElement('a');
                a.href = url;
                // Der Name im Dateinamen, das Datum dahinter: zwei Exporte
                // desselben Arbeitsbereichs sollen sich unterscheiden lassen,
                // ohne dass man sie öffnet.
                a.download = `sote-${name.replace(/[^\w-]+/g, '-').toLowerCase()}-${
                  new Date().toISOString().slice(0, 10)
                }.json`;
                a.click();
                URL.revokeObjectURL(url);
              })
              .catch((e: unknown) =>
                setNotice(e instanceof ApiError ? e.message : 'Export ging nicht.'),
              )
              .finally(() => setBusy(false));
          }}
        >
          Datei speichern
        </button>
        <p className="muted small">
          <strong>Nicht</strong> darin: Kennwörter, Freigabe-Links und Sitzungen.
          Ein Export ist eine Datei, die per Mail wandert — Zugang hat darin
          nichts zu suchen.
        </p>
      </section>

      <section className="settings-card danger">
        <h2>Wegwerfen</h2>
        <p className="muted">
          Löscht diesen Arbeitsbereich mit allem darin. Das ist{' '}
          <strong>nicht</strong> wiederherstellbar — es gibt keinen Papierkorb
          dafür.
        </p>
        <div className="settings-row">
          <span className="settings-row-label"><b>Name abtippen</b><span>Dein <em>letzter</em> Arbeitsbereich lässt sich nicht löschen —
              sonst landest du nirgends.</span></span>
          <div className="settings-row-value">
            <div className="pick">
              <input
                className="set-input"
                aria-label="Name zum Bestätigen"
                placeholder={name}
                value={getippt}
                disabled={busy}
                onChange={(e) => setGetippt(e.target.value)}
              />
              <button
                type="button"
                className="btn danger"
                /*
                 * Gesperrt, bis der Name stimmt — und der Server prüft es
                 * nochmal. Nicht doppelt aus Misstrauen: die Sperre hier
                 * erklärt, was fehlt, und die Prüfung dort gilt auch für einen
                 * Aufruf, der diesen Bildschirm nie gesehen hat.
                 */
                disabled={busy || getippt.trim() !== name}
                onClick={() => {
                  setBusy(true);
                  setNotice(undefined);
                  void api
                    .deleteWorkspace(getippt.trim(), workspace)
                    .then(() => onGone())
                    .catch((e: unknown) =>
                      setNotice(e instanceof ApiError ? e.message : 'Löschen ging nicht.'),
                    )
                    .finally(() => setBusy(false));
                }}
              >
                Endgültig löschen
              </button>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
