# KCT Backend — Render Deploy

## Quick Deploy to Render.com

1. Push to GitHub, create **New Web Service** on Render
2. Root Directory: (leave blank if this repo IS the backend; else set `backend`)
3. Build: `npm install`   |   Start: `node server.js`
4. Add environment variables (see `.env.example`) — required:
   - `KCB_CONSUMER_KEY`, `KCB_CONSUMER_SECRET`
   - `KCB_CALLBACK_URL` (your Render URL + `/callback`)
   - `ADMIN_PASSWORD` (change from default!)
   - `SESSION_SECRET` (random long string)

## Local Development

```bash
cp .env.example .env
npm install
npm start           # server runs on http://localhost:10000
npm run test-stk    # sends real KES 1 STK to 0797977136 (verify KCB)
```

## Admin Panel

- URL: `<your-render-url>/admin`
- Default: `admin` / `admin123` (override via env)

## Why no better-sqlite3?

The screenshot you provided showed:
```
gyp ERR! stack Error: `make` failed with exit code: 2
gyp ERR! cwd /opt/render/project/src/node_modules/better-sqlite3
```

That's a native compilation failure — Render's free tier build image can't compile better-sqlite3's C++ addon reliably. We use `lowdb` (pure JavaScript) instead — the API is similar, data persists in `db.json`, and it deploys cleanly on Render free tier every time.
