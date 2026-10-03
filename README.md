# Skull Online

The bluffing game *Skull* for 3–6 players: create a room, share the 4-letter code, and fill empty seats with bluffing bots.

- `public/game.js` is the rules engine, shared by the server and browser.
- `bot.js` holds the bot logic. Bots only use what a real player could see.
- `server.js` is a zero-dependency Node server using REST + Server-Sent Events.
- `tools/prepare_sprites.py` rebuilds `public/img/*.webp` from the source medallion art.

```bash
npm start   # http://localhost:3000
npm test
```

## Render free tier

`render.yaml` deploys a free web service with no build step and no dependencies, so cold starts are quick. Static files are held in memory, gzipped and ETagged. Sprites are about 24 KB WebP ink masks, cached for 30 days and tinted per player in CSS. Idle rooms are reaped. Rooms live in memory, so they reset when the free instance sleeps after 15 minutes of inactivity.
