'use strict';
/* Make realistic test screenshots for the AI poster-reading test.

   Each real Union event is drawn as an Instagram-style post (account name,
   poster, caption) and captured at phone size, one screen tall, the way someone
   would screenshot it. The right answers come from the Union's structured
   listing, so we can score what the AI reads back.

     node tools/render-screens.js [count]     -> tools/out/screens/*.jpg + manifest.json */
const fs = require('fs');
const path = require('path');
const { launch, sleep } = require('./drive.js');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(__dirname, 'out', 'screens');
const COUNT = Number(process.argv[2] || 30);
const TZ = 'Europe/London';

const DATE_WORDS = /\b(mon|tues?|wed(nes)?|thu(rs)?|fri|sat(ur)?|sun)(day)?\b|\b\d{1,2}(st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)|\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{1,2}\b|\b\d{1,2}[/.]\d{1,2}\b|\btoday\b|\btomorrow\b|\btonight\b/i;
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const handle = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 18) || 'society';
const londonParts = (iso) => {
  const d = new Date(iso);
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  const time = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }).format(d);
  return { day, time };
};

// The ways societies actually write dates in captions, rotated across events.
function dateLine(e, i) {
  const d = new Date(e.start);
  const part = (opts) => new Intl.DateTimeFormat('en-GB', { timeZone: TZ, ...opts }).format(d);
  const dayNum = Number(part({ day: 'numeric' }));
  const ord = dayNum + (dayNum % 10 === 1 && dayNum !== 11 ? 'st' : dayNum % 10 === 2 && dayNum !== 12 ? 'nd' : dayNum % 10 === 3 && dayNum !== 13 ? 'rd' : 'th');
  const twelve = (iso) => {
    const [h, m] = londonParts(iso).time.split(':').map(Number);
    return `${h % 12 || 12}${m ? `:${String(m).padStart(2, '0')}` : ''}${h < 12 ? 'am' : 'pm'}`;
  };
  const start = twelve(e.start);
  const end = e.end ? twelve(e.end) : null;
  const t24 = `${londonParts(e.start).time}${e.end ? `–${londonParts(e.end).time}` : ''}`;
  const where = e.location ? `\n📍 ${e.location}` : '';
  const weekday = part({ weekday: 'long' });
  const formats = [
    `📅 ${part({ weekday: 'short' })} ${dayNum} ${part({ month: 'short' })} · ${start}${end ? `–${end}` : ''}${where}`,
    `🗓️ ${weekday} ${ord} ${part({ month: 'long' })}, ${t24}${where}`,
    `This ${weekday} from ${start}${end ? ` until ${end}` : ''}!${where}`,
    `${part({ day: '2-digit' })}/${part({ month: '2-digit' })} | ${start}${end ? `-${end}` : ''}${where}`,
    `Join us on ${weekday} (${ord}) at ${start}${where}`,
  ];
  return formats[i % formats.length];
}

function page(e) {
  const who = handle(e.society);
  const caption = (e.description || '').slice(0, 900);
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>
    body { margin: 0; font: 14px/1.35 -apple-system, "Segoe UI", Roboto, Arial, sans-serif; color: #111; background: #fff; }
    .top { display: flex; align-items: center; gap: 10px; padding: 10px 12px; }
    .av { width: 32px; height: 32px; border-radius: 50%; background: linear-gradient(45deg,#f9ce34,#ee2a7b,#6228d7); padding: 2px; }
    .av div { width: 100%; height: 100%; border-radius: 50%; background: #fff; display: grid; place-items: center; font-size: 11px; font-weight: 700; }
    .name { font-weight: 600; } .loc { font-size: 12px; color: #444; }
    .pic { background: #000; display: flex; justify-content: center; }
    .pic img { width: 100%; max-height: 430px; object-fit: contain; display: block; }
    .icons { padding: 8px 12px 4px; font-size: 22px; letter-spacing: 10px; }
    .cap { padding: 0 12px; white-space: pre-line; }
    .ago { padding: 6px 12px 14px; font-size: 11px; color: #777; text-transform: uppercase; }
  </style></head><body>
    <div class="top"><div class="av"><div>${esc(who.slice(0, 2).toUpperCase())}</div></div>
      <div><div class="name">${esc(who)}</div><div class="loc">Imperial College London</div></div></div>
    <div class="pic"><img src="${esc(e.image)}" referrerpolicy="no-referrer"></div>
    <div class="icons">♡ 💬 ➤</div>
    <div class="cap"><b>${esc(who)}</b> ${esc(caption)}</div>
    <div class="ago">1 hour ago</div>
  </body></html>`;
}

(async () => {
  const data = JSON.parse(fs.readFileSync(path.join(ROOT, 'site', 'data', 'events.json'), 'utf8'));
  // Events with a poster and a known start time, spread across the list.
  const pool = data.events.filter((e) => e.image && !e.allDay);
  const step = Math.max(1, pool.length / COUNT);
  const chosen = [];
  for (let i = 0; i < pool.length && chosen.length < COUNT; i += step) chosen.push(pool[Math.floor(i)]);

  fs.mkdirSync(OUT, { recursive: true });
  const manifest = [];
  const s = await launch({ width: 390, height: 844 });
  try {
    await s.setViewport(390, 844, { mobile: true, dpr: 2 });
    for (const [i, e] of chosen.entries()) {
      const start = londonParts(e.start);
      const taken = new Date(Date.parse(e.start) - 3 * 86400e3);  // posted three days before
      const truth = {
        date: start.day,
        start_time: start.time,
        end_time: e.end ? londonParts(e.end).time : null,
        location: e.location || null,
      };
      // Two posts per event: the caption as the society wrote it for the Union
      // site (often no date, because the Union keeps that in its own field), and
      // the same caption with a date line written the way societies write them.
      const line = dateLine(e, i);
      const variants = [
        { suffix: '', event: e, dateInCaption: DATE_WORDS.test(e.description || ''), dateLine: null },
        { suffix: '-dated', event: { ...e, description: `${line}\n\n${e.description || ''}` }, dateInCaption: true, dateLine: line },
      ];
      for (const v of variants) {
        await s.goto('data:text/html;base64,' + Buffer.from(page(v.event)).toString('base64'));
        try {
          await s.waitFor(`document.images[0].complete && document.images[0].naturalWidth > 0`, 15000);
        } catch {
          console.log('  ! poster did not load, skipping', e.id);
          continue;
        }
        await sleep(100);
        const shot = await s.send('Page.captureScreenshot', { format: 'jpeg', quality: 82 });
        const file = `${e.id}${v.suffix}.jpg`;
        fs.writeFileSync(path.join(OUT, file), Buffer.from(shot.data, 'base64'));
        manifest.push({
          id: e.id, file, variant: v.suffix ? 'dated' : 'as-listed', title: e.title, society: e.society,
          taken: londonParts(taken.toISOString()).day, dateInCaption: v.dateInCaption, dateLine: v.dateLine, truth,
        });
        console.log('  rendered', file);
      }
    }
  } finally {
    await s.close();
  }
  fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 1));
  console.log(`${manifest.length} screenshots in tools/out/screens/`);
})().catch((e) => { console.error(e); process.exit(1); });
