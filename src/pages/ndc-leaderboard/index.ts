import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { postScore, stampFinish, top10 } from '../../lib/board.ts';
import { clientIp, json, preflight } from '../../lib/http.ts';

export const prerender = false;

export const OPTIONS: APIRoute = ({ request }) => preflight(request);

/* GET -> top 10 [{ name, ms }], fastest first. */
export const GET: APIRoute = async ({ request }) => {
  try {
    const token = request.headers.get('x-run-token');
    if (token) await stampFinish(env.DB, token, Date.now());
    const rows = await top10(env.DB);
    return json(request, 200, rows.map((r) => ({ name: r.name, ms: r.ms })));
  } catch (e) {
    return json(request, 500, { error: 'server' });
  }
};

/* POST { name, ms, runToken } -> { id, top } */
export const POST: APIRoute = async ({ request }) => {
  try {
    if (!(request.headers.get('content-type') || '').toLowerCase().startsWith('application/json')) return json(request, 415, { error: 'type' });
    const text = await request.text();
    if (text.length > 1000) return json(request, 413, { error: 'size' });
    let body: unknown = null;
    try { body = JSON.parse(text); } catch (e) { return json(request, 400, { error: 'body' }); }
    const res = await postScore(env.DB, body, clientIp(request), Date.now());
    if (!res.ok) return json(request, res.status, { error: res.error });
    return json(request, 200, res.value);
  } catch (e) {
    return json(request, 500, { error: 'server' });
  }
};
