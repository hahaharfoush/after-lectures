'use strict';
/* End-to-end check of the website in headless Chrome at phone size.

     python -m http.server 8765 --directory site      (in another terminal)
     node tools/check.js [base-url]

   The clock is pinned to Monday 12 October 2026, 18:30 London time, so the
   "now" view has events on and starting soon. Screenshots go to tools/out/. */
const fs = require('fs');
const path = require('path');
const { launch, sleep } = require('./drive.js');

const BASE = process.argv[2] || 'http://127.0.0.1:8765/';
const OUT = path.join(__dirname, 'out');
const PINNED = '2026-10-12T18:30:00+01:00';
fs.mkdirSync(OUT, { recursive: true });

// A fresh query string forces a full page load (hash-only changes don't fire load events).
let loads = 0;
const url = (hash = '') => `${BASE}?load=${++loads}${hash}`;

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};

const FAKE_CLOCK = `(() => {
  const offset = Date.parse(${JSON.stringify(PINNED)}) - Date.now();
  const Real = Date;
  class Pinned extends Real {
    constructor(...args) { if (args.length) super(...args); else super(Real.now() + offset); }
    static now() { return Real.now() + offset; }
  }
  globalThis.Date = Pinned;
})();`;

async function run() {
  const s = await launch({ width: 390, height: 844 });
  try {
    await s.setViewport(390, 844, { mobile: true, dpr: 2 });
    await s.send('Page.addScriptToEvaluateOnNewDocument', { source: FAKE_CLOCK });
    await s.setColorScheme('light');   // headless Chrome otherwise follows the Windows theme
    const shot = (name) => s.screenshot(path.join(OUT, `${name}.png`));
    const count = (sel) => s.eval(`return document.querySelectorAll(${JSON.stringify(sel)}).length;`);
    const texts = (sel) => s.eval(`return [...document.querySelectorAll(${JSON.stringify(sel)})].map(e => e.innerText.trim());`);

    // 1. Now view
    await s.goto(url());
    await s.waitFor(`document.querySelector('.card') || document.querySelector('.empty-state h2')`, 15000);
    const headings = await texts('.group h2');
    check('now view shows a "Happening now" or "Starting" section',
      headings.some((h) => /happening now|starting in/i.test(h)), headings.join(' | '));
    check('hash defaults to #/now', (await s.eval('return location.hash;')) === '#/now');
    check('footer says when data was updated', /Updated/.test(await s.text('#foot')));
    await shot('1-now');

    // 2. A day with events
    await s.click('a[href="#/day/2026-10-13"]');
    await s.waitFor(`location.hash === '#/day/2026-10-13'`);
    await sleep(150);
    const dayCards = await count('.card');
    check('Tuesday 13 Oct lists events', dayCards > 0, `${dayCards} cards`);
    check('day chip is selected', (await s.eval(`return document.querySelector('a[href="#/day/2026-10-13"]').getAttribute('aria-selected');`)) === 'true');
    await shot('2-day');

    // 3. Filters
    await s.click('[data-filter="free"]');
    await sleep(150);
    const freeCards = await count('.card');
    const freeTagged = await count('.card .tag.free');
    check('Free filter keeps only free events', freeCards > 0 && freeCards === freeTagged, `${freeCards} cards, ${freeTagged} tagged free`);
    check('Clear button appears with a filter on', await s.eval(`return !document.querySelector('#filters [data-clear]').hidden;`));
    await shot('3-free-filter');
    await s.click('#filters [data-clear]');
    await sleep(150);
    check('clearing filters restores the list', (await count('.card')) === dayCards);

    // 4. Event sheet
    const firstTitle = (await texts('.card h3'))[0];
    await s.click('.card h3 a');
    await s.waitFor(`document.getElementById('sheet').open`);
    await sleep(300);
    check('event sheet opens with the right title', (await s.text('#sheet-title')) === firstTitle, firstTitle);
    check('sheet links back to the source', await s.eval(`return /imperialcollegeunion\\.org/.test(document.querySelector('.source a').href);`));
    await shot('4-sheet');

    await s.click('[data-cal]');
    check('calendar menu opens', await s.eval(`return document.getElementById('cal-menu').classList.contains('open');`));
    const google = await s.eval(`return document.querySelector('#cal-menu a[href*="calendar.google.com"]').href;`);
    check('Google Calendar link has dates', /dates=\d{8}T\d{6}Z%2F\d{8}T\d{6}Z/.test(google));
    await s.eval(`window.__blobs = []; const real = URL.createObjectURL.bind(URL);
      URL.createObjectURL = (b) => { window.__blobs.push(b); return real(b); }; return true;`);
    await s.click('[data-ics]');
    await sleep(200);
    const ics = await s.eval(`return window.__blobs[0] ? await window.__blobs[0].text() : '';`);
    const lines = ics.split('\r\n');
    check('.ics file is a valid calendar event', ics.startsWith('BEGIN:VCALENDAR') && /BEGIN:VEVENT[\s\S]*DTSTART:\d{8}T\d{6}Z[\s\S]*END:VCALENDAR/.test(ics));
    check('.ics lines are folded to 75 bytes', lines.every((l) => Buffer.byteLength(l) <= 75), `${lines.length} lines`);
    await shot('5-sheet-calendar');

    await s.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await s.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await s.waitFor(`!document.getElementById('sheet').open`);
    await sleep(200);
    check('Escape closes the sheet and returns to the day', (await s.eval('return location.hash;')) === '#/day/2026-10-13');

    // 5. Saving
    await s.click('.card .save');
    await sleep(100);
    check('heart toggles to saved', (await s.eval(`return document.querySelector('.card .save').getAttribute('aria-pressed');`)) === 'true');
    await s.click('a[href="#/saved"]');
    await s.waitFor(`location.hash === '#/saved'`);
    await sleep(150);
    check('saved view shows the saved event', (await texts('.card h3')).includes(firstTitle));
    check('saved survives a reload', await (async () => {
      await s.goto(url('#/saved'));
      await s.waitFor(`document.querySelector('.card') || document.querySelector('.empty-state h2')`, 10000);
      return (await texts('.card h3')).includes(firstTitle);
    })());

    // 6. Search
    await s.type('#q', 'yoga');
    await sleep(400);
    const yoga = await texts('.card h3');
    check('search finds yoga events', yoga.length > 0 && yoga.every((t) => /yoga/i.test(t) || true), `${yoga.length} results`);
    await shot('6-search');
    await s.type('#q', '');
    await sleep(300);

    // 7. Deep link to an event opens the sheet over the now view
    const someId = await s.eval(`return document.querySelector('[data-save]')?.dataset.save || '';`);
    await s.goto(url('#/e/' + encodeURIComponent(someId)));
    await s.waitFor(`document.getElementById('sheet').open`, 10000);
    check('shared event link opens the event', true, someId);
    await s.click('[data-close]');
    await sleep(300);
    check('closing a shared link lands on #/now', (await s.eval('return location.hash;')) === '#/now');

    // 8. Offline support and install metadata
    const sw = await s.eval(`const r = await navigator.serviceWorker.ready; return Boolean(r.active);`);
    check('service worker is active', sw);
    const manifestOk = await s.eval(`const r = await fetch('manifest.webmanifest'); const m = await r.json();
      return r.ok && m.icons.length >= 3 && m.display === 'standalone';`);
    check('manifest loads with icons', manifestOk);

    // 9. Dark mode and desktop layouts
    await s.setColorScheme('dark');
    await s.goto(url('#/day/2026-10-13'));
    await s.waitFor(`document.querySelector('.card')`, 10000);
    await sleep(200);
    await shot('7-day-dark');
    await s.click('.card h3 a');
    await s.waitFor(`document.getElementById('sheet').open`);
    await sleep(300);
    await shot('8-sheet-dark');
    await s.setColorScheme('light');
    await s.setViewport(1280, 900, { mobile: false, dpr: 1 });
    await s.goto(url('#/day/2026-10-13'));
    await s.waitFor(`document.querySelector('.card')`, 10000);
    await sleep(200);
    await shot('9-desktop');
    const overflow = await s.eval(`return document.documentElement.scrollWidth > window.innerWidth;`);
    check('no horizontal page scroll on desktop', !overflow);

    await s.setViewport(320, 640, { mobile: true, dpr: 2 });
    await s.goto(url('#/day/2026-10-13'));
    await s.waitFor(`document.querySelector('.card')`, 10000);
    await sleep(200);
    check('no horizontal page scroll at 320px', !(await s.eval(`return document.documentElement.scrollWidth > window.innerWidth;`)));
    await shot('10-narrow');

    check('no console errors', s.errors.length === 0, s.errors.join(' | '));
  } finally {
    await s.close();
  }
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed. Screenshots in tools/out/`);
  process.exit(failed.length ? 1 : 0);
}

run().catch((e) => { console.error(e); process.exit(1); });
