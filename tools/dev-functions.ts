// Run both server functions locally, without a database, for testing the
// "Add an event" flow:
//   GEMINI_API_KEY=... deno run --allow-net --allow-env --allow-read tools/dev-functions.ts
// The site talks to it when loaded with ?backend=http://127.0.0.1:8787
import { handle as readScreenshot } from '../supabase/functions/read-screenshot/handler.ts';
import { handle as addEvent } from '../supabase/functions/add-event/handler.ts';

Deno.serve({ port: 8787, hostname: '127.0.0.1' }, (req) => {
  const path = new URL(req.url).pathname;
  if (path.endsWith('/read-screenshot')) return readScreenshot(req);
  if (path.endsWith('/add-event')) return addEvent(req);
  return new Response('not found', { status: 404 });
});
