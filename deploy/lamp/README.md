# The Quest for AGI — PHP / MySQL deploy (MAMP & one.com)

A PHP + MySQL build of the game for shared hosting (no Node.js on the server). The React frontend is pre-built to static files; a small PHP API backs it with MySQL and proxies chat to OpenRouter. The game ships with **27 locations, 60 characters and 129 clues** across the timeline.

## OpenRouter key model (important)

There is **no server-side API key**. Each player pastes their **own** OpenRouter key into the game's settings; it is stored in their **browser localStorage** and sent per request as the `X-OpenRouter-Key` header, which the PHP forwards to OpenRouter. So you can host this publicly without exposing a key, and `config.php` leaves `OPENROUTER_API_KEY` empty. (If you'd rather use one shared key for everyone, set `OPENROUTER_API_KEY` in `config.php` instead.)

## What's in here

```
deploy/lamp/
  build.sh              — builds the frontend + assembles public/
  sql/
    schema.sql          — MySQL schema (tables)
    agi_game.sql        — COMPLETE import: schema + all game data (use this on one.com)
    seed.php            — alternative CLI seeder (reads data/agi_game_data.json)
  api/                  — PHP API (router, config, routes)
  public/               — the drop-in web root (built frontend + api + images + music + data)
```

## API endpoints (mirrors the Node backend exactly)

Game data:
- `GET /api/locations` — locations with `coords`, `unlockedBy`, `era`, `eraLabel`
- `GET /api/locations/:id/characters` — characters at a location, each with `clueIds`
- `GET /api/characters/:id` — anti-spoiler character data (`clues` as plain id array, `suggestedQuestions`, `openingLine` — no prompts or trigger conditions)
- `GET /api/clues`, `GET /api/clues/:id` — clues with `unlocksLocation`, `linkedClues`, `finale`
- `GET /api/clue-types`, `GET /api/config` (finale questions/endings are stripped server-side)

AI (all proxied to OpenRouter with the player's key):
- `POST /api/chat/message` — in-character chat; send `stream: true` for SSE token streaming
- `POST /api/chat/analyze` — hidden clue-reveal engine (`{revealedClues: [...]}`)
- `POST /api/chat/recap` — short "case so far" noir briefing
- `POST /api/chat/finale` — the Tabulator's reverse-interview, grading and branching verdict
- `POST /api/chat/summarize`, `POST /api/chat/note` — interview summaries / notebook entries
- `POST /api/verify-key` — validates an OpenRouter key

Player persistence:
- `POST /api/player`, `GET /api/player/:id` — create/load (state includes `visitedLocations`)
- `POST /api/player/:id/state|conversation/:characterId|board|notebook` — saves

## Build (already run; re-run after content changes)

```bash
cd deploy/lamp && ./build.sh          # → produces public/  (~161 MB, mostly audio)
node ../../scripts/build_lamp_sql.js  # → regenerates sql/agi_game.sql
```

---

## A) Local test with MAMP

1. **Build** (above) so `deploy/lamp/public/` exists.
2. Start **MAMP** (Apache + MySQL). MAMP's MySQL is usually on port **8889**, Apache on **8888**.
3. Open MAMP's **phpMyAdmin** → create a database named `agi_game` → **Import** → choose `deploy/lamp/sql/agi_game.sql` → Go.
4. Point MAMP's document root at `deploy/lamp/public/` (MAMP → Preferences → Web Server → Document Root), **or** copy the contents of `public/` into MAMP's `htdocs/`.
5. Edit `public/api/config.php` for MAMP:
   ```php
   define('DB_NAME', 'agi_game');
   define('DB_USER', 'root');
   define('DB_PASS', 'root');
   define('DB_PORT', '8889');   // MAMP MySQL port
   ```
6. Visit `http://localhost:8888/` → the game loads → open settings, paste your OpenRouter key, and play.

---

## B) Deploy on one.com

1. In the one.com control panel, create a **MySQL database** and user. Note the **host, database name, username, password** (one.com gives you these).
2. Open one.com's **phpMyAdmin**, select your database, → **Import** → upload `deploy/lamp/sql/agi_game.sql` → Go. (This creates all tables and loads the game.)
3. Edit `public/api/config.php` with your one.com values:
   ```php
   define('DB_HOST', 'your-one-com-mysql-host');   // e.g. provided by one.com
   define('DB_NAME', 'your_db_name');
   define('DB_USER', 'your_db_user');
   define('DB_PASS', 'your_db_password');
   define('DB_PORT', '3306');
   // OPENROUTER_API_KEY stays '' — players use their own key.
   ```
4. Upload the **contents of `public/`** to your web space via SFTP or the one.com File Manager — either to the domain root, or a subfolder (the build uses relative paths, so a subfolder like `/agi/` works too).
5. Make sure `.htaccess` is uploaded (it routes `/api/*` to PHP and serves the SPA). one.com supports `.htaccess` + `mod_rewrite` by default.
6. Open your URL → paste your OpenRouter key in settings → play.

**Requirements:** PHP 8.0+ with `pdo_mysql` and `curl`, MySQL/MariaDB, Apache with `mod_rewrite`.

---

## Troubleshooting

- **Blank page / 404 on `/api/...`** — `.htaccess`/`mod_rewrite` not active, or the app is in a subfolder but `.htaccess` wasn't uploaded.
- **500 on API** — DB credentials in `config.php` are wrong, or `agi_game.sql` wasn't imported. Check the PHP error log.
- **"API key not configured" / chat fails** — paste your OpenRouter key in the in-game settings (it's stored only in your browser).
- **Chat replies appear all at once instead of streaming** — some hosts buffer PHP output; the SSE events then arrive together at the end. Harmless: the client still renders the full reply.
- **Upgrading an older database** — either re-import `agi_game.sql` (drops and recreates everything), or run `php sql/seed.php` which applies the new columns (`era`, `suggested_questions`, `opening_line`, `finale`, `requires_clues`, `visited_locations`) before reseeding.
- **MAMP can't connect to DB** — set `DB_PORT` to `8889` (MAMP's MySQL port) in `config.php`.
- **DB connection test:** `php -r "new PDO('mysql:host=HOST;port=PORT;dbname=DB','USER','PASS');"`
