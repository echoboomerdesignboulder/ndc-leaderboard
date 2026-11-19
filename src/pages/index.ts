import type { APIRoute } from 'astro';
export const prerender = false;
export const GET: APIRoute = () => new Response(JSON.stringify({ ok: true, app: 'ndc-leaderboard' }), { headers: { 'Content-Type': 'application/json' } });
