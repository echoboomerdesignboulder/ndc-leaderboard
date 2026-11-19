import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { startRun } from '../../lib/board.ts';
import { clientIp, json, preflight } from '../../lib/http.ts';

export const prerender = false;

export const OPTIONS: APIRoute = ({ request }) => preflight(request);

/* GET -> { runToken }: a signed start timestamp, good for one score. */
export const GET: APIRoute = async ({ request }) => {
  try {
    const res = await startRun(env.DB, clientIp(request), Date.now());
    if (!res.ok) return json(request, res.status, { error: res.error });
    return json(request, 200, res.value);
  } catch (e) {
    return json(request, 500, { error: 'server' });
  }
};
