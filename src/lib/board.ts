/* NDC leaderboard rules. Everything here runs on the server; the page is never trusted.
   `db` is a D1 database (or anything with the same prepare/bind/first/all/run shape). */
import { RegExpMatcher, englishDataset, englishRecommendedTransformers } from 'obscenity';

export const NAME_MAX = 16;
export const MS_MIN = 12000;
export const MS_MAX = 600000;
export const SLACK_MS = 2000;
export const TOKEN_TTL_MS = 30 * 60 * 1000;
export const RATE_WINDOW_MS = 10 * 60 * 1000;
export const POSTS_PER_WINDOW = 5;
export const STARTS_PER_WINDOW = 60;

const NAME_RE = /^[A-Za-z0-9 .'&-]+$/;
const profanity = new RegExpMatcher({ ...englishDataset.build(), ...englishRecommendedTransformers });

export type Row = { id: string; name: string; ms: number };
export type Result<T> = { ok: true; value: T } | { ok: false; status: number; error: string };
const fail = (status: number, error: string) => ({ ok: false as const, status, error });

type DB = any;

const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const enc = new TextEncoder();

async function secret(db: DB): Promise<string> {
  const row = await db.prepare('SELECT v FROM config WHERE k = ?').bind('secret').first();
  if (row && row.v) return row.v as string;
  const fresh = hex(crypto.getRandomValues(new Uint8Array(32)).buffer);
  await db.prepare('INSERT OR IGNORE INTO config (k, v) VALUES (?, ?)').bind('secret', fresh).run();
  const again = await db.prepare('SELECT v FROM config WHERE k = ?').bind('secret').first();
  return again.v as string;
}

async function sign(key: string, msg: string): Promise<string> {
  const k = await crypto.subtle.importKey('raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', k, enc.encode(msg)));
}

function same(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

/* Callers are counted by a keyed hash of their address, so no raw IPs are stored. */
async function whoKey(db: DB, ip: string): Promise<string> {
  return (await sign(await secret(db), 'ip:' + ip)).slice(0, 32);
}

async function overLimit(db: DB, kind: string, who: string, limit: number, now: number): Promise<boolean> {
  const row = await db.prepare('SELECT COUNT(*) AS n FROM hits WHERE kind = ? AND who = ? AND ts > ?').bind(kind, who, now - RATE_WINDOW_MS).first();
  return ((row && row.n) || 0) >= limit;
}

/* A run token is a signed start timestamp: "<issuedAt>.<nonce>.<hmac>". */
async function readToken(db: DB, token: unknown, now: number): Promise<{ nonce: string; issuedAt: number } | null> {
  if (typeof token !== 'string' || token.length > 200) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [ts, nonce, sig] = parts;
  if (!/^\d{10,16}$/.test(ts) || !/^[0-9a-f]{32}$/.test(nonce) || !/^[0-9a-f]{64}$/.test(sig)) return null;
  if (!same(sig, await sign(await secret(db), ts + '.' + nonce))) return null;
  const issuedAt = Number(ts);
  if (issuedAt > now + 5000 || now - issuedAt > TOKEN_TTL_MS) return null;
  return { nonce, issuedAt };
}

export async function top10(db: DB): Promise<Row[]> {
  const { results } = await db.prepare('SELECT id, name, ms FROM scores ORDER BY ms ASC, created_at ASC, id ASC LIMIT 10').all();
  return (results || []).map((r: any) => ({ id: String(r.id), name: String(r.name), ms: Number(r.ms) }));
}

export async function startRun(db: DB, ip: string, now: number): Promise<Result<{ runToken: string }>> {
  const who = await whoKey(db, ip);
  if (await overLimit(db, 'start', who, STARTS_PER_WINDOW, now)) return fail(429, 'rate');
  const nonce = hex(crypto.getRandomValues(new Uint8Array(16)).buffer);
  const sig = await sign(await secret(db), now + '.' + nonce);
  await db.prepare('INSERT INTO runs (nonce, issued_at) VALUES (?, ?)').bind(nonce, now).run();
  await db.prepare('INSERT INTO hits (kind, who, ts) VALUES (?, ?, ?)').bind('start', who, now).run();
  /* housekeeping: old tokens and old rate-limit rows are no use to anyone */
  await db.prepare('DELETE FROM runs WHERE issued_at < ?').bind(now - 2 * TOKEN_TTL_MS).run();
  await db.prepare('DELETE FROM hits WHERE ts < ?').bind(now - 2 * RATE_WINDOW_MS).run();
  return { ok: true, value: { runToken: now + '.' + nonce + '.' + sig } };
}

/* The page asks for the top 10 when the finish panel opens and sends its run token along.
   That request is the server's own record of when the run ended, so time spent typing a name
   is not counted against the player. First stamp wins. */
export async function stampFinish(db: DB, token: unknown, now: number): Promise<void> {
  const t = await readToken(db, token, now);
  if (!t) return;
  await db.prepare('UPDATE runs SET finished_at = ? WHERE nonce = ? AND finished_at IS NULL AND used = 0').bind(now, t.nonce).run();
}

export function checkName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const name = raw.trim();
  if (name.length < 1 || name.length > NAME_MAX) return null;
  if (!NAME_RE.test(name)) return null;
  if (profanity.hasMatch(name)) return null;
  return name;
}

export async function postScore(db: DB, body: any, ip: string, now: number): Promise<Result<{ id: string; top: Row[] }>> {
  if (!body || typeof body !== 'object') return fail(400, 'body');
  const who = await whoKey(db, ip);
  if (await overLimit(db, 'post', who, POSTS_PER_WINDOW, now)) return fail(429, 'rate');
  await db.prepare('INSERT INTO hits (kind, who, ts) VALUES (?, ?, ?)').bind('post', who, now).run();

  const name = checkName(body.name);
  if (!name) return fail(422, 'name');
  const ms = body.ms;
  if (typeof ms !== 'number' || !Number.isInteger(ms) || ms < MS_MIN || ms > MS_MAX) return fail(422, 'ms');

  const t = await readToken(db, body.runToken, now);
  if (!t) return fail(403, 'token');
  const run = await db.prepare('SELECT issued_at, finished_at, used FROM runs WHERE nonce = ?').bind(t.nonce).first();
  if (!run || run.used) return fail(403, 'token');
  /* Real time between the token being issued and the run ending (or now, if the finish was never stamped). */
  const elapsed = (run.finished_at == null ? now : Number(run.finished_at)) - Number(run.issued_at);
  if (ms < elapsed - SLACK_MS) return fail(403, 'time');   /* claims a faster run than the clock allows */
  if (ms > elapsed + SLACK_MS) return fail(403, 'time');   /* claims a run longer than the time that has passed */

  /* single use: only one request can flip the flag */
  const used = await db.prepare('UPDATE runs SET used = 1 WHERE nonce = ? AND used = 0').bind(t.nonce).run();
  if (!used || !used.meta || used.meta.changes !== 1) return fail(403, 'token');

  const ins = await db.prepare('INSERT INTO scores (name, ms, created_at) VALUES (?, ?, ?)').bind(name, ms, now).run();
  return { ok: true, value: { id: String(ins.meta.last_row_id), top: await top10(db) } };
}
