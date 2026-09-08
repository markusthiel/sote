/**
 * SOTE — die Oberflaeche auf drei Breiten und in zehn Zustaenden durchmessen.
 *
 * Kein Test, sondern ein Werkzeug: es braucht einen laufenden Server und einen
 * Browser, also laeuft es nicht in der CI.
 *
 *   PW_EXE=<pfad-zum-headless-shell> node scripts/measure-widths.mjs
 *
 * ## Vier Fragen, und jede stammt aus einem gemeldeten Fehler
 *
 * 1. Ist der Hauptbereich unbrauchbar schmal? (Er war auf 390 px 55 Pixel
 *    breit -- ein Attributselektor schlug die Schmal-Media-Query.)
 * 2. Ist Inhalt in seinem Kasten abgeschnitten? (Das Zeilenmenue ragte links
 *    aus der Seitenleiste, die abschneidet.)
 * 3. Ragt etwas aus dem Fenster? (Das Kontomenue, 180 Pixel weit.)
 * 4. Ueberdeckt etwas eine fremde Spalte? ('Erledigte einblenden' lag ueber
 *    dem 'schliessen' der Detailspalte, weil .main-head kein
 *    position: relative hatte.)
 *
 * Auf Fensterscrollen prueft es NICHT: genau das haette den ersten Fehler
 * nicht gefunden, weil dort nichts hinausragte, sondern innen abgeschnitten
 * wurde. Gegengeprueft mit kuenstlich wiederhergestellter alter Regel -- der
 * Pruefer meldet 'h1 20<69'.
 *
 * ## Warum 'domcontentloaded' und nicht 'networkidle'
 *
 * Seit es die Tuerklingel gibt (SSE), haelt der Browser einen Strom offen --
 * das Netz wird also NIE ruhig, und 'networkidle' laeuft in einen Timeout.
 * Gefunden beim ersten Live-Test: das Skript blieb an einer Navigation haengen,
 * die vorher immer ging. Wer hier wieder 'networkidle' schreibt, sucht eine
 * halbe Stunde nach einem Fehler in der Anwendung.
 *
 * ZUSTAENDE, nicht Adressen: ein Durchgang ueber Adressen fand nach dem ersten
 * Fehler nichts, und trotzdem war das offene Kontomenue kaputt.
 */

import { chromium } from 'playwright-core';
const b = await chromium.launch({ executablePath: process.env.PW_EXE, args: ['--no-sandbox'] });

const messen = () => {
  const vw = document.documentElement.clientWidth;
  const main = document.querySelector('main');
  const mainW = main ? Math.round(main.getBoundingClientRect().width) : 0;
  return {
    mainW,
    // Ein Hauptbereich unter 240 px ist keine Liste mehr, egal was drin steht.
    zuSchmal: mainW > 0 && mainW < Math.min(240, vw),
    seiteScrollt: document.documentElement.scrollWidth > vw + 1,
    abgeschnitten: [...document.querySelectorAll(
      'h1, h2, .task-title, .set-label, .p-name, th, td, .ws-name, .head-toggle, .menu-item, .set-choice button, .detail-title',
    )].filter((n) => n.scrollWidth > n.clientWidth + 2 && n.clientWidth > 0)
      .slice(0, 4)
      .map((n) => `${n.tagName.toLowerCase()}.${String(n.className).split(' ')[0]} ${n.clientWidth}<${n.scrollWidth} "${(n.textContent ?? '').trim().slice(0, 18)}"`),
    /*
     * Ueberdeckung zwischen SPALTEN.
     *
     * Gemeldet mit Bild: 'Erledigte einblenden' lag ueber dem 'schliessen' der
     * Detailspalte, weil .main-head kein position: relative hatte und der
     * absolut gesetzte Umschalter sich an einem weiter aussen liegenden
     * Element verankerte. Mein Durchgang prueffte Ueberlauf und Abschneiden --
     * und Ueberdeckung ist keins von beiden.
     */
    ueberdeckt: (() => {
      /*
       * Die SCHUBLADE ist ausgenommen, und zwar mit Grund.
       *
       * Unter 800 px ist die Seitenleiste eine Schublade: sie liegt per
       * `position: fixed` ueber der Seite, und dass sie etwas verdeckt, ist
       * ihre Aufgabe. Der Durchgang meldete das zweimal als Befund -- ein
       * Pruefer, der Absicht als Fehler meldet, macht seine echten Befunde
       * unglaubwuerdig.
       */
      const paare = [['.head-toggle', '.detail'], ['.head-toggle', '.panel'], ['.topbar', '.detail']];
      const raus = [];
      for (const [a, c] of paare) {
        const x = document.querySelector(a), y = document.querySelector(c);
        if (!x || !y) continue;
        if (getComputedStyle(y).position === 'fixed') continue;
        const p = x.getBoundingClientRect(), q = y.getBoundingClientRect();
        if (p.right > q.left + 1 && p.left < q.right - 1 && p.bottom > q.top + 1 && p.top < q.bottom - 1) {
          raus.push(`${a} liegt auf ${c}`);
        }
      }
      return raus;
    })(),
    ausserhalb: [...document.querySelectorAll('body *')].filter((n) => {
      const r = n.getBoundingClientRect(); const cs = getComputedStyle(n);
      if (cs.position === 'fixed' || cs.visibility === 'hidden' || cs.display === 'none') return false;
      if (r.width === 0 || r.height === 0) return false;
      return r.right > vw + 1;
    }).slice(0, 3).map((n) => `${n.tagName.toLowerCase()}.${String(n.className).split(' ')[0]}`),
  };
};

const ZUSTAENDE = [
  ['Heute', async (p) => { await p.goto('http://127.0.0.1:8180/', { waitUntil: 'domcontentloaded' }); }],
  ['Heute, Leiste zu', async (p) => {
    await p.goto('http://127.0.0.1:8180/', { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(900);
    const t = p.getByRole('button', { name: /Seitenleiste (aus|ein)blenden/ });
    if (await t.count() > 0) await t.click();
  }],
  ['Aufgabe offen', async (p) => {
    await p.goto('http://127.0.0.1:8180/', { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(1100);
    await p.locator('.task-title').first().click();
  }],
  ['Aufgabe offen, Leiste zu', async (p) => {
    await p.goto('http://127.0.0.1:8180/', { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(1100);
    await p.locator('.task-title').first().click(); await p.waitForTimeout(900);
    const t = p.getByRole('button', { name: /Seitenleiste (aus|ein)blenden/ });
    if (await t.count() > 0) await t.click();
  }],
  ['Erledigte eingeblendet', async (p) => {
    await p.goto('http://127.0.0.1:8180/', { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(1000);
    const t = p.getByRole('button', { name: 'Erledigte einblenden' });
    if (await t.count() > 0) await t.click();
  }],
  ['Zeilenmenue offen', async (p) => {
    await p.goto('http://127.0.0.1:8180/', { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(1100);
    const m = p.locator('.task .handle, .task button[aria-label*="Menü"]').first();
    if (await m.count() > 0) await m.click();
  }],
  ['Projektmenue offen', async (p) => {
    await p.goto('http://127.0.0.1:8180/', { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(1100);
    const m = p.getByRole('button', { name: /Menü für/ }).first();
    if (await m.count() > 0) await m.click();
  }],
  ['Zeichenwaehler offen', async (p) => {
    await p.goto('http://127.0.0.1:8180/workspaces/name', { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(1600);
  }],
  ['Workspace-Wechsler offen', async (p) => {
    await p.goto('http://127.0.0.1:8180/', { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(1000);
    const t = p.getByRole('button', { name: /Workspace .* wechseln/ });
    if (await t.count() > 0) await t.click();
  }],
  ['Kontomenue offen', async (p) => {
    await p.goto('http://127.0.0.1:8180/', { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(1000);
    const t = p.getByRole('button', { name: /Konto$/ });
    if (await t.count() > 0) await t.click();
  }],
];

for (const [wname, w, h] of [['iPhone 390', 390, 780], ['iPad 768', 768, 1024], ['weit 1320', 1320, 860]]) {
  const page = await b.newPage({ viewport: { width: w, height: h }, locale: 'de-DE' });
  await page.goto('http://127.0.0.1:8180/', { waitUntil: 'domcontentloaded' });
  await page.getByLabel(/E-Mail/i).fill('m@example.org');
  await page.getByLabel(/Kennwort/i).fill('ein gutes Kennwort');
  await page.getByRole('button', { name: /Anmelden/i }).click();
  await page.waitForTimeout(2200);
  console.log(`\n== ${wname} ==`);
  for (const [name, tun] of ZUSTAENDE) {
    try { await tun(page); } catch { /* der Zustand ist hier nicht erreichbar */ }
    await page.waitForTimeout(900);
    const m = await page.evaluate(messen);
    const problem = m.zuSchmal || m.seiteScrollt || m.ausserhalb.length > 0
      || m.abgeschnitten.length > 0 || m.ueberdeckt.length > 0;
    console.log(`${problem ? '  X' : '  .'} ${name.padEnd(24)} main=${String(m.mainW).padStart(4)}${m.zuSchmal ? ' ZU SCHMAL' : ''}${m.seiteScrollt ? ' SCROLLT' : ''}`);
    for (const x of m.ausserhalb) console.log(`      ausserhalb: ${x}`);
    for (const x of m.abgeschnitten) console.log(`      abgeschnitten: ${x}`);
    for (const x of m.ueberdeckt) console.log(`      ueberdeckt: ${x}`);
  }
  await page.close();
}
await b.close();
