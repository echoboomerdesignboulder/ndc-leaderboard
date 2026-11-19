/* Shared response helpers. The page lives on echoboomerdesign.com; the staging domain and local
   dev are allowed too so the leaderboard can be tested before a production publish. */
const ALLOWED = [
  'https://www.echoboomerdesign.com',
  'https://echoboomerdesign.com',
  'https://echo-boomer-design.webflow.io',
];

export function cors(request: Request): Record<string, string> {
  const origin = request.headers.get('origin') || '';
  const ok = ALLOWED.includes(origin) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  const h: Record<string, string> = { Vary: 'Origin' };
  if (ok) {
    h['Access-Control-Allow-Origin'] = origin;
    h['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS';
    h['Access-Control-Allow-Headers'] = 'Content-Type, X-Run-Token';
    h['Access-Control-Max-Age'] = '600';
  }
  return h;
}

export function json(request: Request, status: number, data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...cors(request) },
  });
}

export function preflight(request: Request): Response {
  return new Response(null, { status: 204, headers: cors(request) });
}

export function clientIp(request: Request): string {
  const h = request.headers;
  return h.get('cf-connecting-ip') || (h.get('x-forwarded-for') || '').split(',')[0].trim() || 'unknown';
}
