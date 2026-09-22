/**
 * SOTE — der Editor der Notiz.
 *
 * Aus SONEs `@sone/editor` übernommen (22.09.2026). Weggelassen ist, was es in
 * SOTE nicht gibt: Seitenverweise, Kommentar-Anker, Autorenfarben und die
 * Einbettung von SOTE-Aufgaben — die zeigt in die andere Richtung.
 *
 * Das Paket kennt kein React. Eine Notiz ist eine `Y.XmlFragment`, die Spalte
 * hängt sie an eine `EditorView`; wer die Oberfläche baut, liegt eine Ebene
 * darüber (SONEs ADR-0016).
 */
export * from './schema.js';
export * from './calloutTones.js';
export * from './dividerOrnaments.js';
export * from './blockIds.js';
export * from './inputRules.js';
export * from './keymap.js';
export * from './blockOps.js';
export * from './commands.js';
export * from './links.js';
export * from './imagePaste.js';
export * from './tables.js';
export * from './collapse.js';
export * from './placeholders.js';
export * from './codeCopy.js';
export * from './markdownPaste.js';
export * from './slashMenu.js';
export * from './mentionMenu.js';
export * from './editor.js';
export * from './blockLock.js';
export * from './editGuard.js';
export * from './noteText.js';
