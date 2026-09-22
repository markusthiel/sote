/**
 * SOTE — die Notiz hängt sich ein, und was gespeichert wurde, kommt zurück.
 *
 * Der Weg, den eine Notiz in SOTE wirklich nimmt, und zwar ganz:
 *
 *   1. Eine alte Notiz (nur Klartext) wird beim ersten Öffnen zum Dokument.
 *   2. Der Editor hängt sich daran und nimmt eine Änderung an.
 *   3. Der Stand wird als Yjs-Update gespeichert — das ist, was in `note_doc`
 *      landet — und daneben der Klartext für `note`.
 *   4. Beim nächsten Öffnen entsteht aus dem Update wieder dasselbe Dokument.
 *
 * Schritt 4 ist der, weswegen der Test existiert. Schritt 1 bis 3 sind je für
 * sich geprüft; dass sie ZUSAMMEN eine Notiz heil durch einen Neustart bringen,
 * prüft nichts sonst — und genau dort steht ein Fehler, der wie „meine Notiz ist
 * weg" aussieht, nicht wie ein Fehler.
 *
 * jsdom und kein Browser: das reicht, um Einhängen, Übernehmen und Abbauen zu
 * prüfen. Darstellung und Tastatur brauchen einen Browser und stehen hier
 * bewusst nicht.
 */

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { JSDOM } from 'jsdom';
import * as Y from 'yjs';

let dom: JSDOM;
let createEditor: typeof import('../src/editor.js').createEditor;
let jsonToFragment: typeof import('../src/editor.js').jsonToFragment;
let seedEmptyPage: typeof import('../src/editor.js').seedEmptyPage;
let docFromPlainText: typeof import('../src/noteText.js').docFromPlainText;
let noteText: typeof import('../src/noteText.js').noteText;

const DOM_GLOBALS = [
  'window',
  'document',
  'Node',
  'Element',
  'HTMLElement',
  'DocumentFragment',
  'Range',
  'getComputedStyle',
  'MutationObserver',
  'DOMParser',
  'Event',
  'KeyboardEvent',
  'InputEvent',
  'CompositionEvent',
  'ClipboardEvent',
] as const;

describe('die Notiz als Dokument', () => {
  before(async () => {
    dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true });
    for (const key of DOM_GLOBALS) {
      // `defineProperty` und keine Zuweisung: manche dieser Namen sind auf dem
      // Node-Global nur lesbar.
      Object.defineProperty(globalThis, key, {
        value: (dom.window as unknown as Record<string, unknown>)[key],
        configurable: true,
        writable: true,
      });
    }
    const editor = await import('../src/editor.js');
    createEditor = editor.createEditor;
    jsonToFragment = editor.jsonToFragment;
    seedEmptyPage = editor.seedEmptyPage;
    const text = await import('../src/noteText.js');
    docFromPlainText = text.docFromPlainText;
    noteText = text.noteText;
  });

  after(() => {
    dom?.window.close();
  });

  const halter = (): HTMLElement => {
    const element = dom.window.document.createElement('div');
    dom.window.document.body.appendChild(element);
    return element as unknown as HTMLElement;
  };

  /** Wie `NoteEditor.tsx` es tut: Dokument öffnen, notfalls aus dem Klartext. */
  const oeffnen = (gespeichert: Uint8Array | null, klartext: string) => {
    const ydoc = new Y.Doc();
    if (gespeichert !== null) Y.applyUpdate(ydoc, gespeichert);
    const fragment = ydoc.getXmlFragment('notiz');
    if (fragment.length === 0) {
      if (klartext.trim() !== '') jsonToFragment(docFromPlainText(klartext), fragment);
      else seedEmptyPage(fragment);
    }
    return { ydoc, fragment };
  };

  test('eine alte Notiz ist nach dem Öffnen im Editor noch da', () => {
    const { ydoc, fragment } = oeffnen(null, 'Schlüssel beim Nachbarn\nTelefon 06271 12345');
    const view = createEditor(halter(), { fragment, editable: () => true });
    try {
      assert.equal(view.state.doc.childCount, 2);
      assert.equal(noteText(view.state.doc), 'Schlüssel beim Nachbarn\nTelefon 06271 12345');
    } finally {
      view.destroy();
      ydoc.destroy();
    }
  });

  test('geschrieben, gespeichert, wieder geöffnet — derselbe Text', () => {
    const erste = oeffnen(null, '');
    const view = createEditor(halter(), { fragment: erste.fragment, editable: () => true });
    let gespeichert: Uint8Array;
    let schatten: string;
    try {
      // Was das Tippen am Ende ausmacht: eine Transaktion, die in Yjs landet.
      view.dispatch(view.state.tr.insertText('Vor dem Termin anrufen'));
      gespeichert = Y.encodeStateAsUpdate(erste.ydoc);
      schatten = noteText(view.state.doc);
    } finally {
      view.destroy();
      erste.ydoc.destroy();
    }

    assert.equal(schatten, 'Vor dem Termin anrufen');

    const zweite = oeffnen(gespeichert, schatten);
    const wieder = createEditor(halter(), { fragment: zweite.fragment, editable: () => true });
    try {
      assert.equal(noteText(wieder.state.doc), 'Vor dem Termin anrufen');
      // Und NICHT ein zweites Mal aus dem Klartext gebaut: sonst stünde alles
      // doppelt da, sobald eine gewanderte Notiz einmal gespeichert wurde.
      assert.equal(wieder.state.doc.childCount, 1);
    } finally {
      wieder.destroy();
      zweite.ydoc.destroy();
    }
  });

  test('ohne Schreibrecht hängt sie sich trotzdem ein', () => {
    // Der Lese-Link: niemand sät, niemand darf schreiben — und die Notiz muss
    // trotzdem erscheinen statt die Spalte mitzunehmen.
    const { ydoc, fragment } = oeffnen(null, 'Nur zum Lesen');
    const view = createEditor(halter(), { fragment, editable: () => false });
    try {
      assert.equal(noteText(view.state.doc), 'Nur zum Lesen');
      assert.equal(view.editable, false);
    } finally {
      view.destroy();
      ydoc.destroy();
    }
  });

  test('ein leeres Dokument ist beschreibbar und nicht kaputt', () => {
    const { ydoc, fragment } = oeffnen(null, '');
    const view = createEditor(halter(), { fragment, editable: () => true });
    try {
      assert.ok(view.state.doc.childCount >= 1, 'das Schema verlangt mindestens einen Block');
      assert.equal(noteText(view.state.doc), '');
    } finally {
      view.destroy();
      ydoc.destroy();
    }
  });
});
