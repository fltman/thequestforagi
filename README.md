# The Quest for AGI

A time-travel investigation game through the history — and future — of artificial intelligence.

It is 23:53 on 30 November 2022. OpenAI has just released ChatGPT to the world. You type one last question into the box — and it answers with words it could not possibly know. You have come unstuck in the timeline of intelligence. Travel it. Interview the minds that built the future, from Ada Lovelace's study in 1843 to whatever waits at the far end of the timeline.

![Screenshot](client/public/images/locations/openai_pioneer_2022.jpg)

## Features

- **27 timeline nodes** across five acts — Origins, the AI winters, the deep-learning awakening, the alignment reckoning, and the long tomorrow (1843 → 2387)
- **60 AI-powered characters** — Turing, Lovelace, Shannon, Hinton, Sutskever, the engineer who refused to sign the 2045 AGI declaration, and the system that wished she would
- **129 clues** revealed through free-form interrogation; clues unlock new coordinates on the timeline
- **A finale that reverses the interrogation** — the Tabulator, the archival intelligence at the end of time, asks *you* the questions, grades your understanding, and asks one last question it cannot grade
- **Nine endings** — your verdict (yes / no / it depends) × how well you actually understood the story
- **Investigation cork board** with draggable polaroids, red string, confirmed-connection gold string, drawing tools, and sticky notes
- **Suggested questions, hint escalation, cross-era knowledge** — tell Turing what the machines became and watch him react
- **Original Suno soundtrack** — 29 location tracks plus dedicated finale and epilogue themes
- **Streaming chat** over SSE with a graceful non-streaming fallback

All factual content is historically grounded: the past is accurate, the future is speculative but obeys physics (Landauer's limit, Dyson 1960, Kardashev 1964).

## Quick start

```bash
npm install && cd client && npm install && cd ..
GAME_DATA=data/agi_game_data.json GAME_DB=server/db/agi.db node server/db/seed.js
npm run dev        # server on :3001 (or PORT in .env), client on :5173
```

Set `OPENROUTER_API_KEY` in `.env` (see `.env.example`), or leave it empty and let each player paste their own key in the game settings (stored in their browser only).

Production: `cd client && npm run build`, then `NODE_ENV=production node server/index.js`.

## Shared-hosting deployment (PHP/MySQL)

A complete LAMP build for shared hosting (no Node on the server) lives in `deploy/lamp/` — see `deploy/lamp/README.md`. `./build.sh` assembles a drop-in web root; `sql/agi_game.sql` is the one-shot database import.

## Tech

Node.js + Express + better-sqlite3 · React 18 + Vite + Tailwind + Leaflet · AI via OpenRouter (Claude Haiku 4.5) — a dual-call architecture where a hidden analysis model judges which clues each reply actually revealed.

## Heritage

The engine began life as *Mordet på Sveavägen*, an investigation game about the 1986 assassination of Olof Palme (spec in `MORDET_PÅ_SVEAVÄGEN_SPEC.md`). The Palme game still runs on this engine via `GAME_DATA`/`GAME_DB` environment variables.
