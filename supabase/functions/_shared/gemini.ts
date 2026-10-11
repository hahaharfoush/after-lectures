// Ask Gemini to read events out of a screenshot. The instructions, answer
// format and model order are in extract.json, shared with pipeline/extract.py.
import config from './extract.json' with { type: 'json' };
import { encodeBase64 } from 'jsr:@std/encoding@1/base64';

const API = 'https://generativelanguage.googleapis.com/v1beta/models';

export interface ReadResult {
  model: string;
  events: Record<string, unknown>[];
}

export async function readEvents(image: Uint8Array, mime: string, takenOn: string): Promise<ReadResult> {
  const key = Deno.env.get('GEMINI_API_KEY');
  if (!key) throw new Error('GEMINI_API_KEY is not set');

  const taken = new Intl.DateTimeFormat('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
  }).format(new Date(`${takenOn}T12:00:00Z`));
  const prompt = config.prompt.replaceAll('{taken}', taken).replaceAll('{taken_iso}', takenOn);
  const body = JSON.stringify({
    contents: [{ role: 'user', parts: [{ text: prompt }, { inline_data: { mime_type: mime, data: encodeBase64(image) } }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: config.schema,
      thinkingConfig: { thinkingLevel: config.thinkingLevel },
    },
  });

  const errors: string[] = [];
  for (const model of config.models) {
    for (let attempt = 0; attempt < 2; attempt++) {
      let res: Response;
      try {
        res = await fetch(`${API}/${model}:generateContent`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
          body,
          signal: AbortSignal.timeout(45_000),
        });
      } catch (err) {
        errors.push(`${model}: ${err}`);
        continue;
      }
      if (res.ok) {
        const data = await res.json();
        const parts: { text?: string; thought?: boolean }[] = data.candidates?.[0]?.content?.parts ?? [];
        const text = parts.filter((p) => !p.thought).map((p) => p.text ?? '').join('');
        try {
          return { model, events: JSON.parse(text).events ?? [] };
        } catch {
          errors.push(`${model}: unreadable answer`);
          break;
        }
      }
      const message = (await res.text()).slice(0, 300);
      errors.push(`${model}: HTTP ${res.status} ${message}`);
      if (res.status === 429 && /limit: 0|free_tier/i.test(message)) break;   // no free quota: next model
      if ([429, 500, 503].includes(res.status)) {
        await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
        continue;
      }
      break;
    }
  }
  throw new Error(errors.slice(-3).join(' | '));
}
