# ndc-leaderboard

Shared leaderboard for the footer race game on the Neighbors Distance Club preview page
(echoboomerdesign.com/lab/ndc). A small Astro app for Webflow Cloud with a SQLite (D1) database.

## Endpoints

With the app mounted at `/api`:

- `GET /api/ndc-leaderboard` returns the top 10 as `[{ name, ms }]`, fastest first.
  If the request carries an `X-Run-Token` header, the server records that moment as the end of that run.
- `GET /api/ndc-leaderboard/start` returns `{ runToken }`, a signed start timestamp good for one score.
- `POST /api/ndc-leaderboard` with `{ name, ms, runToken }` returns `{ id, top }`.

## Rules enforced on the server

- Name: trimmed, 1 to 16 characters, letters, numbers, space and `.'&-` only, then a profanity filter (`obscenity`).
- Time: `ms` is a whole number from 20000 to 600000.
- Anti-cheat: the score is rejected if `ms` is more than 2 seconds shorter, or more than 2 seconds longer,
  than the real time between the token being issued and the run ending. Each token works once.
- Rate limit: 5 posts per caller per 10 minutes (60 token requests). Callers are counted by a keyed hash; raw IPs are not stored.
- Tokens are signed with a secret the app generates on first use and keeps in its own database, so no environment variable is needed.

Errors: `422 { error: "name" | "ms" }`, `403 { error: "token" | "time" }`, `429 { error: "rate" }`.

## Deploy (Webflow Cloud)

1. In the Webflow workspace, create a Cloud app from this repo, target the existing Echo Boomer Design site, mount path `/api`, branch `main`.
2. Publish the Webflow site so the mount path is routed.
3. Check `https://www.echoboomerdesign.com/api/ndc-leaderboard` returns `[]`.
4. Turn the leaderboard on in the page by setting `window.NDC_LEADERBOARD_ON = true` before the page script loads.

The database migration in `migrations/` is applied on deploy.

## Local

```
npm install
npm run db:setup
PUBLIC_BASE_PATH=/api npm run dev
```
