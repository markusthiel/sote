/**
 * SOTE — der Dienstarbeiter.
 *
 * GEWÜNSCHT: „Wenn ich als App installiere, dass es richtige
 * App-Benachrichtigungen sendet."
 *
 * Das hier ist das Stück, das läuft, wenn die App ZU ist. Es tut genau zwei
 * Dinge: eine ankommende Meldung anzeigen, und einen Tipp darauf in die
 * richtige Aufgabe führen. Mehr gehört nicht hinein — ein Dienstarbeiter, der
 * auch noch Antworten zwischenspeichert, ist ein zweiter Server mit eigenen
 * Vorstellungen davon, was aktuell ist, und die Fehler daraus sucht man in der
 * Anwendung.
 *
 * Deshalb steht hier auch KEIN `fetch`-Fänger. Eine Anwendung, die offline
 * arbeitet, ist eine eigene Entscheidung mit eigenen Fragen (was gilt, wenn
 * zwei Geräte dasselbe geändert haben?). Diese Datei beantwortet nur die
 * Frage, die gestellt war.
 */

/* eslint-disable no-undef */

self.addEventListener('install', () => {
  // Sofort übernehmen: sonst wartet der neue Arbeiter, bis alle alten Fenster
  // zu sind — und beim ersten Einrichten ist genau eines offen.
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(self.clients.claim());
});

self.addEventListener('push', (e) => {
  /*
   * Ohne Nutzlast trotzdem etwas zeigen.
   *
   * Manche Zustelldienste schicken einen leeren Anstoss (etwa um ein
   * Abonnement zu prüfen). Eine Meldung ohne Inhalt ist besser als eine
   * Ausnahme im Arbeiter — die zählt der Browser gegen uns, und nach genug
   * davon liefert er gar nichts mehr aus.
   */
  let note = { title: 'SOTE' };
  try {
    if (e.data) note = { ...note, ...e.data.json() };
  } catch {
    // Kein JSON: dann bleibt der Titel oben.
  }

  e.waitUntil(
    self.registration.showNotification(note.title, {
      body: note.body ?? '',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      /* Gleiche Marke ersetzt: zwei Erinnerungen an dieselbe Aufgabe sollen
         nicht untereinander stehen. */
      tag: note.tag ?? 'sote',
      data: { url: note.url ?? '/' },
    }),
  );
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const ziel = e.notification.data?.url ?? '/';

  /*
   * Ein OFFENES Fenster benutzen, wenn es eines gibt.
   *
   * Sonst hat man nach drei Erinnerungen drei Fenster derselben Anwendung, und
   * in zweien davon steht ein Stand von gestern.
   */
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((fenster) => {
      for (const f of fenster) {
        if ('focus' in f) {
          f.navigate?.(ziel);
          return f.focus();
        }
      }
      return self.clients.openWindow(ziel);
    }),
  );
});
