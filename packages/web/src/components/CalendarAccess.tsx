export const calendarAccessLabel = (writable: boolean | null | undefined) =>
  writable === true ? 'Lesen und Schreiben' : writable === false ? 'Nur Lesen' : 'Lesen · Schreibrechte ungeprüft';

export function CalendarAccess({writable}:{writable:boolean|null|undefined}) {
  return <span className="calendar-access-badge" data-access={writable === true ? 'write' : writable === false ? 'read' : 'unknown'}>{calendarAccessLabel(writable)}</span>;
}
