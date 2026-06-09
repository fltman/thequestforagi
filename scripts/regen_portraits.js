#!/usr/bin/env node
/**
 * Regenerates specific character portraits whose generated faces missed the
 * real person's likeness, adding explicit physical descriptions to the prompt.
 * Usage: node scripts/regen_portraits.js
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const data = require(path.join(ROOT, 'data', 'agi_game_data.json'));
const SCRIPT = path.join(ROOT, '.claude', 'skills', 'gemini-imagegen', 'scripts', 'generate_image.py');
const IMG_DIR = path.join(ROOT, 'client', 'public', 'images', 'characters');

const BASE_STYLE = 'Cinematic painterly graphic-novel illustration, bold confident inking over rich painted rendering, dramatic chiaroscuro lighting, deep atmospheric detail, restrained cinematic color grade with a single warm accent light against cool shadow, a mood of intellect and quiet awe. Strictly period-accurate to the scene and year. The picture is ENTIRELY WORDLESS: absolutely no text, no caption box, no narration box, no comic caption, no speech balloon, no labels, no signage with readable words, no letters or numbers anywhere, no watermark, no logo, no signature';

// Likeness anchors for faces the base prompt missed.
const FIXES = {
  dario_amodei_2021:
    'A man in his early forties with a pale complexion and very thick, dense dark-brown curly hair rising in a tall rounded mass of tight curls above his forehead; clean-shaven, soft rounded face, gentle deep-set thoughtful eyes, slight build; plain dark t-shirt under an open casual button-down shirt.',
  daniela_amodei_2021:
    'A woman in her late thirties with long, loose wavy chestnut-brown hair falling past her shoulders, fair skin, a warm open face with kind alert eyes and an easy composed confidence; smart casual blazer over a simple top. Background: a calm modern startup office at night — absolutely no framed certificates, diplomas or documents on the walls.',
  mark_zuckerberg_2023:
    'A man in his late thirties with pale skin and short tightly-curled light-brown hair cropped close in a Caesar-like fringe, a round youthful face, wide unblinking pale-blue eyes, thin straight mouth, slight wiry frame; plain grey crew-neck t-shirt, gold chain barely visible.',
  demis_hassabis_2016:
    'A British man in his early forties with short neat dark hair, a round boyish face, warm olive-tinged complexion, sharp attentive dark eyes and the composed poise of a chess master; clean-shaven or faint stubble; dark blue suit jacket over an open-collared shirt.',
  yoshua_bengio_2018:
    'A man in his early sixties with a full head of wavy silver-grey hair brushed back from a high forehead, a neat grey beard, prominent expressive eyebrows and deep thoughtful eyes; professor-casual dark sweater over a collared shirt.',
};

const stripYear = s => s.replace(/\s*\(([^)]*)\)\s*$/, '').trim();
const yearOf = s => { const m = s.match(/\(([^)]*)\)\s*$/); return m ? m[1] : ''; };

for (const [id, physique] of Object.entries(FIXES)) {
  const c = data.characters[id];
  if (!c) { console.log(`MISSING in data: ${id}`); continue; }
  const year = yearOf(c.name);
  const prompt = `${BASE_STYLE}. Character portrait of ${stripYear(c.name)}, ${c.role}. Physical likeness (follow precisely): ${physique}${c.portrait_mood ? ' Mood: ' + c.portrait_mood + '.' : ''}${year ? ' Set in ' + year + ', period-accurate clothing and setting.' : ''} Head-and-shoulders, dramatic single-source lighting.`;
  const output = path.join(IMG_DIR, `${id}.jpg`);
  const tmpPng = output.replace(/\.jpg$/, '.png');
  let ok = false;
  for (let attempt = 1; attempt <= 3 && !ok; attempt++) {
    try {
      execSync(`python3 "${SCRIPT}" --prompt ${JSON.stringify(prompt)} --output ${JSON.stringify(tmpPng)}`, { timeout: 180000, stdio: 'pipe' });
      if (!fs.existsSync(tmpPng)) throw new Error('no output produced');
      execSync(`sips -s format jpeg ${JSON.stringify(tmpPng)} --out ${JSON.stringify(output)}`, { stdio: 'pipe' });
      fs.unlinkSync(tmpPng);
      console.log(`OK: ${id}${attempt > 1 ? ` (attempt ${attempt})` : ''}`);
      ok = true;
    } catch (e) {
      console.log(`  attempt ${attempt} failed for ${id}: ${e.message.split('\n')[0]}`);
    }
  }
  if (!ok) console.log(`FAIL: ${id} (kept previous image)`);
}
console.log('Done.');
