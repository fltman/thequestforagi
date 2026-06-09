#!/usr/bin/env node
/**
 * Copies ONLY the images + music the AGI game actually uses into the deploy output,
 * so the one.com upload stays lean (no leftover Palme assets).
 * Usage: node copy_lamp_assets.js <agi_game_data.json> <srcPublicDir> <outDir>
 */
const fs = require('fs');
const path = require('path');
const [dataPath, srcPublic, outDir] = process.argv.slice(2);
const g = JSON.parse(fs.readFileSync(dataPath, 'utf8'));

let img = 0, mus = 0; const missing = [];
const cp = rel => {
  const s = path.join(srcPublic, rel), d = path.join(outDir, rel);
  if (fs.existsSync(s)) { fs.mkdirSync(path.dirname(d), { recursive: true }); fs.copyFileSync(s, d); return true; }
  return false;
};

Object.keys(g.locations).forEach(id => { if (cp(`images/locations/${id}.jpg`)) img++; else missing.push('img/loc/' + id); });
Object.keys(g.characters).forEach(id => { if (cp(`images/characters/${id}.jpg`)) img++; else missing.push('img/char/' + id); });
Object.keys(g.clues).forEach(id => { if (cp(`images/clues/${id}.jpg`)) img++; else missing.push('img/clue/' + id); });
Object.keys(g.locations).forEach(id => { if (cp(`music/${id}.mp3`)) mus++; else missing.push('music/' + id); });
// View-keyed tracks (not tied to a location id)
['finale', 'epilogue'].forEach(id => { if (cp(`music/${id}.mp3`)) mus++; else missing.push('music/' + id); });
cp('music/_stinger.mp3');
cp('images/corkboard.jpg');

console.log(`  copied ${img} images, ${mus} music tracks (+ stinger, corkboard)`);
if (missing.length) console.log(`  WARNING ${missing.length} missing: ${missing.slice(0, 12).join(', ')}${missing.length > 12 ? ' …' : ''}`);
