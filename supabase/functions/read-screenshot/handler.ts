// POST a screenshot (form field "image", optional "taken" date) and get back
// the events the AI read from it, for the person to check before adding.
import { callerId, corsHeaders, json, useAllowance } from '../_shared/http.ts';
import { readEvents } from '../_shared/gemini.ts';

const MAX_BYTES = 8 * 1024 * 1024;
const TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];

export async function handle(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders(req) });
  if (req.method !== 'POST') return json(req, { error: 'Use POST' }, 405);

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return json(req, { error: 'Send the screenshot as form data' }, 400);
  }
  const file = form.get('image');
  if (!(file instanceof File)) return json(req, { error: 'No screenshot attached' }, 400);
  if (!TYPES.includes(file.type)) return json(req, { error: 'That file isn’t an image we can read' }, 415);
  if (file.size > MAX_BYTES) return json(req, { error: 'That image is too big (8 MB max)' }, 413);
  const taken = String(form.get('taken') ?? '');
  const takenOn = /^\d{4}-\d{2}-\d{2}$/.test(taken) ? taken : new Date().toISOString().slice(0, 10);

  const limited = await useAllowance('read', await callerId(req));
  if (limited) return json(req, { error: limited }, 429);

  try {
    return json(req, await readEvents(new Uint8Array(await file.arrayBuffer()), file.type, takenOn));
  } catch (err) {
    console.error('read failed:', err);
    return json(req, { error: 'The AI couldn’t read that just now. Try again, or fill it in yourself.' }, 502);
  }
}
