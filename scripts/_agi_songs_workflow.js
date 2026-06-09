export const meta = {
  name: 'agi-soundtrack',
  description: 'Suno song specs per location, matching each scene era/mood',
  phases: [{ title: 'Songs' }],
}

// per-location song input embedded by generator (replaces LOCS_PLACEHOLDER)
const LOCS = LOCS_PLACEHOLDER
if (!Array.isArray(LOCS)) { return { error: 'no locations embedded' } }

const SONG_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['locationId', 'trackTitle', 'styleDescription', 'mode', 'lyrics'],
  properties: {
    locationId: { type: 'string' },
    trackTitle: { type: 'string', description: 'e.g. "Bletchley Park (1941) — The Cipher Vigil" — keep the (year)' },
    styleDescription: { type: 'string', description: 'Suno style description, AIM FOR <=300 characters: genre + era + tempo/BPM + instrumentation + vocal type + mood + 1-2 sonic references' },
    mode: { type: 'string', enum: ['instrumental', 'vocal'], description: 'instrumental for pure scene/ambient music; vocal if lyrics suit the scene' },
    lyrics: { type: 'string', description: 'Suno-tagged lyrics using tags like [Intro] [Verse] [Chorus] [Bridge] [Instrumental Break] [Outro] and vocal tags like [Male Vocal]. For instrumental mode, use structure/instrumental tags and little or no sung text.' },
  },
}

function songPrompt(loc) {
  return `You are a film/game composer writing a Suno AI music spec for ONE location in "The Quest for AGI", a time-travel investigation through the history and future of artificial intelligence. The track is the ambient scene music the player hears at this place/time — it must match the YEAR, the mood, and the context of the scene.

LOCATION
  id: ${loc.id}
  name: ${loc.name}
  year: ${loc.year}   act: ${loc.act}   type: ${loc.type}
  scene (use this for mood & imagery):
  "${loc.description}"

ERA + MOOD GUIDANCE: ground the instrumentation and production in the location's era and feeling — e.g. Victorian chamber strings/piano for 1843; clandestine wartime tension for 1941; bright mid-century optimism for 1956; the cold desolation of an "AI winter" for 1973/1987; late-night GPU-hum breakthrough energy for 2012; tense ceremony for the 2016 Go match; modern electronic awe for 2022; and vast, sublime cosmic ambient (Kardashev-scale, a star turned into mind) for the 2387 Dyson swarm. Cinematic, evocative, Nordic-noir-meets-cosmic-awe house style.

FORMAT (match this exactly):
- trackTitle: "${loc.name} — <evocative subtitle>"
- styleDescription: a single Suno style string, AIM FOR <=300 characters. Pack it with genre, era, tempo/BPM, concrete instrumentation, vocal type (or "instrumental"), mood, and a sonic reference or two (e.g. "filtered through Vangelis and John Carpenter"). Example shape: "Nordic noir cinematic synth, 1986 cold. Slow pulse 70 BPM, Oberheim pads, Moog bass drone. Detached baritone vocal. Vangelis x Carpenter. Icy reverb, minor-key tension."
- mode: "instrumental" or "vocal" — most scene music here should be instrumental/ambient; choose vocal only if a sung lyric genuinely fits the scene.
- lyrics: Suno-tagged. For instrumental, use structure tags like [Intro][Instrumental Break][Build][Outro] and brief production notes, with little or no sung text. For vocal, write evocative English lyrics in [Verse]/[Chorus] structure with a [Male Vocal] or [Female Vocal] tag, true to the era and theme — never naming the game.

You may grep the research dossier (/Users/andersbj/Projekt/thequestforagi/fakta/agi_quest_research_dossier.md) for extra sensory detail about this place if useful. Return ONLY the structured object for locationId="${loc.id}".`
}

phase('Songs')
log(`Writing Suno specs for ${LOCS.length} locations...`)
const songs = (await parallel(
  LOCS.map(loc => () => agent(songPrompt(loc), { label: `song:${loc.id}`, schema: SONG_SCHEMA, agentType: 'general-purpose' }))
)).filter(Boolean)
log(`Got ${songs.length}/${LOCS.length} song specs.`)
return { songs }
