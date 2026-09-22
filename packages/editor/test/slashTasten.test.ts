/**
 * SOTE — was das `/`-Menü auf Tastendruck tut.
 *
 * Diese Tests gibt es wegen einer Meldung, die anders klang, als sie war:
 *
 *   „Wenn ich eine Aufgabe im Slash Menü hinzufüge steht da ein Text davor
 *   hochkant, das kann man nicht lesen."
 *
 * Der hochkante Text war ein Fehler im Stylesheet. Dahinter steckte ein
 * zweiter, den die Meldung gar nicht benennt: **Enter wählte nichts aus.** Es
 * teilte den Absatz, das getippte `/aufgabe` blieb als Text stehen, und der
 * neue leere Absatz zeigte seinen Platzhalter — eben jenen hochkanten Text.
 *
 * Ursache war die Plugin-Reihenfolge. ProseMirror fragt `handleKeyDown` der
 * Reihe nach und hört beim ersten auf, das wahr zurückgibt; das Menü stand
 * HINTER den Tastenbelegungen und wurde deshalb nach ihnen gefragt. Die Pfeile
 * kamen trotzdem an — die Belegung hat keine —, Enter nicht.
 *
 * Also prüft der erste Test genau das, und zwar am zusammengebauten Editor und
 * nicht an der Reihenfolge einer Liste: die Reihenfolge ist die Ursache, das
 * Verhalten ist die Zusage.
 */

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { JSDOM } from 'jsdom';
import * as Y from 'yjs';

let dom: JSDOM;
let createEditor: typeof import('../src/editor.js').createEditor;
let seedEmptyPage: typeof import('../src/editor.js').seedEmptyPage;
let slashMenuState: typeof import('../src/slashMenu.js').slashMenuState;

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

describe('das /-Menü und die Tasten', () => {
  before(async () => {
    dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true });
    for (const key of DOM_GLOBALS) {
      Object.defineProperty(globalThis, key, {
        value: (dom.window as unknown as Record<string, unknown>)[key],
        configurable: true,
        writable: true,
      });
    }
    const editor = await import('../src/editor.js');
    createEditor = editor.createEditor;
    seedEmptyPage = editor.seedEmptyPage;
    slashMenuState = (await import('../src/slashMenu.js')).slashMenuState;
  });

  after(() => dom?.window.close());

  /** Ein leerer Editor, an dem getippt werden kann. */
  const aufbauen = () => {
    const ydoc = new Y.Doc();
    const fragment = ydoc.getXmlFragment('notiz');
    seedEmptyPage(fragment);
    const mount = dom.window.document.createElement('div');
    dom.window.document.body.appendChild(mount);
    const view = createEditor(mount as unknown as HTMLElement, {
      fragment,
      editable: () => true,
      /*
       * Deutsche Schlagwörter wie in der Oberfläche.
       *
       * Das Paket ist SONEs und spricht Englisch; die deutschen Wörter reicht
       * `NoteEditor.tsx` beim Bauen hinein. Ohne sie findet „aufgabe" hier
       * nichts — und ein Test, der mit „todo" sucht, prüfte einen Weg, den in
       * SOTE niemand geht.
       */
      localiseSlashItem: (item) => ({
        ...item,
        keywords: [...item.keywords, ...(DEUTSCH[item.id] ?? [])],
      }),
    });
    return { ydoc, view };
  };

  /** Was die Oberfläche an deutschen Wörtern mitgibt — hier nur, was die Tests brauchen. */
  const DEUTSCH: Record<string, string[]> = {
    todo: ['aufgabe', 'kästchen'],
    table: ['tabelle'],
    bulletList: ['aufzählung'],
  };

  /**
   * Eine Taste so zustellen, wie der Browser es täte.
   *
   * Über `someProp('handleKeyDown')` und nicht durch Aufruf des Plugins: die
   * Frage ist ja gerade, WELCHES Plugin die Taste zuerst bekommt. Ein direkter
   * Aufruf würde die Reihenfolge überspringen, also genau das, was kaputt war.
   */
  const taste = (view: ReturnType<typeof aufbauen>['view'], key: string): boolean => {
    const event = new dom.window.KeyboardEvent('keydown', { key, bubbles: true });
    return view.someProp('handleKeyDown', (f) => f(view, event as unknown as KeyboardEvent)) === true;
  };

  const tippen = (view: ReturnType<typeof aufbauen>['view'], text: string): void => {
    for (const zeichen of text) {
      const { from, to } = view.state.selection;
      // Das fünfte Argument ist ProseMirrors Rückfall: „was täte der Editor
      // ohne dieses Plugin". Hier wird es nie gebraucht, weil der Aufrufer
      // unten selbst einfügt, wenn niemand die Eingabe genommen hat.
      const behandelt = view.someProp('handleTextInput', (f) =>
        f(view, from, to, zeichen, () => view.state.tr.insertText(zeichen, from, to)),
      );
      if (behandelt !== true) view.dispatch(view.state.tr.insertText(zeichen, from, to));
    }
  };

  test('Enter wählt den hervorgehobenen Eintrag statt den Absatz zu teilen', () => {
    const { ydoc, view } = aufbauen();
    try {
      tippen(view, '/aufgabe');
      assert.ok(slashMenuState(view.state), 'das Menü muss offen sein');

      assert.equal(taste(view, 'Enter'), true, 'Enter gehört dem offenen Menü');
      assert.equal(view.state.doc.firstChild?.type.name, 'todo');
      // Und das getippte `/aufgabe` ist weg, statt als Text stehenzubleiben.
      assert.equal(view.state.doc.textContent, '');
      assert.equal(slashMenuState(view.state), null, 'danach ist das Menü zu');
    } finally {
      view.destroy();
      ydoc.destroy();
    }
  });

  test('die Pfeile bewegen die Auswahl, Escape schliesst', () => {
    const { ydoc, view } = aufbauen();
    try {
      tippen(view, '/');
      const erste = slashMenuState(view.state)?.index;
      assert.equal(taste(view, 'ArrowDown'), true);
      assert.notEqual(slashMenuState(view.state)?.index, erste);
      assert.equal(taste(view, 'Escape'), true);
      assert.equal(slashMenuState(view.state), null);
      // Escape lässt das Getippte stehen — es ist ja vielleicht ein Datumsformat.
      assert.equal(view.state.doc.textContent, '/');
    } finally {
      view.destroy();
      ydoc.destroy();
    }
  });

  test('ohne offenes Menü teilt Enter den Absatz wie immer', () => {
    // Die Gegenprobe zur Reihenfolge: das Menü darf die Taste nur nehmen,
    // solange es offen ist — sonst wäre der Editor nicht mehr zu betippen.
    const { ydoc, view } = aufbauen();
    try {
      tippen(view, 'Erste Zeile');
      assert.equal(taste(view, 'Enter'), true);
      assert.equal(view.state.doc.childCount, 2);
    } finally {
      view.destroy();
      ydoc.destroy();
    }
  });

  test('eine eingefügte Tabelle nimmt die Schreibmarke in ihre erste Zelle', () => {
    // Vorher blieb die Marke stehen, wo sie war: die Tabelle erschien, und das
    // Getippte landete in der Zelle, in der die Marke zufällig gelandet war.
    const { ydoc, view } = aufbauen();
    try {
      tippen(view, '/tabelle');
      assert.equal(taste(view, 'Enter'), true);
      tippen(view, 'Tag');

      const tabelle = view.state.doc.firstChild;
      assert.equal(tabelle?.type.name, 'table');
      const ersteZelle = tabelle?.firstChild?.firstChild;
      assert.equal(ersteZelle?.textContent, 'Tag');
    } finally {
      view.destroy();
      ydoc.destroy();
    }
  });
});
