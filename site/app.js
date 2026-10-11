/* After Lectures: what's on at Imperial, from every society, in one place.

   Reads data/events.json (written by pipeline/build.py) and renders it.
   No framework and no build step: this file is served exactly as written.
   Routes live in the URL hash so links can be shared:
     #/now            what's on now and later today
     #/day/2026-10-12 one day
     #/saved          events you've saved on this device
     #/e/<event id>   one event, opened over whichever list you were on */

const DATA_URL = 'data/events.json';
const TZ = 'Europe/London';
const HOUR = 3_600_000;
const SOON_HOURS = 3;
const DEFAULT_MINUTES = 120;   // assumed length when an event has no end time
const DAYS_SHOWN = 14;
const REFRESH_AFTER = 30 * 60_000;

const TAG_LABELS = {
  soldout: 'Sold out', free: 'Free', food: 'Food', open: 'Open to all', beginner: 'Newcomers welcome',
  members: 'Members only', signup: 'Sign-up needed', dropin: 'Drop-in', alcoholfree: 'Alcohol-free',
  accessible: 'Wheelchair accessible',
};
const CARD_TAGS = ['soldout', 'free', 'food', 'open', 'beginner', 'members', 'signup', 'dropin', 'alcoholfree'];
const FILTERS = [
  { id: 'free', label: 'Free' },
  { id: 'open', label: 'Open to all' },
  { id: 'food', label: 'Food' },
  { id: 'beginner', label: 'Newcomers' },
];
const SOURCE_NAMES = { union: 'Imperial College Union website' };

const svg = (inner) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
const ICON = {
  heart: svg('<path d="M12 20.5s-7.5-4.6-9.2-9.4C1.7 7.8 3.9 4.5 7.3 4.5c2 0 3.5 1.1 4.7 2.8 1.2-1.7 2.7-2.8 4.7-2.8 3.4 0 5.6 3.3 4.5 6.6-1.7 4.8-9.2 9.4-9.2 9.4z"/>'),
  clock: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
  pin: svg('<path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>'),
  ticket: svg('<path d="M3 7h18v3a2 2 0 0 0 0 4v3H3v-3a2 2 0 0 0 0-4z"/><path d="M14 7v10" stroke-dasharray="2 2.5"/>'),
  calendar: svg('<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>'),
  share: svg('<path d="M12 3v12M7 8l5-5 5 5"/><path d="M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"/>'),
  close: svg('<path d="M6 6l12 12M18 6 6 18"/>'),
  check: svg('<path d="m5 12 5 5 9-10"/>'),
};

/* ---------- Dates, always in London time ---------- */

const keyFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
const timeFmt = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
const chipFmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', weekday: 'short', day: 'numeric' });
const longFmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' });

const dayKey = (ms) => keyFmt.format(new Date(ms));          // "2026-10-12"
const fmtTime = (ms) => timeFmt.format(new Date(ms));        // "18:30"
const keyDate = (key) => new Date(`${key}T12:00:00Z`);
const addDays = (key, n) => {
  const d = keyDate(key);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

function dayName(key, today) {
  if (key === today) return 'Today';
  if (key === addDays(today, 1)) return 'Tomorrow';
  return chipFmt.format(keyDate(key));                        // "Mon 12"
}

function longDay(key, today) {
  const full = longFmt.format(keyDate(key));                  // "Monday 12 October"
  if (key === today) return `Today · ${full}`;
  if (key === addDays(today, 1)) return `Tomorrow · ${full}`;
  return full;
}

function startsIn(ms) {
  const mins = Math.max(1, Math.round(ms / 60_000));
  if (mins < 60) return `Starts in ${mins} min`;
  const h = Math.floor(mins / 60), m = mins % 60;
  return `Starts in ${h} h${m ? ` ${m} min` : ''}`;
}

function whenText(e, today) {
  const day = longDay(e.day, today);
  if (e.allDay) return `${day} · time to be confirmed`;
  return `${day} · ${fmtTime(e.t0)}${e.hasEnd ? `–${fmtTime(e.t1)}` : ''}`;
}

function updatedText(date) {
  if (!date) return '';
  const mins = Math.round((Date.now() - date.getTime()) / 60_000);
  if (mins < 2) return 'just now';
  if (mins < 60) return `${mins} minutes ago`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`;
  return `on ${longFmt.format(keyDate(dayKey(date.getTime())))}`;
}

/* ---------- Small helpers ---------- */

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const store = {
  get(key, fallback) {
    try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode: keep it in memory */ }
  },
};

function linkify(text) {
  return esc(text)
    .replace(/https?:\/\/[^\s<]+[^\s<.,;:!?)\]'"]/g, (url) => {
      const shown = url.replace(/^https?:\/\//, '');
      return `<a href="${url}" target="_blank" rel="noopener">${shown.length > 42 ? `${shown.slice(0, 40)}…` : shown}</a>`;
    })
    .replace(/(^|[\s(])@([a-z0-9_.]{1,29}[a-z0-9_])/gi,
      (m, pre, handle) => `${pre}<a href="https://www.instagram.com/${handle}/" target="_blank" rel="noopener">@${handle}</a>`);
}

let toastTimer;
function toast(message) {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2800);
}

/* ---------- State ---------- */

const state = {
  events: [],
  byId: new Map(),
  generated: null,
  sources: [],
  loadedAt: 0,
  view: 'now',
  day: null,
  query: '',
  filters: new Set(),
  campus: '',
  category: '',
  saved: new Set(store.get('saved', [])),
  dismissed: new Set(store.get('dismissed', [])),
  sheetOverList: false,
  lastSelected: '',
};

function prepare(raw) {
  const t0 = Date.parse(raw.start);
  const hasEnd = Boolean(raw.end);
  const t1 = hasEnd ? Date.parse(raw.end) : t0 + (raw.allDay ? 24 * HOUR : DEFAULT_MINUTES * 60_000);
  return {
    ...raw,
    t0, t1, hasEnd,
    day: dayKey(t0),
    tags: raw.tags || [],
    categories: raw.categories || [],
    haystack: `${raw.title} ${raw.society} ${raw.location || ''} ${raw.campus || ''} ${raw.description || ''}`.toLowerCase(),
  };
}

const matchesFilters = (e) =>
  [...state.filters].every((f) => e.tags.includes(f)) &&
  (!state.campus || e.campus === state.campus) &&
  (!state.category || e.categories.includes(state.category));

const matchesQuery = (e) => !state.query || state.query.split(/\s+/).every((word) => e.haystack.includes(word));
const filtersActive = () => state.filters.size > 0 || Boolean(state.campus || state.category);

/* ---------- Rendering ---------- */

const $ = (id) => document.getElementById(id);

function render() {
  const now = Date.now();
  renderDays(now);
  renderList(now);
  renderFooter();
}

function renderDays(now) {
  const today = dayKey(now);
  const counts = new Map();
  let onNow = 0;
  for (const e of state.events) {
    if (e.t1 <= now || !matchesFilters(e)) continue;
    counts.set(e.day, (counts.get(e.day) || 0) + 1);
    if (!e.allDay && e.t0 <= now + SOON_HOURS * HOUR) onNow += 1;
  }
  const savedCount = [...state.saved].filter((id) => state.byId.get(id)?.t1 > now).length;

  const chip = (href, label, sub, selected, extraClass = '', dot = false) =>
    `<a class="day ${extraClass}" role="tab" href="${href}" aria-selected="${selected}">` +
    `<b>${dot ? '<span class="live-dot"></span>' : ''}${label}</b><small>${sub}</small></a>`;

  const chips = [chip('#/now', 'Now', onNow ? `${onNow} on or soon` : 'quiet', state.view === 'now', '', onNow > 0)];
  for (let i = 0; i < DAYS_SHOWN; i++) {
    const key = addDays(today, i);
    const n = counts.get(key) || 0;
    chips.push(chip(`#/day/${key}`, dayName(key, today), n ? `${n} event${n === 1 ? '' : 's'}` : 'none',
      state.view === 'day' && state.day === key, n ? '' : 'empty'));
  }
  chips.push(chip('#/saved', '♥ Saved', String(savedCount), state.view === 'saved'));
  $('days').innerHTML = chips.join('');

  const selected = state.view === 'day' ? `day:${state.day}` : state.view;
  if (selected !== state.lastSelected) {
    state.lastSelected = selected;
    $('days').querySelector('[aria-selected="true"]')?.scrollIntoView({ inline: 'nearest', block: 'nearest' });
  }
}

function buildFilters() {
  const campuses = [...new Set(state.events.map((e) => e.campus).filter(Boolean))].sort();
  const catCount = new Map();
  for (const e of state.events) for (const c of e.categories) catCount.set(c, (catCount.get(c) || 0) + 1);
  const categories = [...catCount.keys()].sort((a, b) => a.localeCompare(b));
  if (!campuses.includes(state.campus)) state.campus = '';
  if (!catCount.has(state.category)) state.category = '';

  $('filters').innerHTML =
    FILTERS.map((f) => `<button class="chip" type="button" data-filter="${f.id}" aria-pressed="false">${f.label}</button>`).join('') +
    `<select class="chip" data-select="campus" aria-label="Campus"><option value="">Any campus</option>` +
    campuses.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('') + '</select>' +
    `<select class="chip" data-select="category" aria-label="Category"><option value="">All categories</option>` +
    categories.map((c) => `<option value="${esc(c)}">${esc(c)} (${catCount.get(c)})</option>`).join('') + '</select>' +
    `<button class="chip clear" type="button" data-clear hidden>Clear</button>`;
  syncFilters();
}

function syncFilters() {
  for (const b of $('filters').querySelectorAll('[data-filter]')) {
    const on = state.filters.has(b.dataset.filter);
    b.setAttribute('aria-pressed', on);
    b.innerHTML = `${on ? ICON.check : ''}${FILTERS.find((f) => f.id === b.dataset.filter).label}`;
  }
  for (const s of $('filters').querySelectorAll('[data-select]')) {
    s.value = state[s.dataset.select];
    s.classList.toggle('set', Boolean(s.value));
  }
  $('filters').querySelector('[data-clear]').hidden = !filtersActive();
}

function card(e, now) {
  const saved = state.saved.has(e.id);
  let status = '';
  if (!e.allDay && e.t0 <= now && now < e.t1) {
    status = `<p class="status"><span class="now"><i></i>On now${e.hasEnd ? ` · until ${fmtTime(e.t1)}` : ''}</span></p>`;
  } else if (!e.allDay && e.t0 > now && e.t0 - now <= SOON_HOURS * HOUR) {
    status = `<p class="status"><span class="soon">${startsIn(e.t0 - now)}</span></p>`;
  }
  const when = e.allDay ? '<b>TBC</b>' : `<b>${fmtTime(e.t0)}</b>${e.hasEnd ? `<span>${fmtTime(e.t1)}</span>` : ''}`;
  const place = e.location || (e.campus && (e.campus === 'Online' ? 'Online' : `${e.campus} campus`));
  const meta = [e.society, place].filter(Boolean).map(esc).join(' · ');
  const tags = CARD_TAGS.filter((t) => e.tags.includes(t)).slice(0, 4);
  return `<article class="card">
    <div class="when">${when}</div>
    <div class="what">${status}
      <h3><a href="#/e/${encodeURIComponent(e.id)}">${esc(e.title)}</a></h3>
      <p class="meta">${meta}</p>
      ${tags.length ? `<ul class="tags">${tags.map((t) => `<li class="tag ${t}">${TAG_LABELS[t]}</li>`).join('')}</ul>` : ''}
    </div>
    <button class="save" type="button" data-save="${esc(e.id)}" aria-pressed="${saved}" aria-label="Save ${esc(e.title)}">${ICON.heart}</button>
  </article>`;
}

function group(title, events, now) {
  if (!events.length) return '';
  return `<section class="group"><h2>${esc(title)} <span class="count">· ${events.length}</span></h2>` +
    `<div class="cards">${events.map((e) => card(e, now)).join('')}</div></section>`;
}

function byDay(events, now, today) {
  const days = new Map();
  for (const e of events) {
    if (!days.has(e.day)) days.set(e.day, []);
    days.get(e.day).push(e);
  }
  return [...days].map(([key, evs]) => group(longDay(key, today), evs, now)).join('');
}

function emptyState(title, text, extra = '') {
  const clear = filtersActive() ? '<button class="btn" type="button" data-clear>Clear filters</button>' : '';
  return `<div class="empty-state"><h2>${esc(title)}</h2><p>${text}</p>${clear}${extra}</div>`;
}

function nowView(now, today) {
  const live = [], soon = [], later = [];
  for (const e of state.events) {
    if (e.t1 <= now || !matchesFilters(e)) continue;
    if (e.allDay) { if (e.day === today) later.push(e); continue; }
    if (e.t0 <= now) live.push(e);
    else if (e.t0 <= now + SOON_HOURS * HOUR) soon.push(e);
    else if (e.day === today) later.push(e);
  }
  const html = group('Happening now', live, now) +
    group(`Starting in the next ${SOON_HOURS} hours`, soon, now) +
    group('Later today', later, now);
  if (html) return html;

  const next = state.events.filter((e) => e.t0 > now && !e.allDay && matchesFilters(e)).slice(0, 6);
  return emptyState('Nothing on right now',
    next.length ? 'Here’s what’s coming up next.' : 'Nothing else is listed yet. Check back soon.') + byDay(next, now, today);
}

function dayView(key, now, today) {
  const all = state.events.filter((e) => e.day === key && matchesFilters(e));
  const upcoming = all.filter((e) => e.t1 > now);
  const finished = all.length - upcoming.length;
  const heading = longDay(key, today);
  if (!upcoming.length) {
    const why = finished
      ? `All ${finished} of the events listed for ${key === today ? 'today' : 'this day'} have finished.`
      : 'Nothing listed for this day yet. Societies often post events only a few days ahead, so check back.';
    return `<section class="group"><h2>${esc(heading)}</h2></section>` + emptyState('No events', why);
  }
  const timed = upcoming.filter((e) => !e.allDay);
  const tbc = upcoming.filter((e) => e.allDay);
  const done = finished ? `<p class="meta" style="margin:14px 2px 0">${finished} earlier event${finished === 1 ? ' has' : 's have'} finished.</p>` : '';
  return group(heading, timed, now) + group('Time to be confirmed', tbc, now) + done;
}

function savedView(now, today) {
  const saved = state.events.filter((e) => state.saved.has(e.id) && e.t1 > now);
  if (!saved.length) {
    return emptyState('Nothing saved yet', 'Tap the heart on any event to keep it here. Saved events stay on this device.');
  }
  return byDay(saved, now, today);
}

function searchView(now, today) {
  const hits = state.events.filter((e) => e.t1 > now && matchesFilters(e) && matchesQuery(e));
  if (!hits.length) return emptyState('No matches', `Nothing coming up matches “${esc(state.query)}”.`);
  return `<p class="meta" style="margin:16px 2px 0">${hits.length} upcoming event${hits.length === 1 ? '' : 's'} match “${esc(state.query)}”</p>` +
    byDay(hits, now, today);
}

function notices() {
  const out = [];
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  const iOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  if (iOS && !standalone && !state.dismissed.has('ios-install')) {
    out.push(['ios-install', 'Put this on your home screen: tap <b>Share</b>, then <b>Add to Home Screen</b>.']);
  }
  if (!state.dismissed.has('early')) {
    out.push(['early', 'Early version: events come from the Union website for now. Society Instagram posts are coming next.']);
  }
  return out.map(([id, text]) =>
    `<div class="notice"><p>${text}</p><button type="button" data-dismiss="${id}" aria-label="Dismiss">×</button></div>`).join('');
}

function renderList(now) {
  const today = dayKey(now);
  let html;
  if (state.query) html = searchView(now, today);
  else if (state.view === 'saved') html = savedView(now, today);
  else if (state.view === 'day') html = dayView(state.day, now, today);
  else html = nowView(now, today);
  $('list').innerHTML = (state.query ? '' : notices()) + html;
}

function renderFooter() {
  const counts = state.sources.map((s) => `${s.count} from the ${esc(s.name)}`).join(', ');
  $('foot').innerHTML =
    `<p>Updated ${updatedText(state.generated)}${counts ? ` · ${counts}` : ''}.</p>` +
    '<p>An unofficial student project, not run by Imperial College Union or Imperial College London. ' +
    'Details can change, so check the event’s source before you go.</p>';
}

/* ---------- The event sheet ---------- */

function sheetHTML(e) {
  const today = dayKey(Date.now());
  const saved = state.saved.has(e.id);
  const campusNote = e.campus && !(e.location || '').toLowerCase().includes(e.campus.toLowerCase())
    ? `<div class="sub">${esc(e.campus)}${e.campus === 'Online' ? '' : ' campus'}</div>` : '';
  const map = e.mapUrl ? ` · <a href="${esc(e.mapUrl)}" target="_blank" rel="noopener">Map</a>` : '';
  const tags = [...CARD_TAGS, 'accessible'].filter((t) => e.tags.includes(t));
  return `<button class="sheet-close" type="button" data-close aria-label="Close">${ICON.close}</button>
  <div class="sheet-scroll">
    ${e.image ? `<div class="poster"><img src="${esc(e.image)}" alt="Poster for ${esc(e.title)}" referrerpolicy="no-referrer"></div>` : ''}
    <div class="sheet-body">
      <p class="society">${esc(e.society)}</p>
      <h2 id="sheet-title" tabindex="-1">${esc(e.title)}</h2>
      <ul class="facts">
        <li>${ICON.clock}<div>${esc(whenText(e, today))}</div></li>
        <li>${ICON.pin}<div>${e.location ? esc(e.location) : 'Location not listed yet'}${map}${campusNote}</div></li>
        ${e.price ? `<li>${ICON.ticket}<div>${esc(e.price)}</div></li>` : ''}
      </ul>
      ${tags.length ? `<ul class="tags">${tags.map((t) => `<li class="tag ${t}">${TAG_LABELS[t]}</li>`).join('')}</ul>` : ''}
      ${posterNote(e)}
      <div class="actions">
        <button class="btn primary" type="button" data-save="${esc(e.id)}" aria-pressed="${saved}">${ICON.heart}<span>${saved ? 'Saved' : 'Save'}</span></button>
        <button class="btn" type="button" data-cal aria-expanded="false" aria-controls="cal-menu">${ICON.calendar}Add to calendar</button>
        <button class="btn" type="button" data-share="${esc(e.id)}">${ICON.share}Share</button>
      </div>
      <div class="cal-menu" id="cal-menu">
        <button class="btn" type="button" data-ics="${esc(e.id)}">Apple / Outlook app (.ics)</button>
        <a class="btn" href="${esc(googleCalendarUrl(e))}" target="_blank" rel="noopener">Google Calendar</a>
        <a class="btn" href="${esc(outlookUrl(e))}" target="_blank" rel="noopener">Outlook (Imperial account)</a>
      </div>
      ${e.description ? `<div class="description">${linkify(e.description)}</div>` : ''}
      <p class="source">From the <a href="${esc(e.url)}" target="_blank" rel="noopener">${esc(SOURCE_NAMES[e.source] || 'original listing')}</a>. Details can change, so check there before you go.</p>
    </div>
  </div>`;
}

// Say which details the AI read off the poster, so people know where they came from.
function posterNote(e) {
  const read = e.fromPoster || [];
  if (!read.length) return '';
  const names = { start: 'time', end: 'time', location: 'room', price: 'price' };
  const list = [...new Set(read.map((k) => names[k]).filter(Boolean))];
  const text = list.length > 1 ? `${list.slice(0, -1).join(', ')} and ${list.at(-1)}` : list[0];
  return `<p class="poster-note">The ${text} ${list.length > 1 ? 'were' : 'was'} read from the poster by AI.</p>`;
}

function openSheet(id) {
  const e = state.byId.get(id);
  const sheet = $('sheet');
  if (!e) {
    if (sheet.open) sheet.close();
    toast('That event has finished or is no longer listed');
    location.replace(viewHash());
    return;
  }
  sheet.innerHTML = sheetHTML(e);
  if (!sheet.open) sheet.showModal();
  sheet.querySelector('.sheet-scroll').scrollTop = 0;
  sheet.querySelector('#sheet-title').focus({ preventScroll: true });
}

/* ---------- Calendar export ---------- */

const utcStamp = (ms) => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const compactDay = (key) => key.replace(/-/g, '');
const calendarNotes = (e) => `${e.society}\n\n${(e.description || '').slice(0, 900)}\n\n${e.url}`;

function googleCalendarUrl(e) {
  const dates = e.allDay ? `${compactDay(e.day)}/${compactDay(addDays(e.day, 1))}` : `${utcStamp(e.t0)}/${utcStamp(e.t1)}`;
  const params = new URLSearchParams({ action: 'TEMPLATE', text: e.title, dates, details: calendarNotes(e), location: e.location || '', ctz: TZ });
  return `https://calendar.google.com/calendar/render?${params}`;
}

function outlookUrl(e) {
  const params = new URLSearchParams({
    path: '/calendar/action/compose', rru: 'addevent', subject: e.title,
    startdt: e.allDay ? e.day : new Date(e.t0).toISOString(),
    enddt: e.allDay ? addDays(e.day, 1) : new Date(e.t1).toISOString(),
    body: calendarNotes(e), location: e.location || '',
  });
  if (e.allDay) params.set('allday', 'true');
  return `https://outlook.office.com/calendar/deeplink/compose?${params}`;
}

function icsText(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

function foldLine(line) {
  // iCalendar lines must be at most 75 bytes; continuation lines start with a space.
  const enc = new TextEncoder();
  const out = [];
  let current = '', bytes = 0;
  for (const ch of line) {
    const size = enc.encode(ch).length;
    if (bytes + size > (out.length ? 74 : 75)) {
      out.push(current);
      current = '';
      bytes = 0;
    }
    current += ch;
    bytes += size;
  }
  out.push(current);
  return out.join('\r\n ');
}

function icsFile(e) {
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//After Lectures//Imperial events//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'BEGIN:VEVENT', `UID:${e.id}@afterlectures`, `DTSTAMP:${utcStamp(Date.now())}`,
    ...(e.allDay
      ? [`DTSTART;VALUE=DATE:${compactDay(e.day)}`, `DTEND;VALUE=DATE:${compactDay(addDays(e.day, 1))}`]
      : [`DTSTART:${utcStamp(e.t0)}`, `DTEND:${utcStamp(e.t1)}`]),
    `SUMMARY:${icsText(e.title)}`,
    ...(e.location ? [`LOCATION:${icsText(e.location)}`] : []),
    `DESCRIPTION:${icsText(calendarNotes(e))}`,
    `URL:${e.url}`,
    'END:VEVENT', 'END:VCALENDAR',
  ];
  return lines.map(foldLine).join('\r\n') + '\r\n';
}

function downloadIcs(e) {
  const blob = new Blob([icsFile(e)], { type: 'text/calendar;charset=utf-8' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `${e.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'event'}.ics`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 5000);
}

/* ---------- Actions ---------- */

function toggleSave(id) {
  const on = !state.saved.has(id);
  if (on) state.saved.add(id); else state.saved.delete(id);
  store.set('saved', [...state.saved]);
  for (const b of document.querySelectorAll(`[data-save="${CSS.escape(id)}"]`)) {
    b.setAttribute('aria-pressed', on);
    const label = b.querySelector('span');
    if (label) label.textContent = on ? 'Saved' : 'Save';
  }
  const now = Date.now();
  renderDays(now);
  if (state.view === 'saved' && !state.query) renderList(now);
  toast(on ? 'Saved. Add it to your calendar to get a reminder.' : 'Removed from saved');
}

async function share(e) {
  const url = `${location.origin}${location.pathname}#/e/${encodeURIComponent(e.id)}`;
  const text = `${e.title} · ${whenText(e, dayKey(Date.now()))}`;
  if (navigator.share) {
    try { await navigator.share({ title: e.title, text, url }); } catch { /* closed the share menu */ }
    return;
  }
  try {
    await navigator.clipboard.writeText(`${text}\n${url}`);
    toast('Link copied');
  } catch {
    toast('Copy the link from the address bar');
  }
}

function viewHash() {
  if (state.view === 'day') return `#/day/${state.day}`;
  return state.view === 'saved' ? '#/saved' : '#/now';
}

function route() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  if (parts[0] === 'e' && parts[1]) {
    if (!state.events.length) return;
    if (!$('list').dataset.rendered) render();
    openSheet(decodeURIComponent(parts.slice(1).join('/')));
    return;
  }
  if (parts[0] === 'day' && /^\d{4}-\d{2}-\d{2}$/.test(parts[1] || '')) {
    state.view = 'day';
    state.day = parts[1];
  } else if (parts[0] === 'saved') {
    state.view = 'saved';
  } else {
    state.view = 'now';
    if (parts[0] !== 'now') history.replaceState(null, '', '#/now');
  }
  state.sheetOverList = true;
  if ($('sheet').open) $('sheet').close();
  render();
  $('list').dataset.rendered = '1';
}

document.addEventListener('click', (ev) => {
  const el = ev.target.closest('[data-save],[data-filter],[data-clear],[data-close],[data-cal],[data-ics],[data-share],[data-dismiss],[data-retry]');
  if (!el) return;
  const d = el.dataset;
  if (d.save !== undefined) toggleSave(d.save);
  else if (d.filter) {
    if (state.filters.has(d.filter)) state.filters.delete(d.filter); else state.filters.add(d.filter);
    syncFilters();
    render();
  } else if (d.clear !== undefined) {
    state.filters.clear();
    state.campus = state.category = '';
    syncFilters();
    render();
  } else if (d.close !== undefined) $('sheet').close();
  else if (d.cal !== undefined) {
    const menu = document.getElementById('cal-menu');
    menu.classList.toggle('open');
    el.setAttribute('aria-expanded', menu.classList.contains('open'));
  } else if (d.ics) downloadIcs(state.byId.get(d.ics));
  else if (d.share) share(state.byId.get(d.share));
  else if (d.dismiss) {
    state.dismissed.add(d.dismiss);
    store.set('dismissed', [...state.dismissed]);
    el.closest('.notice').remove();
  } else if (d.retry !== undefined) load();
});

document.addEventListener('change', (ev) => {
  const select = ev.target.closest('[data-select]');
  if (!select) return;
  state[select.dataset.select] = select.value;
  syncFilters();
  render();
});

let searchTimer;
$('q').addEventListener('input', (ev) => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    state.query = ev.target.value.trim().toLowerCase();
    renderList(Date.now());
  }, 120);
});

const sheet = $('sheet');
sheet.addEventListener('click', (ev) => { if (ev.target === sheet) sheet.close(); });   // tap outside
sheet.addEventListener('close', () => {
  if (!location.hash.startsWith('#/e/')) return;
  if (state.sheetOverList) history.back(); else location.replace(viewHash());
});

window.addEventListener('hashchange', route);

/* ---------- Install as an app ---------- */

let installPrompt = null;
window.addEventListener('beforeinstallprompt', (ev) => {
  ev.preventDefault();
  installPrompt = ev;
  $('install').hidden = false;
});
$('install').addEventListener('click', async () => {
  if (!installPrompt) return;
  installPrompt.prompt();
  await installPrompt.userChoice;
  installPrompt = null;
  $('install').hidden = true;
});
window.addEventListener('appinstalled', () => { $('install').hidden = true; });

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js').catch(() => { /* still works without offline support */ });
}

/* ---------- Loading ---------- */

async function load() {
  try {
    const res = await fetch(DATA_URL, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    state.events = data.events.map(prepare).sort((a, b) => a.t0 - b.t0 || a.title.localeCompare(b.title));
    state.byId = new Map(state.events.map((e) => [e.id, e]));
    state.generated = data.generated ? new Date(data.generated) : null;
    state.sources = data.sources || [];
    state.loadedAt = Date.now();
    state.sheetOverList = !location.hash.startsWith('#/e/');
    buildFilters();
    route();
  } catch (err) {
    console.error('Could not load events', err);
    $('list').innerHTML = emptyState('Couldn’t load events', 'Check your connection and try again.',
      '<button class="btn" type="button" data-retry>Try again</button>');
  }
}

// Keep "on now" and "starts in" labels fresh, and pick up new data after a while away.
setInterval(() => {
  if (document.visibilityState === 'visible' && state.events.length) {
    const now = Date.now();
    renderDays(now);
    renderList(now);
  }
}, 60_000);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible' || !state.events.length) return;
  if (Date.now() - state.loadedAt > REFRESH_AFTER) load(); else render();
});

load();
