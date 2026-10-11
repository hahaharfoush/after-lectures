// CORS, JSON replies, database access and daily limits shared by the functions.

const ALLOWED_ORIGINS = [
  'https://hahaharfoush.github.io',
  'http://localhost:8765',
  'http://127.0.0.1:8765',
];

export function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('origin') ?? '';
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
}

export function json(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), 'content-type': 'application/json' },
  });
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

// Running locally without a database: no limits, nothing stored.
export const devMode = !SUPABASE_URL || !SERVICE_KEY;

export function rest(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'content-type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
}

// A salted hash of the caller's IP, so limits are per person without storing IPs.
export async function callerId(req: Request): Promise<string> {
  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'unknown';
  const salt = Deno.env.get('IP_SALT') ?? 'after-lectures';
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${salt}:${ip}`));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
}

const LIMITS = {
  read: { perPerson: 25, everyone: 400 },   // screenshots read per 24 hours (Gemini free quota)
  add: { perPerson: 10, everyone: 150 },    // events added per 24 hours
};

// Returns a message if the 24-hour limit is reached; otherwise records this use.
export async function useAllowance(kind: 'read' | 'add', who: string): Promise<string | null> {
  if (devMode) return null;
  const since = encodeURIComponent(new Date(Date.now() - 24 * 3600e3).toISOString());
  const count = async (filter: string) => {
    const res = await rest(`usage?select=id&kind=eq.${kind}&created_at=gte.${since}${filter}`, {
      headers: { Prefer: 'count=exact', Range: '0-0' },
    });
    return Number((res.headers.get('content-range') ?? '*/0').split('/')[1]) || 0;
  };
  const [mine, everyone] = await Promise.all([count(`&ip_hash=eq.${who}`), count('')]);
  if (mine >= LIMITS[kind].perPerson) return 'You’ve reached today’s limit. Please try again tomorrow.';
  if (everyone >= LIMITS[kind].everyone) return 'We’ve reached today’s limit for everyone. Please try again tomorrow.';
  await rest('usage', { method: 'POST', body: JSON.stringify({ kind, ip_hash: who }) });
  return null;
}
