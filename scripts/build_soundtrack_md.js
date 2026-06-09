#!/usr/bin/env node
/**
 * Build data/agi_soundtrack.md from the songs-workflow output + skeleton (for act/year ordering).
 * Usage: node scripts/build_soundtrack_md.js <songs-output.json> <out.md>
 */
const fs = require('fs');
const [songsPath, outPath] = process.argv.slice(2);
const songs = (JSON.parse(fs.readFileSync(songsPath, 'utf8')).result || {}).songs || [];
const sk = JSON.parse(fs.readFileSync('data/_agi_skeleton.json', 'utf8'));
const meta = {}; sk.locations.forEach(l => { meta[l.id] = { act: l.act, year: l.year, order: sk.locations.indexOf(l) }; });

songs.sort((a, b) => {
  const A = meta[a.locationId] || {}, B = meta[b.locationId] || {};
  return (A.act - B.act) || (A.order - B.order);
});

const L = [];
L.push('# Soundtrack: The Quest for AGI');
L.push('');
L.push('Per-location music for the time-travel investigation game. Each track is built for Suno AI with a ~300-character style description and Suno-tagged lyrics, matching the era and mood of the scene.');
L.push('');
L.push('---');
L.push('');
songs.forEach((s, i) => {
  L.push(`## ${i + 1}. ${s.trackTitle}`);
  L.push('');
  L.push(`*Act ${meta[s.locationId]?.act ?? '?'} · ${meta[s.locationId]?.year ?? ''} · ${s.mode}*`);
  L.push('');
  L.push(`**Style (${s.styleDescription.length} chars):**`);
  L.push('```');
  L.push(s.styleDescription);
  L.push('```');
  L.push('');
  L.push('**Lyrics:**');
  L.push('```');
  L.push(s.lyrics);
  L.push('```');
  L.push('');
  L.push('---');
  L.push('');
});

fs.writeFileSync(outPath, L.join('\n'));
const over = songs.filter(s => s.styleDescription.length > 300);
console.log(`wrote ${outPath}: ${songs.length} tracks`);
console.log(`style descriptions over 300 chars: ${over.length}${over.length ? ' -> ' + over.map(s => s.locationId + '(' + s.styleDescription.length + ')').join(', ') : ''}`);
