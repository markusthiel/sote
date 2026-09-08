/**
 * SOTE — die Oberflaeche auf drei Breiten durchmessen.
 *
 * Kein Test, sondern ein Werkzeug: es braucht einen laufenden Server und einen
 * Browser, also laeuft es nicht in der CI. Aufruf:
 *
 *   PW_EXE=<pfad-zum-headless-shell> node scripts/measure-widths.mjs
 *   (Server auf 127.0.0.1:8180, Zugangsdaten unten anpassen)
 *
 * ## Warum es ZUSTAENDE abklappert und nicht Adressen
 *
 * Der Anlass war ein Fehler, bei dem der Inhalt auf 390 px 55 Pixel breit war
 * -- eine Rastervorlage mit Attributselektor schlug die Schmal-Media-Query,
 * weil ein Attribut mehr wiegt als eine Klasse. Ein Durchgang ueber Adressen
 * fand danach NICHTS, und trotzdem war noch etwas kaputt: das offene
 * Kontomenue stand 180 Pixel ausserhalb des Fensters. Die Seite war in
 * Ordnung, der Zustand nicht.
 *
 * ## Warum es nicht auf Fensterscrollen prueft
 *
 * Weil genau das den Anlassfehler NICHT gefunden haette: bei 55 px ragte
 * nichts hinaus, es wurde innen abgeschnitten. Die drei Fragen, die zaehlen:
 * ist der Hauptbereich unbrauchbar schmal, ist Inhalt in seinem Kasten
 * abgeschnitten (scrollWidth > clientWidth), ragt etwas rechts hinaus.
 * Gegengeprueft: mit kuenstlich wiederhergestellter alter Regel meldet der
 * Pruefer "h1 20<69".
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
    ausserhalb: [...document.querySelectorAll('body *')].filter((n) => {
      const r = n.getBoundingClientRect(); const cs = getComputedStyle(n);
      if (cs.position === 'fixed' || cs.visibility === 'hidden' || cs.display === 'none') return false;
      if (r.width === 0 || r.height === 0) return false;
      return r.right > vw + 1;
    }).slice(0, 3).map((n) => `${n.tagName.toLowerCase()}.${String(n.className).split(' ')[0]}`),
  };
};

const ZUSTAENDE = [
  ['Heute', async (p) => { await p.goto('http://127.0.0.1:8180/', { waitUntil: 'networkidle' }); }],
  ['Heute, Leiste zu', async (p) => {
    await p.goto('http://127.0.0.1:8180/', { waitUntil: 'networkidle' }); await p.waitForTimeout(900);
    const t = p.getByRole('button', { name: /Seitenleiste (aus|ein)blenden/ });
    if (await t.count() > 0) await t.click();
  }],
  ['Aufgabe offen', async (p) => {
    await p.goto('http://127.0.0.1:8180/', { waitUntil: 'networkidle' }); await p.waitForTimeout(1100);
    await p.locator('.task-title').first().click();
  }],
  ['Aufgabe offen, Leiste zu', async (p) => {
    await p.goto('http://127.0.0.1:8180/', { waitUntil: 'networkidle' }); await p.waitForTimeout(1100);
    await p.locator('.task-title').first().click(); await p.waitForTimeout(900);
    const t = p.getByRole('button', { name: /Seitenleiste (aus|ein)blenden/ });
    if (await t.count() > 0) await t.click();
  }],
  ['Erledigte eingeblendet', async (p) => {
    await p.goto('http://127.0.0.1:8180/', { waitUntil: 'networkidle' }); await p.waitForTimeout(1000);
    const t = p.getByRole('button', { name: 'Erledigte einblenden' });
    if (await t.count() > 0) await t.click();
  }],
  ['Zeilenmenue offen', async (p) => {
    await p.goto('http://127.0.0.1:8180/', { waitUntil: 'networkidle' }); await p.waitForTimeout(1100);
    const m = p.locator('.task .handle, .task button[aria-label*="Menü"]').first();
    if (await m.count() > 0) await m.click();
  }],
  ['Projektmenue offen', async (p) => {
    await p.goto('http://127.0.0.1:8180/', { waitUntil: 'networkidle' }); await p.waitForTimeout(1100);
    const m = p.getByRole('button', { name: /Menü für/ }).first();
    if (await m.count() > 0) await m.click();
  }],
  ['Zeichenwaehler offen', async (p) => {
    await p.goto('http://127.0.0.1:8180/workspaces/name', { waitUntil: 'networkidle' }); await p.waitForTimeout(1600);
  }],
  ['Workspace-Wechsler offen', async (p) => {
    await p.goto('http://127.0.0.1:8180/', { waitUntil: 'networkidle' }); await p.waitForTimeout(1000);
    const t = p.getByRole('button', { name: /Workspace .* wechseln/ });
    if (await t.count() > 0) await t.click();
  }],
  ['Kontomenue offen', async (p) => {
    await p.goto('http://127.0.0.1:8180/', { waitUntil: 'networkidle' }); await p.waitForTimeout(1000);
    const t = p.getByRole('button', { name: /Konto$/ });
    if (await t.count() > 0) await t.click();
  }],
];

for (const [wname, w, h] of [['iPhone 390', 390, 780], ['iPad 768', 768, 1024], ['weit 1320', 1320, 860]]) {
  const page = await b.newPage({ viewport: { width: w, height: h }, locale: 'de-DE' });
  await page.goto('http://127.0.0.1:8180/', { waitUntil: 'networkidle' });
  await page.getByLabel(/E-Mail/i).fill('m@example.org');
  await page.getByLabel(/Kennwort/i).fill('ein gutes Kennwort');
  await page.getByRole('button', { name: /Anmelden/i }).click();
  await page.waitForTimeout(2200);
  console.log(`\n== ${wname} ==`);
  for (const [name, tun] of ZUSTAENDE) {
    try { await tun(page); } catch { /* der Zustand ist hier nicht erreichbar */ }
    await page.waitForTimeout(900);
    const m = await page.evaluate(messen);
    const problem = m.zuSchmal || m.seiteScrollt || m.ausserhalb.length > 0 || m.abgeschnitten.length > 0;
    console.log(`${problem ? '  X' : '  .'} ${name.padEnd(24)} main=${String(m.mainW).padStart(4)}${m.zuSchmal ? ' ZU SCHMAL' : ''}${m.seiteScrollt ? ' SCROLLT' : ''}`);
    for (const x of m.ausserhalb) console.log(`      ausserhalb: ${x}`);
    for (const x of m.abgeschnitten) console.log(`      abgeschnitten: ${x}`);
  }
  await page.close();
}
await b.close();
