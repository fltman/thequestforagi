#!/usr/bin/env node
/**
 * Generates images for "The Quest for AGI" from data/agi_game_data.json,
 * keeping ONE consistent rendering style across all eras (1843 -> 2387).
 * Outputs .jpg into client/public/images/{locations,characters,clues}/ (engine loads .jpg).
 *
 * Usage: node scripts/generate_agi_images.js [locations|characters|clues|all|test] [limit]
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const data = require(path.join(ROOT, 'data', 'agi_game_data.json'));
const SCRIPT = path.join(ROOT, '.claude', 'skills', 'gemini-imagegen', 'scripts', 'generate_image.py');
const IMG_DIR = path.join(ROOT, 'client', 'public', 'images');

// Locked rendering treatment — content/era varies, look stays consistent.
const BASE_STYLE = 'Cinematic painterly graphic-novel illustration, bold confident inking over rich painted rendering, dramatic chiaroscuro lighting, deep atmospheric detail, restrained cinematic color grade with a single warm accent light against cool shadow, a mood of intellect and quiet awe. Strictly period-accurate to the scene and year. The picture is ENTIRELY WORDLESS: absolutely no text, no caption box, no narration box, no comic caption, no speech balloon, no labels, no signage with readable words, no letters or numbers anywhere, no watermark, no logo, no signature';

const stripYear = s => s.replace(/\s*\(([^)]*)\)\s*$/, '').trim();
const yearOf = s => { const m = s.match(/\(([^)]*)\)\s*$/); return m ? m[1] : ''; };

function buildItems(category) {
  if (category === 'locations') {
    return Object.values(data.locations).map(l => ({
      prompt: `${BASE_STYLE}. Depict the scene purely visually (do NOT render any of these words as text in the image): ${l.description} Wide cinematic composition.`,
      output: path.join(IMG_DIR, 'locations', `${l.id}.jpg`),
    }));
  }
  if (category === 'characters') {
    return Object.values(data.characters).map(c => {
      const year = yearOf(c.name);
      return {
        prompt: `${BASE_STYLE}. Character portrait of ${stripYear(c.name)}, ${c.role}.${c.portrait_mood ? ' Mood: ' + c.portrait_mood + '.' : ''}${year ? ' Set in ' + year + ', period-accurate clothing and setting.' : ''} Head-and-shoulders, dramatic single-source lighting.`,
        output: path.join(IMG_DIR, 'characters', `${c.id}.jpg`),
      };
    });
  }
  if (category === 'clues') {
    return Object.values(data.clues).map(cl => ({
      prompt: `${BASE_STYLE}. ${cl.description} Depict it as a single evocative object, document, or symbol in moody still-life; no readable text.`,
      output: path.join(IMG_DIR, 'clues', `${cl.id}.jpg`),
    }));
  }
  return [];
}

function generate(prompt, output) {
  if (fs.existsSync(output)) { console.log(`  SKIP (exists): ${path.basename(output)}`); return 'skip'; }
  fs.mkdirSync(path.dirname(output), { recursive: true });
  const tmpPng = output.replace(/\.jpg$/, '.png');
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      execSync(`python3 "${SCRIPT}" --prompt ${JSON.stringify(prompt)} --output ${JSON.stringify(tmpPng)}`, { timeout: 180000, stdio: 'pipe' });
      if (!fs.existsSync(tmpPng)) throw new Error('no output file produced');
      execSync(`sips -s format jpeg ${JSON.stringify(tmpPng)} --out ${JSON.stringify(output)}`, { stdio: 'pipe' });
      fs.unlinkSync(tmpPng);
      console.log(`  OK: ${path.basename(output)}${attempt > 1 ? ` (attempt ${attempt})` : ''}`);
      return 'ok';
    } catch (e) {
      if (attempt < 3) { try { execSync('sleep 6'); } catch {} continue; }
      console.log(`  FAIL: ${path.basename(output)} — ${String(e.message).slice(0, 100)}`);
      return 'fail';
    }
  }
}

const category = process.argv[2] || 'all';
const limit = process.argv[3] ? parseInt(process.argv[3]) : Infinity;

let items = [];
if (category === 'all') {
  items = [...buildItems('locations'), ...buildItems('characters'), ...buildItems('clues')];
} else if (category === 'test') {
  // one of each, spanning eras, to validate the style
  const L = buildItems('locations'), C = buildItems('characters'), K = buildItems('clues');
  items = [L[0], L[L.length - 1], C[0], K[0]].filter(Boolean);
} else {
  items = buildItems(category);
}
items = items.slice(0, limit);

console.log(`\nGenerating ${items.length} images (category: ${category})...\n`);
let ok = 0, skip = 0, fail = 0;
for (const it of items) {
  const r = generate(it.prompt, it.output);
  if (r === 'ok') ok++; else if (r === 'skip') skip++; else fail++;
}
console.log(`\nDone: ${ok} generated, ${skip} skipped, ${fail} failed of ${items.length}`);
