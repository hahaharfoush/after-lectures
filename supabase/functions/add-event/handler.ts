// POST an event the person has checked; it's validated and saved as live.
// Send {"dryRun": true} to validate without saving (used by the tests).
import { callerId, corsHeaders, devMode, json, rest, useAllowance } from '../_shared/http.ts';
import { campusFor } from '../_shared/campus.ts';

const TAGS = new Set(['free', 'open', 'food', 'beginner', 'members', 'signup', 'dropin', 'alcoholfree']);
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

const oneLine = (v: unknown, max: number) =>
  typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '';
const text = (v: unknown, max: number) =>
  typeof v === 'string' ? v.replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim().slice(0, max) : '';

const addDays = (day: string, n: number) => {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

// "2026-10-13" + "18:00" -> "2026-10-13T18:00:00+01:00", using London's offset that day.
function londonTime(day: string, time: string): string {
  const probe = new Date(`${day}T${time}:00Z`);
  const name = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', timeZoneName: 'shortOffset' })
    .formatToParts(probe).find((p) => p.type === 'timeZoneName')?.value ?? 'GMT';
  const hours = Number(name.replace('GMT', '') || 0);
  return `${day}T${time}:00${hours < 0 ? '-' : '+'}${String(Math.abs(hours)).padStart(2, '0')}:00`;
}

export async function handle(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders(req) });
  if (req.method !== 'POST') return json(req, { error: 'Use POST' }, 405);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json(req, { error: 'Send the event as JSON' }, 400);
  }

  const title = oneLine(body.title, 140);
  if (title.length < 3) return json(req, { error: 'Give the event a name' }, 400);
  const day = oneLine(body.date, 10);
  const today = new Date().toISOString().slice(0, 10);
  if (!DAY.test(day) || day < addDays(today, -1) || day > addDays(today, 180)) {
    return json(req, { error: 'Pick the date the event is on' }, 400);
  }
  const start = oneLine(body.start_time, 5);
  const end = oneLine(body.end_time, 5);
  if ((start && !TIME.test(start)) || (end && !TIME.test(end))) return json(req, { error: 'Times should look like 18:30' }, 400);
  const sourceUrl = oneLine(body.source_url, 300);
  if (sourceUrl && !/^https:\/\/\S+$/.test(sourceUrl)) return json(req, { error: 'The link should start with https://' }, 400);

  const location = oneLine(body.location, 120);
  const row = {
    title,
    society: oneLine(body.society, 80) || null,
    starts_at: londonTime(day, start || '00:00'),
    ends_at: start && end ? londonTime(end > start ? day : addDays(day, 1), end) : null,
    all_day: !start,
    location: location || null,
    campus: campusFor(location, title),
    price: oneLine(body.price, 60) || null,
    tags: Array.isArray(body.tags) ? [...new Set(body.tags.filter((t) => typeof t === 'string' && TAGS.has(t)))] : [],
    description: text(body.description, 1500) || null,
    source_url: sourceUrl || null,
    read_by: oneLine(body.read_by, 40) || null,
  };

  if (body.dryRun === true) return json(req, { submission: { ...row, id: 'dry-run' }, saved: false });

  const who = await callerId(req);
  const limited = await useAllowance('add', who);
  if (limited) return json(req, { error: limited }, 429);
  if (devMode) return json(req, { submission: { ...row, id: crypto.randomUUID() }, saved: false });

  const res = await rest('submissions', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ ...row, ip_hash: who }),
  });
  if (!res.ok) {
    console.error('insert failed:', res.status, await res.text());
    return json(req, { error: 'Couldn’t save that just now. Please try again.' }, 500);
  }
  const [saved] = await res.json();
  delete saved.ip_hash;
  return json(req, { submission: saved, saved: true });
}
