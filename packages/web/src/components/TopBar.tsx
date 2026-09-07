/**
 * SOTE — die Zeile über dem Inhalt.
 *
 * Gemeldet, mit Bildern aus SONE: „Die Seitenleisten haben jeweils Buttons zum
 * ausblenden, aber **innerhalb der Seite**, nicht wie du es jetzt gemacht hast
 * in der Seitenleiste oben."
 *
 * Der Unterschied ist keine Geschmacksfrage, und ich habe ihn beim ersten Mal
 * nicht gesehen: **ein Knopf, der eine Leiste ausblendet, darf nicht in der
 * Leiste sitzen, die er ausblendet.** Sonst verschwindet er mit ihr, und der
 * Weg zurück ist woanders als der Weg hin. In der Schiene wäre er zwar nicht
 * mitverschwunden — aber er säße in der Liste der *Orte*, und das Ein- und
 * Ausblenden ist kein Ort.
 *
 * Hier gehört er hin: an den Rand des Bereichs, den die Leiste freigibt. Links
 * der für die Seitenleiste, rechts der für die Detailspalte — jeder auf der
 * Seite, auf der seine Leiste liegt, damit die Richtung stimmt, in die man
 * denkt.
 *
 * Die Zeile trägt außerdem, was SONE dort trägt: einen Platz für den Zustand.
 * SONE zeigt „Synced"; SOTE hat noch nichts zu melden und lässt die Mitte
 * darum leer, statt ein Wort zu erfinden.
 */

import { PanelRightIcon, SidebarIcon } from './icons.js';

export function TopBar({
  sidebarVisible,
  onToggleSidebar,
  detailOpen,
  onToggleDetail,
}: {
  sidebarVisible: boolean;
  onToggleSidebar: () => void;
  /** Fehlt, wenn gerade keine Aufgabe offen ist — dann gibt es nichts zu falten. */
  detailOpen: boolean;
  onToggleDetail: (() => void) | undefined;
}) {
  return (
    <div className="topbar">
      <button
        type="button"
        className="topbar-knob"
        aria-label={sidebarVisible ? 'Seitenleiste ausblenden' : 'Seitenleiste einblenden'}
        aria-pressed={sidebarVisible}
        title={sidebarVisible ? 'Seitenleiste ausblenden' : 'Seitenleiste einblenden'}
        onClick={onToggleSidebar}
      >
        <SidebarIcon size={17} />
      </button>

      <span className="topbar-gap" />

      {onToggleDetail === undefined ? null : (
        <button
          type="button"
          className="topbar-knob"
          aria-label={detailOpen ? 'Detailspalte ausblenden' : 'Detailspalte einblenden'}
          aria-pressed={detailOpen}
          title={detailOpen ? 'Detailspalte ausblenden' : 'Detailspalte einblenden'}
          onClick={onToggleDetail}
        >
          <PanelRightIcon size={17} />
        </button>
      )}
    </div>
  );
}
