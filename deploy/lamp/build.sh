#!/bin/bash
# Build the React frontend and assemble the PHP/MySQL deploy for "The Quest for AGI".
# Output: deploy/lamp/public/  (upload its contents to your web root on MAMP or one.com)
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
OUT="$SCRIPT_DIR/public"
DATA="$PROJECT_ROOT/data/agi_game_data.json"

echo "Building React frontend (relative base for subdirectory/one.com)..."
cd "$PROJECT_ROOT/client"
npx vite build --base=./

echo "Assembling $OUT ..."
rm -rf "$OUT"
mkdir -p "$OUT"
cp -r "$PROJECT_ROOT/client/dist/"* "$OUT/"
# Vite copies ALL of client/public/ (both games' images+music) into dist — drop them and re-add only what this game uses.
rm -rf "$OUT/images" "$OUT/music"
cp "$SCRIPT_DIR/.htaccess" "$OUT/"
cp -r "$SCRIPT_DIR/api" "$OUT/"
# NOTE: the game data JSON is intentionally NOT copied to the web root — it contains every answer key. (sql/seed.php reads it from the repo instead.)

# Copy only the assets this game uses (lean upload)
node "$PROJECT_ROOT/scripts/copy_lamp_assets.js" "$DATA" "$PROJECT_ROOT/client/public" "$OUT"

echo ""
echo "Build complete -> $OUT"
echo "Next:"
echo "  1. Create a MySQL database (MAMP: phpMyAdmin; one.com: control panel)."
echo "  2. Import deploy/lamp/sql/agi_game.sql into it (phpMyAdmin > Import)."
echo "  3. Edit $OUT/api/config.php with your DB name/user/password."
echo "  4. Upload the CONTENTS of $OUT/ to your web root."
echo "  5. Players paste their own OpenRouter key in the UI (stored in their browser)."
